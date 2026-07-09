import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";
import { mapGhlLeadPayload } from "./model/ghl/leadWebhook";
import {
  GhlOpportunityWebhookValidationError,
  normalizeOpportunityWebhook,
} from "./model/ghl/opportunityWebhook";
import { mapGhlStageToStatus } from "./model/ghl/stageMapper";
import { checkWebhookSecret, clientIp, importsDisabled } from "./model/ghl/webhookAuth";
import { signDebriefToken, verifyDebriefToken } from "./model/debriefLinkToken";

const http = httpRouter();
auth.addHttpRoutes(http);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Webhook public GHL "Contact Created" (workflow → action Webhook).
 * Orchestration : secret → IMPORTS_DISABLED → record → createLeadFromWebhook
 * → markProcessed ; échec traitement → markFailed + 500 (GHL retentera).
 * NON branché côté GHL tant que la bascule n'est pas décidée.
 */
http.route({
  path: "/webhooks/elevenprocess",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = checkWebhookSecret(req);
    if (!secret.ok) return json({ message: secret.error }, 403);

    let payload: Record<string, unknown>;
    try {
      payload = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ message: "Body JSON invalide" }, 400);
    }

    const record = () =>
      ctx.runMutation(internal.webhooks.recordEvent, {
        provider: "ghl",
        eventType: "contact.created",
        payload: JSON.stringify(payload),
        ...(clientIp(req) !== undefined ? { ipAddress: clientIp(req) } : {}),
      });

    if (importsDisabled()) {
      const eventId = await record();
      await ctx.runMutation(internal.webhooks.markProcessed, { eventId });
      return json({ ok: true, eventId, skipped: true });
    }

    const eventId = await record();
    try {
      const mapped = mapGhlLeadPayload(payload);
      const result = await ctx.runMutation(internal.webhooks.createLeadFromWebhook, {
        ...(mapped.externalId !== undefined ? { externalId: mapped.externalId } : {}),
        data: mapped.data,
        signals: mapped.signals,
      });
      await ctx.runMutation(internal.webhooks.markProcessed, { eventId });
      return json({ ok: true, eventId, leadId: result.leadId, duplicate: result.duplicate });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      await ctx.runMutation(internal.webhooks.markFailed, { eventId, error: message });
      return json({ message }, 500);
    }
  }),
});

/**
 * Webhook public GHL "Opportunity Created / Stage Changed / Status Changed"
 * (pipeline "1. CRM Vente"). Payload invalide → 200 {ok:false} pour ne pas
 * saturer le retry GHL sur une erreur permanente (parité NestJS).
 */
