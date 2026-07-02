import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function seed(t: any) {
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "s@ecoi.fr" });
  const finId = await insertUser(t, { role: "finances", email: "f@ecoi.fr" });
  const leadId = await asUser(t, comId).mutation(api.leads.create, { firstName: "Test" });
  return { comId, setterId, finId, leadId };
}

test("getAcompte assemble le débrief", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);
  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });
  const result = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });
  expect(result).not.toBeNull();
  expect(result!.debriefId).toBe(debriefId);
  expect(result!.montantTotal).toBe(15000);
  expect(result!.echeances.length).toBeGreaterThan(0);
});

test("getAcompte lève une erreur si le débrief est introuvable", async () => {
  const t = makeT();
  const { finId } = await seed(t);
  // Crée un ID fictif en insérant puis supprimant un document
  const comId2 = await insertUser(t, { role: "commercial", email: "c2@ecoi.fr" });
  const lead2Id = await asUser(t, comId2).mutation(api.leads.create, { firstName: "B" });
  const debriefId = await asUser(t, comId2).mutation(api.debriefs.createForLead, {
    leadId: lead2Id,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });
  await asUser(t, comId2).mutation(api.debriefs.softDelete, { debriefId });
  await expect(
    asUser(t, finId).query(api.payments.getAcompte, { debriefId, today: "2026-07-01" }),
  ).rejects.toThrow(/introuvable/);
});

test("listAcomptes filtre les ventes (exclut non-vente)", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  // Vente avec montant → doit apparaître
  const venteId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  // Non-vente → ne doit PAS apparaître
  const lead2Id = await asUser(t, comId).mutation(api.leads.create, { firstName: "B" });
  await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId: lead2Id,
    outcome: "non_vente",
    nonSaleReason: "pas_interesse",
  });

  const results = await asUser(t, finId).query(api.payments.listAcomptes, {
    today: "2026-07-01",
  });
  const ids = results.map((r: any) => r.debriefId);
  expect(ids).toContain(venteId);
  // Le non_vente ne doit pas apparaître
  expect(results.every((r: any) => r.echeances !== undefined)).toBe(true);
});

test("listAcomptes exclut les débriefs vente supprimés", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);
  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });
  await asUser(t, comId).mutation(api.debriefs.softDelete, { debriefId });
  const results = await asUser(t, finId).query(api.payments.listAcomptes, {
    today: "2026-07-01",
  });
  expect(results.map((r: any) => r.debriefId)).not.toContain(debriefId);
});

test("listAcomptes exclut les ventes sans montant (montantTotal=0, acompteAmount absent)", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);
  // Vente sans montantTotal ni acompteAmount
  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
  });
  const results = await asUser(t, finId).query(api.payments.listAcomptes, {
    today: "2026-07-01",
  });
  expect(results.map((r: any) => r.debriefId)).not.toContain(debriefId);
});

test("listAcomptes refusé pour setter", async () => {
  const t = makeT();
  const { setterId } = await seed(t);
  await expect(
    asUser(t, setterId).query(api.payments.listAcomptes, { today: "2026-07-01" }),
  ).rejects.toThrow();
});

test("getAcompte refusé pour setter", async () => {
  const t = makeT();
  const { comId, setterId, leadId } = await seed(t);
  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });
  await expect(
    asUser(t, setterId).query(api.payments.getAcompte, {
      debriefId,
      today: "2026-07-01",
    }),
  ).rejects.toThrow();
});
