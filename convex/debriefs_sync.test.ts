import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

test("débrief non_vente après une vente → dossier annulé ; re-vente → réactivé", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await asUser(t, comId).mutation(api.leads.create, { firstName: "S" });
  await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });
  // 2e débrief : vente perdue
  await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "non_vente",
    nonSaleReason: "pas_interesse",
  });
  let clients = await t.run((ctx: any) => ctx.db.query("clients").collect());
  expect(clients).toHaveLength(1);
  expect(clients[0].statusGlobal).toBe("annule");
  // 3e débrief : vente à nouveau → réactivation + données à jour
  await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 11000,
    financingType: "comptant",
  });
  clients = await t.run((ctx: any) => ctx.db.query("clients").collect());
  expect(clients).toHaveLength(1);
  expect(clients[0].statusGlobal).toBe("vt_a_faire");
  expect(clients[0].montantTotal).toBe(11000);
});

test("debriefs.update vers non_vente annule aussi le dossier", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await asUser(t, comId).mutation(api.leads.create, { firstName: "S" });
  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });
  await asUser(t, comId).mutation(api.debriefs.update, {
    debriefId,
    outcome: "non_vente",
    nonSaleReason: "pas_interesse",
  });
  const clients = await t.run((ctx: any) => ctx.db.query("clients").collect());
  expect(clients[0].statusGlobal).toBe("annule");
});

test("débrief en_reflexion (état intermédiaire) ne touche pas le dossier", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await asUser(t, comId).mutation(api.leads.create, { firstName: "S" });
  await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });
  await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "en_reflexion",
    reflexionReason: "comparer_concurrence",
  });
  const clients = await t.run((ctx: any) => ctx.db.query("clients").collect());
  expect(clients[0].statusGlobal).toBe("vt_a_faire"); // intact
});