http.route({
  path: "/webhooks/ghl/opportunity",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = checkWebhookSecret(req);
    if (!secret.ok) return json({ message: secret.error }, 403);

    let payload: Record<string, unknown>;
    try {
      payload = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ message: "Body JSON invalide" }, 400);
    }

    const rawEvent = typeof payload.event === "string" ? payload.event.trim() : "";
    const eventType = rawEvent.length > 0 ? rawEvent : "opportunity.changed";
    const record = () =>
      ctx.runMutation(internal.webhooks.recordEvent, {
        provider: "ghl",
        eventType,
        payload: JSON.stringify(payload),
        ...(clientIp(req) !== undefined ? { ipAddress: clientIp(req) } : {}),
      });

    if (importsDisabled()) {
      const eventId = await record();
      await ctx.runMutation(internal.webhooks.markProcessed, { eventId });
      return json({ ok: true, eventId, skipped: true });
    }

    const eventId = await record();
    try {
      const n = normalizeOpportunityWebhook(payload, Date.now());
      const result = await ctx.runMutation(internal.webhooks.applyGhlStageChange, {
        externalId: n.externalId,
        ghlStageName: n.ghlStageName,
        ...(n.ghlPipelineId !== undefined ? { ghlPipelineId: n.ghlPipelineId } : {}),
        ...(n.monetaryValue !== undefined ? { monetaryValue: n.monetaryValue } : {}),
        ...(n.ghlAssignedUserId !== undefined ? { ghlAssignedUserId: n.ghlAssignedUserId } : {}),
        ...(n.lostReason !== undefined ? { lostReason: n.lostReason } : {}),
        webhookEventId: eventId,
        occurredAt: n.occurredAt,
        contactSeed: n.contactSeed,
      });
      await ctx.runMutation(internal.webhooks.markProcessed, { eventId });

      // Sync GHL → projects.status (entrant, best-effort, pas de push sortant).
      const mapped = mapGhlStageToStatus(n.ghlStageName);
      if (mapped.status) {
        try {
          await ctx.runMutation(internal.webhooks.syncProjectFromLead, {
            leadId: result.leadId,
            leadStatus: mapped.status,
          });
        } catch (err) {
          console.warn(
            `syncFromLeadStatus failed (eventId=${eventId}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      return json({
        ok: true,
        eventId,
        leadId: result.leadId,
        created: result.created,
        statusChanged: result.statusChanged,
        historyAppended: result.historyAppended,
        sideEffect: result.sideEffect ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      await ctx.runMutation(internal.webhooks.markFailed, { eventId, error: message });
      if (err instanceof GhlOpportunityWebhookValidationError) {
        console.warn(`Payload opportunity invalide (eventId=${eventId}) : ${message}`);
        return json({ ok: false, eventId, error: message });
      }
      return json({ message }, 500);
    }
  }),
});

function debriefLinkSecret(): string {
  return process.env.DEBRIEF_LINK_SECRET || process.env.BETTER_AUTH_SECRET || "";
}

// Extraction souple d'un id dans le payload d'un webhook workflow GHL : les
// clés varient selon la config de l'action. Cherche `keys` à la racine et dans
// customData, puis `id` UNIQUEMENT dans les objets imbriqués `nestedNames`
// (contact.id oui, payload.id non — trop ambigu à la racine).
function extractId(
  payload: Record<string, unknown>,
  keys: string[],
  nestedNames: string[],
): string | undefined {
  const asStr = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const scopes: Array<Record<string, unknown>> = [payload];
  const customData = payload.customData;
  if (customData && typeof customData === "object") {
    scopes.push(customData as Record<string, unknown>);
  }
  for (const scope of scopes) {
    for (const key of keys) {
      const value = asStr(scope[key]);
      if (value) return value;
    }
  }
  for (const nested of nestedNames) {
    const obj = payload[nested];
    if (obj && typeof obj === "object") {
      const value = asStr((obj as Record<string, unknown>).id);
      if (value) return value;
    }
  }
  return undefined;
}

/**
 * Webhook GHL "envoi du lien débrief" (workflow → action Webhook au moment où
 * GHL décide que le commercial doit débriefer, p.ex. fin de rendez-vous).
 * Le backend résout le RDV, signe le lien magique PERMANENT (token sans
 * expiration), l'écrit dans le champ contact `lien_debrief` (best-effort) et
 * répond avec l'URL — le workflow GHL l'envoie ensuite au commercial (SMS/
 * email) via le champ contact ou le mapping de réponse.
 */
http.route({
  path: "/webhooks/ghl/debrief-link",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secretCheck = checkWebhookSecret(req);
    if (!secretCheck.ok) return json({ message: secretCheck.error }, 403);

    let payload: Record<string, unknown>;
    try {
      payload = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ message: "Body JSON invalide" }, 400);
    }

    const eventId = await ctx.runMutation(internal.webhooks.recordEvent, {
      provider: "ghl",
      eventType: "debrief.link.requested",
      payload: JSON.stringify(payload),
      ...(clientIp(req) !== undefined ? { ipAddress: clientIp(req) } : {}),
    });

    try {
      const contactExternalId = extractId(payload, ["contact_id", "contactId"], ["contact"]);
      const appointmentExternalId = extractId(
        payload,
        ["appointment_id", "appointmentId", "calendar_event_id"],
        ["appointment", "calendar"],
      );
      if (!contactExternalId && !appointmentExternalId) {
        await ctx.runMutation(internal.webhooks.markFailed, {
          eventId, error: "contact_id ou appointment_id requis",
        });
        // 200 {ok:false} : erreur permanente, inutile que GHL retente (parité opportunity).
        return json({ ok: false, eventId, error: "contact_id ou appointment_id requis" });
      }

      const resolved = await ctx.runQuery(internal.ghlDebriefLink.resolveRdvForDebriefRequest, {
        ...(contactExternalId !== undefined ? { contactExternalId } : {}),
        ...(appointmentExternalId !== undefined ? { appointmentExternalId } : {}),
      });
      if (!resolved) {
        await ctx.runMutation(internal.webhooks.markFailed, {
          eventId, error: "Aucun RDV trouvé pour ce contact/rendez-vous",
        });
        return json({ ok: false, eventId, error: "Aucun RDV trouvé pour ce contact/rendez-vous" });
      }

      const secret = debriefLinkSecret();
      if (!secret) return json({ message: "DEBRIEF_LINK_SECRET non configuré" }, 500);
      const token = await signDebriefToken(resolved.rdvId, secret); // permanent (pas de TTL)

      // URL courte /d/<token> sur le domaine Convex site ; fallback URL front longue.
      const siteBase = (process.env.CONVEX_SITE_URL ?? "").replace(/\/$/, "");
      const url = siteBase
        ? `${siteBase}/d/${token}`
        : `${frontendBase()}/#/debrief/${encodeURIComponent(token)}`;

      // Écriture du token dans le champ contact `lien_debrief` (best-effort :
      // false si GHL non configuré — la réponse porte l'URL de toute façon).
      let fieldUpdated = false;
      if (resolved.contactExternalId) {
        fieldUpdated = await ctx.runAction(api.ghlDebriefLink.setContactDebriefLink, {
          contactExternalId: resolved.contactExternalId,
          rdvId: resolved.rdvId,
        });
      }
      await ctx.runMutation(internal.ghlDebriefLink.markDebriefDuePushed, {
        rdvId: resolved.rdvId as any,
        now: Date.now(),
      });

      await ctx.runMutation(internal.webhooks.markProcessed, { eventId });
      return json({ ok: true, eventId, rdvId: resolved.rdvId, url, token, fieldUpdated });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      await ctx.runMutation(internal.webhooks.markFailed, { eventId, error: message });
      return json({ message }, 500);
    }
  }),
});

