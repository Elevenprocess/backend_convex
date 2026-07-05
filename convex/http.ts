import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { mapGhlLeadPayload } from "./model/ghl/leadWebhook";
import { checkWebhookSecret, clientIp, importsDisabled } from "./model/ghl/webhookAuth";

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

export default http;
