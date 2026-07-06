import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { mapRdvResultToGhlAppointmentStatus } from "./ghlDebriefLink";

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-06T12:00:00Z");

describe("mapRdvResultToGhlAppointmentStatus", () => {
  it("matrice complète", () => {
    expect(mapRdvResultToGhlAppointmentStatus("signe", "honore")).toBe("confirmed");
    expect(mapRdvResultToGhlAppointmentStatus("no_show", "planifie")).toBe("noshow");
    expect(mapRdvResultToGhlAppointmentStatus(undefined, "no_show")).toBe("noshow");
    expect(mapRdvResultToGhlAppointmentStatus("reporte", "planifie")).toBe("cancelled");
    expect(mapRdvResultToGhlAppointmentStatus(undefined, "reporte")).toBe("cancelled");
    expect(mapRdvResultToGhlAppointmentStatus("perdu", "honore")).toBe("showed");
    expect(mapRdvResultToGhlAppointmentStatus("reflexion", "honore")).toBe("showed");
    expect(mapRdvResultToGhlAppointmentStatus(undefined, "planifie")).toBeUndefined();
  });
});

describe("dueRdvForBackfill", () => {
  it("filtre RDV éligibles (à pousser) et exclut le reste", async () => {
    const t = makeT();
    const leadOk = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "qualifie", externalId: "contact-1" }));
    const leadNoExt = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "qualifie" }));
    const leadDel = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "qualifie", externalId: "c-del", deletedAt: 1 }));
    const base = { leadId: leadOk, locationType: "domicile" as const, status: "planifie" as const, externalId: "evt-ok", scheduledAt: NOW + DAY };
    const okId = await t.run((ctx) => ctx.db.insert("rdv", base));
    await t.run((ctx) => ctx.db.insert("rdv", { ...base, externalId: "evt-filled", debriefFilledAt: NOW }));       // déjà débriefé
    await t.run((ctx) => ctx.db.insert("rdv", { ...base, externalId: "evt-due", debriefDueAt: NOW }));               // déjà poussé
    await t.run((ctx) => ctx.db.insert("rdv", { ...base, externalId: undefined }));                                   // sans externalId
    await t.run((ctx) => ctx.db.insert("rdv", { ...base, leadId: leadNoExt, externalId: "evt-lead-noext" }));         // lead sans externalId
    await t.run((ctx) => ctx.db.insert("rdv", { ...base, leadId: leadDel, externalId: "evt-lead-del" }));             // lead supprimé
    await t.run((ctx) => ctx.db.insert("rdv", { ...base, externalId: "evt-far", scheduledAt: NOW + 100 * DAY }));     // hors fenêtre
    const rows = await t.query(internal.ghlDebriefLink.dueRdvForBackfill, { fromMs: NOW - DAY, toMs: NOW + 45 * DAY, limit: 20 });
    expect(rows).toEqual([{ rdvId: okId, contactExternalId: "contact-1" }]);
  });
});

describe("markDebriefDuePushed / rdvForDebriefPush", () => {
  it("marque debriefDueAt et relit le RDV pour le push", async () => {
    const t = makeT();
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "qualifie", externalId: "c" }));
    const rdvId = await t.run((ctx) => ctx.db.insert("rdv", { leadId, locationType: "domicile", status: "honore", externalId: "evt", result: "signe" }));
    await t.mutation(internal.ghlDebriefLink.markDebriefDuePushed, { rdvId, now: NOW });
    expect((await t.run((ctx) => ctx.db.get(rdvId)))?.debriefDueAt).toBe(NOW);
    expect(await t.query(internal.ghlDebriefLink.rdvForDebriefPush, { rdvId })).toEqual({ externalId: "evt", result: "signe", status: "honore" });
    const del = await t.run((ctx) => ctx.db.insert("rdv", { leadId, locationType: "domicile", status: "annule", deletedAt: 1 }));
    expect(await t.query(internal.ghlDebriefLink.rdvForDebriefPush, { rdvId: del })).toBeNull();
  });
});
