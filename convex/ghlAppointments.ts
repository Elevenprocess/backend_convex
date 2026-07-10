/**
 * Prise de RDV setter → GHL (flux sortant). Portage de
 * GhlCalendarService.createAppointment / updateAppointment (NestJS) :
 *
 *  1. upsert du contact GHL (identité/adresse du lead, source "ECOI SaaS") ;
 *  2. note « remarque prospect » professionnelle (créneau, adresse, logement,
 *     revenu, commentaire setter, éligibilité) postée sur le contact ;
 *  3. création de l'appointment GHL (confirmé, titre "RDV ECOI <secteur> — <nom>",
 *     note = remarque) sur le calendrier du secteur ;
 *  4. déplacement de l'opportunité du contact vers "5. RDV Planifié 📅"
 *     (pipeline CRM Vente) — best-effort, jamais bloquant ;
 *  5. localement : création du rdv (externalId/ghlEventId = appointment GHL),
 *     patch du lead (ghlContactId, infos, statut "qualifie").
 *
 * L'écho webhook GHL (stage → rdv_pris) reboucle ensuite sans effet de bord
 * (statut identique → no-op côté applyGhlStageChange).
 */
import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { ghlRequest, isGhlConfigured, requireGhlLocationId } from "./ghlClient";
import { calendarIdForSector, parseSectorCalendars } from "./model/ghl/sectorConfig";
import { buildGhlProspectRemark } from "./model/ghl/prospectRemark";
import { requireUser } from "./model/access";
import { rdvLocationValidator } from "./model/enums";
import { OPEN_RDV_STATUSES } from "./rdv";

const RDV_PLANIFIE_STAGE = "5. RDV Planifié 📅";
const CLOSING_PIPELINE = "CRM Vente";

// ─── Helpers GHL (parsing minimal des réponses opportunity) ───────────────────

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

type PipelineInfo = { id: string; name: string; stages: Array<{ id: string; name: string }> };

async function listPipelines(): Promise<PipelineInfo[]> {
  const raw = (await ghlRequest("/opportunities/pipelines", {
    query: { locationId: requireGhlLocationId() },
  })) as { pipelines?: Array<Record<string, unknown>> } | null;
  return (raw?.pipelines ?? []).map((p) => ({
    id: str(p.id) ?? "",
    name: str(p.name) ?? "",
    stages: (Array.isArray(p.stages) ? p.stages : []).map((s: Record<string, unknown>) => ({
      id: str(s.id) ?? "",
      name: str(s.name) ?? "",
    })),
  }));
}

async function findOpportunityForContact(
  contactId: string,
): Promise<{ id: string; pipelineId: string; pipelineStageId: string } | null> {
  const pipelines = await listPipelines();
  const wanted = normalizeText(CLOSING_PIPELINE);
  const pipeline = pipelines.find((p) => normalizeText(p.name).includes(wanted)) ?? pipelines[0];
  if (!pipeline) return null;

  const raw = (await ghlRequest("/opportunities/search", {
    query: {
      location_id: requireGhlLocationId(),
      pipeline_id: pipeline.id,
      contact_id: contactId,
      limit: 20,
    },
  })) as { opportunities?: Array<Record<string, unknown>> } | null;
  const list = (raw?.opportunities ?? [])
    .map((o) => ({
      id: str(o.id) ?? "",
      pipelineId: str(o.pipelineId) ?? pipeline.id,
      pipelineStageId: str(o.pipelineStageId) ?? "",
      contactId:
        str(o.contactId) ??
        str((o.contact as Record<string, unknown> | undefined)?.id) ??
        "",
      updatedAt: str(o.updatedAt) ?? str(o.lastStatusChangeAt) ?? "",
    }))
    .filter((o) => o.id && o.contactId === contactId);
  if (list.length === 0) return null;
  list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return list[0];
}

