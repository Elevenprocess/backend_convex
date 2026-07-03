import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

// Dossier + débrief vente (financingType paramétrable) + destinataires finances/admin.
// Le débrief vente crée le dossier via le câblage 6a (ensureDossierForVente).
async function seed(t: ReturnType<typeof makeT>, financingType = "comptant") {
  const boId = await insertUser(t, { role: "back_office" });
  const finId = await insertUser(t, { role: "finances", email: "f@e.fr" });
  const adminId = await insertUser(t, { role: "admin", email: "a@e.fr" });
  const comId = await insertUser(t, { role: "commercial", email: "c@e.fr" });
  const leadId = await asUser(t, comId).mutation(api.leads.create, {
    firstName: "Sophie",
    lastName: "Martin",
  });
  await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: financingType as any,
  });
  const client = (await t.run((ctx: any) => ctx.db.query("clients").collect()))[0];
  const subs = await t.run((ctx: any) =>
    ctx.db.query("workflowSubsteps").withIndex("by_client", (q: any) => q.eq("clientId", client._id)).collect(),
  );
  const subByKey = Object.fromEntries(subs.map((s: any) => [s.key, s]));
  return { boId, finId, adminId, clientId: client._id, subByKey };
}

async function notifs(t: ReturnType<typeof makeT>) {
  return t.run((ctx: any) => ctx.db.query("notifications").collect());
}

test("SLA : dp_envoyee_mairie fait → deadline posée sur dp_validee ; dé-fait → effacée", async () => {
  const t = makeT();
  const { boId, subByKey } = await seed(t);
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.dp_envoyee_mairie._id,
    status: "fait",
    dateRealisee: "2026-07-01",
  });
  let target = await t.run((ctx: any) => ctx.db.get(subByKey.dp_validee._id));
  expect(target.deadline).toBe("2026-07-29");
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.dp_envoyee_mairie._id,
    status: "en_cours",
  });
  target = await t.run((ctx: any) => ctx.db.get(subByKey.dp_validee._id));
  expect(target.deadline).toBeUndefined();
});

test("vt_validee fait (comptant) → notif acompte 40% aux finances+admin", async () => {
  const t = makeT();
  const { boId, finId, adminId, subByKey } = await seed(t, "comptant");
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.vt_validee._id,
    status: "fait",
  });
  const rows = await notifs(t);
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((n: any) => n.userId))).toEqual(new Set([finId, adminId]));
  expect(rows[0].title).toBe("Acompte à encaisser (40 %)");
  expect(rows[0].body).toContain("Sophie Martin");
  // Idempotence de transition : re-save sans changement de statut ne renotifie pas
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.vt_validee._id,
    notes: "re-save",
  });
  expect(await notifs(t)).toHaveLength(2);
});

test("vt_validee fait (financement) → PAS de notif 40% ; install_effectuee → notif solde", async () => {
  const t = makeT();
  const { boId, subByKey } = await seed(t, "financement");
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.vt_validee._id,
    status: "fait",
  });
  expect(await notifs(t)).toHaveLength(0);
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.install_effectuee._id,
    status: "fait",
  });
  const rows = await notifs(t);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0].title).toBe("Solde à encaisser");
});

test("paiement_10x : aucun effet jalon", async () => {
  const t = makeT();
  const { boId, subByKey } = await seed(t, "paiement_10x");
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.vt_validee._id,
    status: "fait",
  });
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.install_effectuee._id,
    status: "fait",
  });
  expect(await notifs(t)).toHaveLength(0);
});

test("changement de date VT (vt_planifie) → notif au technicien assigné", async () => {
  const t = makeT();
  const { boId, clientId, subByKey } = await seed(t);
  const techId = await insertUser(t, { role: "technicien", email: "t@e.fr" });
  await t.run((ctx: any) => ctx.db.patch(clientId, { technicienVtId: techId }));
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.vt_planifie._id,
    dateRealisee: "2026-07-10",
  });
  const vtNotifs = (await notifs(t)).filter((n: any) => n.type === "vt_date_changed");
  expect(vtNotifs).toHaveLength(1);
  expect(vtNotifs[0].userId).toBe(techId);
  expect(vtNotifs[0].body).toContain("10/07/2026");
  // Même date re-sauvée → pas de nouvelle notif
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.vt_planifie._id,
    dateRealisee: "2026-07-10",
  });
  expect((await notifs(t)).filter((n: any) => n.type === "vt_date_changed")).toHaveLength(1);
});

test("sans technicien assigné : pas de notif date VT, mutation OK", async () => {
  const t = makeT();
  const { boId, subByKey } = await seed(t);
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.vt_planifie._id,
    dateRealisee: "2026-07-10",
  });
  expect((await notifs(t)).filter((n: any) => n.type === "vt_date_changed")).toHaveLength(0);
});
