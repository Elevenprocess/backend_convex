import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";

const NOW = Date.parse("2026-07-05T12:00:00Z");
const FUTURE_ISO = "2026-07-20T09:00:00.000Z";
const PAST_ISO = "2026-06-20T09:00:00.000Z";

const baseEvent = { id: "evt1", calendarId: "cal1", startTime: FUTURE_ISO };

function persist(t: ReturnType<typeof makeT>, events: unknown[]) {
  return t.mutation(internal.ghlCalendar.persistGhlEvents, { events: events as never, now: NOW });
}

describe("persistGhlEvents", () => {
  it("event sans contactId ni lead → skipped ; sans id/startTime → skipped", async () => {
    const t = makeT();
    const r = await persist(t, [
      baseEvent,                                    // pas de contactId → pas de lead → skipped
      { ...baseEvent, id: "", contactId: "c1" },    // id vide → skipped
    ]);
    expect(r).toEqual({ created: 0, updated: 0, skipped: 2 });
  });

  it("création : lead absent → lead qualifie créé depuis l'event + RDV domicile", async () => {
    const t = makeT();
    const commercialId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "c@e.fr", name: "Paul", role: "commercial", active: true }),
    );
    const r = await persist(t, [{
      ...baseEvent, contactId: "c1", status: "confirmed", commercialId,
      contactName: "Jean Payet", contactPhone: "0692", sector: "ouest",
    }]);
    expect(r.created).toBe(1);
    const [lead] = await t.run((ctx) => ctx.db.query("leads").collect());
    expect(lead).toMatchObject({
      externalId: "c1", source: "ghl", status: "qualifie",
      firstName: "Jean", lastName: "Payet", phone: "0692", assignedToId: commercialId,
    });
    const [rdv] = await t.run((ctx) => ctx.db.query("rdv").collect());
    expect(rdv).toMatchObject({
      externalId: "evt1", leadId: lead._id, commercialId,
      scheduledAt: Date.parse(FUTURE_ISO), locationType: "domicile", status: "planifie",
    });
    expect(rdv.notes).toContain("RDV synchronisé depuis GHL");
    expect(rdv.debriefDueAt).toBeUndefined(); // seam 8c : pas de push lien débrief
  });

  it("création : lead existant patché (identité) + repassé qualifie avec commercial", async () => {
    const t = makeT();
    const commercialId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "c@e.fr", role: "commercial", active: true }),
    );
    const leadId = await t.run((ctx) =>
      ctx.db.insert("leads", { source: "ghl", status: "perdu", externalId: "c1", firstName: "Ancien" }),
    );
    await persist(t, [{ ...baseEvent, contactId: "c1", commercialId, contactFirstName: "Nouveau" }]);
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead).toMatchObject({ firstName: "Nouveau", status: "qualifie", assignedToId: commercialId });
    expect(await t.run((ctx) => ctx.db.query("rdv").collect())).toHaveLength(1);
  });

  it("update simple : date/statut/notes re-synchronisés", async () => {
    const t = makeT();
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "rdv_pris", externalId: "c1" }));
    const rdvId = await t.run((ctx) =>
      ctx.db.insert("rdv", { externalId: "evt1", leadId, locationType: "domicile", status: "planifie", scheduledAt: Date.parse(PAST_ISO) }),
    );
    const r = await persist(t, [{ ...baseEvent, contactId: "c1", status: "noshow" }]);
    expect(r).toEqual({ created: 0, updated: 1, skipped: 0 });
    const row = await t.run((ctx) => ctx.db.get(rdvId));
    expect(row).toMatchObject({ status: "no_show", scheduledAt: Date.parse(FUTURE_ISO) });
  });

  it("patch sûr : debriefFilledAt posé → notes/result intacts, date/statut màj", async () => {
    const t = makeT();
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "rdv_pris", externalId: "c1" }));
    const rdvId = await t.run((ctx) =>
      ctx.db.insert("rdv", {
        externalId: "evt1", leadId, locationType: "domicile", status: "honore",
        scheduledAt: Date.parse(PAST_ISO), result: "signe", debriefFilledAt: NOW - 1000, notes: "Débrief manuel",
      }),
    );
    // même date (pas de reprogrammation) mais statut GHL différent
    await persist(t, [{ ...baseEvent, startTime: PAST_ISO, contactId: "c1", status: "showed", notes: "méta GHL" }]);
    const row = await t.run((ctx) => ctx.db.get(rdvId));
    expect(row).toMatchObject({ status: "honore", result: "signe", notes: "Débrief manuel" });
  });

  it("ré-armement : RDV clôturé déplacé vers le futur → planifie, result/debriefFilledAt effacés, notes AUTO purgées", async () => {
    const t = makeT();
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "rdv_pris", externalId: "c1" }));
    const rdvId = await t.run((ctx) =>
      ctx.db.insert("rdv", {
        externalId: "evt1", leadId, locationType: "domicile", status: "honore",
        scheduledAt: Date.parse(PAST_ISO), result: "reporte", debriefFilledAt: NOW - 1000,
        notes: "RDV synchronisé depuis GHL\nSecteur : ouest",
      }),
    );
    const r = await persist(t, [{ ...baseEvent, contactId: "c1", status: "confirmed" }]);
    expect(r.updated).toBe(1);
    const row = await t.run((ctx) => ctx.db.get(rdvId));
    expect(row).toMatchObject({ status: "planifie", scheduledAt: Date.parse(FUTURE_ISO) });
    expect(row?.result).toBeUndefined();
    expect(row?.debriefFilledAt).toBeUndefined();
    expect(row?.notes).toBeUndefined();
  });

  it("ré-armement : notes MANUELLES préservées", async () => {
    const t = makeT();
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "rdv_pris", externalId: "c1" }));
    const rdvId = await t.run((ctx) =>
      ctx.db.insert("rdv", {
        externalId: "evt1", leadId, locationType: "domicile", status: "honore",
        scheduledAt: Date.parse(PAST_ISO), debriefFilledAt: NOW - 1000, notes: "Vrai débrief inline",
      }),
    );
    await persist(t, [{ ...baseEvent, contactId: "c1" }]);
    expect((await t.run((ctx) => ctx.db.get(rdvId)))?.notes).toBe("Vrai débrief inline");
  });

  it("RDV soft-deleted ignoré → nouveau RDV créé pour le même externalId", async () => {
    const t = makeT();
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "rdv_pris", externalId: "c1" }));
    await t.run((ctx) =>
      ctx.db.insert("rdv", { externalId: "evt1", leadId, locationType: "domicile", status: "annule", deletedAt: 1 }),
    );
    const r = await persist(t, [{ ...baseEvent, contactId: "c1" }]);
    expect(r.created).toBe(1);
    expect(await t.run((ctx) => ctx.db.query("rdv").collect())).toHaveLength(2);
  });
});
