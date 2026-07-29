import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function seed(t: ReturnType<typeof makeT>) {
  const adminId = await insertUser(t, { role: "admin" });
  const c1 = await insertUser(t, { role: "commercial", email: "c1@e.fr" });
  const c2 = await insertUser(t, { role: "commercial", email: "c2@e.fr" });
  const leadId = await asUser(t, c1).mutation(api.leads.create, { firstName: "S" });
  // 2 ventes (c1), 1 non-vente (c1), 1 réflexion (c2)
  await asUser(t, c1).mutation(api.debriefs.createForLead, {
    leadId, outcome: "vente", montantTotal: 1000, financingType: "comptant",
    acceptanceFactors: ["prix", "confiance"],
  });
  await asUser(t, c1).mutation(api.debriefs.createForLead, {
    leadId, outcome: "vente", montantTotal: 2000, financingType: "comptant",
    acceptanceFactors: ["prix"],
  });
  await asUser(t, c1).mutation(api.debriefs.createForLead, {
    leadId, outcome: "non_vente", nonSaleReason: "pas_interesse",
  });
  await asUser(t, c2).mutation(api.debriefs.createForLead, {
    leadId, outcome: "en_reflexion", reflexionReason: "comparer_concurrence",
  });
  return { adminId, c1, c2, leadId };
}

test("debriefStats : répartition issues + facteurs + motifs (vue équipe admin)", async () => {
  const t = makeT();
  const { adminId } = await seed(t);
  const res = await asUser(t, adminId).query(api.analytics.debriefStats, {});
  expect(res.total).toBe(4);
  expect(res.outcomeCounts).toEqual({ vente: 2, non_vente: 1, en_reflexion: 1, suivi_prevu: 0 });
  expect(res.acceptanceFactorCounts).toEqual({ prix: 2, confiance: 1 });
  expect(res.nonSaleReasonCounts).toEqual({ pas_interesse: 1 });
});

test("debriefStats : commercial forcé sur SES débriefs même s'il demande un autre id", async () => {
  const t = makeT();
  const { c1, c2 } = await seed(t);
  const res = await asUser(t, c2).query(api.analytics.debriefStats, { commercialId: c1 });
  expect(res.total).toBe(1); // seulement son en_reflexion
  expect(res.outcomeCounts.en_reflexion).toBe(1);
  expect(res.outcomeCounts.vente).toBe(0);
});

test("debriefStats : un débrief lié à un RDV est daté du RDV, pas du débrief", async () => {
  const t = makeT();
  const { adminId, c1, leadId } = await seed(t);
  // RDV du 10/03, débriefé « aujourd'hui » (createdAt = now du test)
  const rdvDay = new Date("2026-03-10T14:00:00.000Z").getTime();
  const rdvId = await asUser(t, c1).mutation(api.rdv.create, {
    leadId, commercialId: c1, scheduledAt: rdvDay,
  });
  await asUser(t, c1).mutation(api.debriefs.createForLead, {
    leadId, rdvId, outcome: "vente", montantTotal: 3000, financingType: "comptant",
    acceptanceFactors: ["roi"],
  });
  // Fenêtre du jour du RDV → le débrief compte ce jour-là
  const onRdvDay = await asUser(t, adminId).query(api.analytics.debriefStats, {
    from: "2026-03-10T00:00:00.000Z",
    to: "2026-03-11T00:00:00.000Z",
  });
  expect(onRdvDay.total).toBe(1);
  expect(onRdvDay.acceptanceFactorCounts).toEqual({ roi: 1 });
  // Fenêtre autour de la date de création du débrief → il n'y compte pas
  const now = Date.now();
  const onDebriefDay = await asUser(t, adminId).query(api.analytics.debriefStats, {
    from: new Date(now - 3_600_000).toISOString(),
    to: new Date(now + 3_600_000).toISOString(),
  });
  expect(onDebriefDay.outcomeCounts.vente).toBe(2); // les 2 ventes sans RDV du seed, pas celle-ci
  expect(onDebriefDay.acceptanceFactorCounts.roi).toBeUndefined();
});

test("debriefStats : filtre from/to et rôle refusé (setter)", async () => {
  const t = makeT();
  const { adminId } = await seed(t);
  // Fenêtre entièrement passée → 0
  const res = await asUser(t, adminId).query(api.analytics.debriefStats, {
    from: "2020-01-01T00:00:00.000Z",
    to: "2020-01-02T00:00:00.000Z",
  });
  expect(res.total).toBe(0);
  const setterId = await insertUser(t, { role: "setter", email: "s@e.fr" });
  await expect(asUser(t, setterId).query(api.analytics.debriefStats, {})).rejects.toThrow(/Accès refusé/);
});