/** Déplace l'opportunité du contact vers un stage nommé. Best-effort. */
async function moveOpportunityForContactToStage(
  contactId: string,
  stageName: string,
): Promise<boolean> {
  try {
    const opp = await findOpportunityForContact(contactId);
    if (!opp) return false;
    const pipelines = await listPipelines();
    const pipeline = pipelines.find((p) => p.id === opp.pipelineId);
    const stage = pipeline?.stages.find((s) => normalizeText(s.name) === normalizeText(stageName));
    if (!stage) {
      console.warn(`Stage "${stageName}" introuvable dans pipeline ${opp.pipelineId}`);
      return false;
    }
    if (stage.id === opp.pipelineStageId) return true;
    const updated = (await ghlRequest(`/opportunities/${encodeURIComponent(opp.id)}`, {
      method: "PUT",
      body: { pipelineStageId: stage.id },
    })) as { opportunity?: unknown } | null;
    return Boolean(updated?.opportunity);
  } catch (err) {
    console.warn(
      `moveOpportunityForContactToStage(${contactId}) failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

// ─── Internes (auth + écriture locale) ────────────────────────────────────────

export const assertCanBook = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return { userId: user._id };
  },
});

const contactFieldsValidator = {
  firstName: v.optional(v.union(v.string(), v.null())),
  lastName: v.optional(v.union(v.string(), v.null())),
  email: v.optional(v.union(v.string(), v.null())),
  phone: v.optional(v.union(v.string(), v.null())),
  addressLine: v.optional(v.union(v.string(), v.null())),
  city: v.optional(v.union(v.string(), v.null())),
  postalCode: v.optional(v.union(v.string(), v.null())),
  typeLogement: v.optional(v.union(v.string(), v.null())),
  revenuFiscal: v.optional(v.union(v.number(), v.null())),
};

export const leadForBooking = internalQuery({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args): Promise<Doc<"leads"> | null> => {
    const lead = await ctx.db.get(args.leadId);
    return lead && lead.deletedAt === undefined ? lead : null;
  },
});

export const finalizeAppointment = internalMutation({
  args: {
    leadId: v.id("leads"),
    contactId: v.string(),
    appointmentId: v.union(v.string(), v.null()),
    scheduledAt: v.number(),
    locationType: v.optional(rdvLocationValidator),
    notes: v.optional(v.string()),
    ...contactFieldsValidator,
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.deletedAt !== undefined) throw new Error("Lead introuvable");

    // Garde anti-doublon identique à rdv:create : un seul RDV ouvert par lead.
    const existing = await ctx.db
      .query("rdv")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
      .collect();
    const open = existing.find(
      (r) =>
        r.deletedAt === undefined &&
        (OPEN_RDV_STATUSES as readonly string[]).includes(r.status),
    );

    let rdvId;
    if (open) {
      // RDV ouvert déjà présent (ex. re-book) : on le met à jour plutôt que doubler.
      await ctx.db.patch(open._id, {
        scheduledAt: args.scheduledAt,
        ...(args.notes !== undefined ? { notes: args.notes } : {}),
        ...(args.appointmentId ? { externalId: args.appointmentId, ghlEventId: args.appointmentId } : {}),
      });
      rdvId = open._id;
    } else {
      rdvId = await ctx.db.insert("rdv", {
        leadId: args.leadId,
        scheduledAt: args.scheduledAt,
        locationType: args.locationType ?? "domicile",
        status: "planifie",
        createdAt: Date.now(),
        ...(args.notes !== undefined ? { notes: args.notes } : {}),
        ...(args.appointmentId
          ? { externalId: args.appointmentId, ghlEventId: args.appointmentId }
          : {}),
      });
    }

    // Lead : id contact GHL + infos corrigées + statut qualifie (parité NestJS).
    const clean = (s: string | null | undefined) => {
      const t = (s ?? "").trim();
      return t === "" ? undefined : t;
    };
    const patch: Record<string, unknown> = {
      ghlContactId: args.contactId,
      status: "qualifie",
    };
    if (!lead.externalId) patch.externalId = args.contactId;
    for (const key of [
      "firstName", "lastName", "email", "phone", "addressLine", "city", "postalCode", "typeLogement",
    ] as const) {
      const value = clean(args[key] as string | null | undefined);
      if (value !== undefined) patch[key] = value;
    }
    if (args.revenuFiscal != null) patch.revenuFiscal = args.revenuFiscal;
    await ctx.db.patch(args.leadId, patch as never);

    const rdv = await ctx.db.get(rdvId);
    return { rdvId, rdv };
  },
});

// ─── Action publique ──────────────────────────────────────────────────────────

export const createAppointment = action({
  args: {
    leadId: v.id("leads"),
    sector: v.string(),
    calendarId: v.optional(v.string()),
    scheduledAt: v.number(), // ms epoch
    locationType: v.optional(rdvLocationValidator),
    notes: v.optional(v.union(v.string(), v.null())),
    ...contactFieldsValidator,
  },
  handler: async (ctx, args): Promise<{ rdvId: string; contactId: string; appointmentId: string | null; movedToRdvPlanifie: boolean }> => {
    await ctx.runQuery(internal.ghlAppointments.assertCanBook, {});
    if (!isGhlConfigured()) throw new Error("GHL non configuré côté serveur.");

    const calendarId =
      args.calendarId || calendarIdForSector(parseSectorCalendars(process.env.GHL_SECTOR_CALENDARS), args.sector);
    if (!calendarId) throw new Error(`Aucun calendrier GHL configuré pour le secteur ${args.sector}.`);
    const locationId = requireGhlLocationId();

    const lead = await ctx.runQuery(internal.ghlAppointments.leadForBooking, { leadId: args.leadId });
    if (!lead) throw new Error("Lead introuvable.");

    const identity = {
      firstName: args.firstName ?? lead.firstName ?? null,
      lastName: args.lastName ?? lead.lastName ?? null,
      email: args.email ?? lead.email ?? null,
      phone: args.phone ?? lead.phone ?? null,
      addressLine: args.addressLine ?? lead.addressLine ?? null,
      city: args.city ?? lead.city ?? null,
      postalCode: args.postalCode ?? lead.postalCode ?? null,
      typeLogement: args.typeLogement ?? lead.typeLogement ?? null,
      revenuFiscal: args.revenuFiscal ?? lead.revenuFiscal ?? null,
    };

    // 1. Upsert contact GHL.
    const contactRaw = (await ghlRequest("/contacts/upsert", {
      method: "POST",
      body: {
        locationId,
        firstName: identity.firstName || undefined,
        lastName: identity.lastName || undefined,
        name: [identity.firstName, identity.lastName].filter(Boolean).join(" ") || undefined,
        email: identity.email || undefined,
        phone: identity.phone || undefined,
        address1: identity.addressLine || undefined,
        city: identity.city || undefined,
        postalCode: identity.postalCode || undefined,
        source: "ECOI SaaS",
      },
    })) as Record<string, unknown>;
    const contactObj = (contactRaw?.contact ?? contactRaw) as Record<string, unknown>;
    const contactId = str(contactObj?.id) ?? str(contactObj?.contactId);
    if (!contactId) throw new Error("GHL n'a pas retourné de contactId.");

    // 2. Remarque prospect professionnelle → note contact.
    const prospectRemark = buildGhlProspectRemark({
      sector: args.sector,
      ...identity,
      scheduledAt: args.scheduledAt,
      notes: args.notes ?? null,
    });
    if (prospectRemark) {
      try {
        await ghlRequest(`/contacts/${encodeURIComponent(contactId)}/notes`, {
          method: "POST",
          body: { body: prospectRemark },
        });
      } catch (err) {
        console.warn(`Note contact GHL non créée (${contactId}) : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const appointmentNotes = prospectRemark || (args.sector ? `RDV ECOI — ${args.sector}` : undefined);

    // 3. Appointment GHL confirmé sur le calendrier secteur.
    const name = [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim();
    const appointmentRaw = (await ghlRequest("/calendars/events/appointments", {
      method: "POST",
      body: {
        locationId,
        calendarId,
        contactId,
        startTime: new Date(args.scheduledAt).toISOString(),
        appointmentStatus: "confirmed",
        title: `RDV ECOI ${args.sector}${name ? ` — ${name}` : ""}`,
        notes: appointmentNotes,
      },
    })) as Record<string, unknown>;
    const apptObj = (appointmentRaw?.appointment ?? appointmentRaw) as Record<string, unknown>;
    const appointmentId = str(apptObj?.id) ?? str(apptObj?.appointmentId) ?? str(appointmentRaw?.id) ?? null;

    // 4. Opportunité → "5. RDV Planifié 📅" (best-effort, jamais bloquant).
    const movedToRdvPlanifie = await moveOpportunityForContactToStage(contactId, RDV_PLANIFIE_STAGE);

    // 5. Écriture locale (rdv + lead).
    const { rdvId } = await ctx.runMutation(internal.ghlAppointments.finalizeAppointment, {
      leadId: args.leadId,
      contactId,
      appointmentId,
      scheduledAt: args.scheduledAt,
      locationType: args.locationType,
      notes: appointmentNotes ?? undefined,
      ...identity,
    });

    return { rdvId, contactId, appointmentId, movedToRdvPlanifie };
  },
});

// ─── Édition d'un RDV déjà envoyé à GHL ──────────────────────────────────────
// Portage allégé de updateAppointment : replanification/note → PUT appointment ;
// infos lead → PUT contact ; puis mise à jour locale.

export const rdvForUpdate = internalQuery({
  args: { rdvId: v.id("rdv") },
  handler: async (ctx, args) => {
    const rdv = await ctx.db.get(args.rdvId);
    if (!rdv || rdv.deletedAt !== undefined) return null;
    const lead = await ctx.db.get(rdv.leadId);
    return {
      rdv: { _id: rdv._id, ghlEventId: rdv.ghlEventId ?? rdv.externalId ?? null },
      lead: lead && lead.deletedAt === undefined
        ? { _id: lead._id, ghlContactId: lead.ghlContactId ?? lead.externalId ?? null, firstName: lead.firstName ?? null, lastName: lead.lastName ?? null }
        : null,
    };
  },
});

export const applyAppointmentUpdate = internalMutation({
  args: {
    rdvId: v.id("rdv"),
    scheduledAt: v.optional(v.number()),
    notes: v.optional(v.union(v.string(), v.null())),
    ...contactFieldsValidator,
  },
  handler: async (ctx, args) => {
    const rdv = await ctx.db.get(args.rdvId);
    if (!rdv || rdv.deletedAt !== undefined) throw new Error("RDV introuvable");
    const patch: Record<string, unknown> = {};
    if (args.scheduledAt !== undefined) patch.scheduledAt = args.scheduledAt;
    if (args.notes !== undefined) patch.notes = args.notes ?? undefined;
    if (Object.keys(patch).length > 0) await ctx.db.patch(args.rdvId, patch as never);

    const clean = (s: string | null | undefined) => {
      const t = (s ?? "").trim();
      return t === "" ? undefined : t;
    };
    const leadPatch: Record<string, unknown> = {};
    for (const key of [
      "firstName", "lastName", "email", "phone", "addressLine", "city", "postalCode", "typeLogement",
    ] as const) {
      const value = clean(args[key] as string | null | undefined);
      if (value !== undefined) leadPatch[key] = value;
    }
    if (args.revenuFiscal != null) leadPatch.revenuFiscal = args.revenuFiscal;
    if (Object.keys(leadPatch).length > 0) await ctx.db.patch(rdv.leadId, leadPatch as never);
    return null;
  },
});

export const updateAppointment = action({
  args: {
    rdvId: v.id("rdv"),
    scheduledAt: v.optional(v.number()),
    notes: v.optional(v.union(v.string(), v.null())),
    ...contactFieldsValidator,
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.ghlAppointments.assertCanBook, {});
    const info = await ctx.runQuery(internal.ghlAppointments.rdvForUpdate, { rdvId: args.rdvId });
    if (!info) throw new Error("RDV introuvable.");

    if (isGhlConfigured()) {
      // Push GHL AVANT le local (parité NestJS : si GHL refuse, rien n'est appliqué).
      const contactFieldChanged = [
        args.firstName, args.lastName, args.email, args.phone,
        args.addressLine, args.city, args.postalCode,
      ].some((v) => v !== undefined);
      if (contactFieldChanged && info.lead?.ghlContactId) {
        await ghlRequest(`/contacts/${encodeURIComponent(info.lead.ghlContactId)}`, {
          method: "PUT",
          body: {
            ...(args.firstName !== undefined ? { firstName: args.firstName ?? undefined } : {}),
            ...(args.lastName !== undefined ? { lastName: args.lastName ?? undefined } : {}),
            ...(args.email !== undefined ? { email: args.email ?? undefined } : {}),
            ...(args.phone !== undefined ? { phone: args.phone ?? undefined } : {}),
            ...(args.addressLine !== undefined ? { address1: args.addressLine ?? undefined } : {}),
            ...(args.city !== undefined ? { city: args.city ?? undefined } : {}),
            ...(args.postalCode !== undefined ? { postalCode: args.postalCode ?? undefined } : {}),
          },
        });
      }
      if (info.rdv.ghlEventId && (args.scheduledAt !== undefined || args.notes !== undefined)) {
        await ghlRequest(`/calendars/events/appointments/${encodeURIComponent(info.rdv.ghlEventId)}`, {
          method: "PUT",
          body: {
            ...(args.scheduledAt !== undefined
              ? { startTime: new Date(args.scheduledAt).toISOString() }
              : {}),
            ...(args.notes !== undefined ? { notes: args.notes ?? "" } : {}),
          },
        });
      }
    }

    await ctx.runMutation(internal.ghlAppointments.applyAppointmentUpdate, args);
    return { ok: true };
  },
});