function frontendBase(): string {
  return (process.env.FRONTEND_URL ?? "https://crm.electroconceptoi.com")
    .split(",")[0].trim().replace(/\/$/, "");
}

// Redirect court /d/<token> → page publique débrief. Aucune vérif (le token
// signé porte l'autorisation, vérifiée aux appels API /debrief-link).
http.route({
  pathPrefix: "/d/",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const token = new URL(req.url).pathname.slice("/d/".length);
    const location = `${frontendBase()}/#/debrief/${encodeURIComponent(decodeURIComponent(token))}`;
    return new Response(null, { status: 302, headers: { Location: location } });
  }),
});

// CORS des routes publiques /debrief-link/* : la page débrief (SPA sur Vercel)
// les appelle cross-origin. Origine * : endpoints publics, l'autorisation est
// portée par le token signé dans l'URL, pas par l'origine.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type",
  "access-control-max-age": "86400",
};

const corsJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });

// Preflight des POST JSON (content-type: application/json → OPTIONS d'abord).
http.route({
  pathPrefix: "/debrief-link/",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS })),
});

// Lecture publique du débrief via lien magique.
http.route({
  pathPrefix: "/debrief-link/",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const token = decodeURIComponent(new URL(req.url).pathname.slice("/debrief-link/".length));
    const payload = await verifyDebriefToken(token, debriefLinkSecret());
    if (!payload) return corsJson({ message: "Lien invalide ou expiré." }, 410);
    const data = await ctx.runQuery(internal.debriefs.linkReadData, { rdvId: payload.rdvId as any });
    if (!data) return corsJson({ message: "Rendez-vous introuvable." }, 404);
    return corsJson(data);
  }),
});

// Écriture publique : submit débrief OU reschedule (suffixe /reschedule).
http.route({
  pathPrefix: "/debrief-link/",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const suffix = decodeURIComponent(new URL(req.url).pathname.slice("/debrief-link/".length));
    const isReschedule = suffix.endsWith("/reschedule");
    const token = isReschedule ? suffix.slice(0, -"/reschedule".length) : suffix;
    const payload = await verifyDebriefToken(token, debriefLinkSecret());
    if (!payload) return corsJson({ message: "Lien invalide ou expiré." }, 410);
    const rdvId = payload.rdvId as any;

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return corsJson({ message: "Body JSON invalide" }, 400);
    }

    if (isReschedule) {
      const when = typeof body.scheduledAt === "string" ? Date.parse(body.scheduledAt) : NaN;
      if (Number.isNaN(when)) return corsJson({ message: "Date de report invalide." }, 400);
      if (when <= Date.now()) return corsJson({ message: "La nouvelle date doit être dans le futur." }, 400);
      try {
        await ctx.runMutation(internal.debriefs.rescheduleViaLink, { rdvId, scheduledAt: when });
      } catch (err) {
        return corsJson({ message: err instanceof Error ? err.message : "Report impossible." }, 404);
      }
      return corsJson({ ok: true });
    }

    try {
      await ctx.runMutation(internal.debriefs.submitViaLink, { rdvId, ...(body as any) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Enregistrement impossible.";
      const status = /introuvable/i.test(msg) ? 404 : 400;
      return corsJson({ message: msg }, status);
    }
    return corsJson({ ok: true });
  }),
});

export default http;
