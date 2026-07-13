// ─── Alertes & blocage d'acomptes côté délivrabilité ─────────────────────────
// Le workflow est relié à l'échéancier finances : jalon franchi → notification
// par tranche ; jalon suivant BLOQUÉ tant que la tranche précédente due n'est
// pas encaissée (finances/admin passent outre) ; cron de relance dédupliqué.

import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

// Dossier signé comptant : template standard 40 % (vt_validee), 20 % (dp
// envoyée), 20 % (install à faire), 20 % (install effectuée).
async function seed(t: ReturnType<typeof makeT>) {
  const com = await insertUser(t, { role: "commercial", email: "c@e.fr" });
  const deliv = await insertUser(t, { role: "delivrabilite", email: "d@e.fr" });
  const fin = await insertUser(t, { role: "finances", email: "f@e.fr" });
  const admin = await insertUser(t, { role: "admin", email: "a@e.fr" });
  const leadId = await asUser(t, com).mutation(api.leads.create, { firstName: "Paul", lastName: "Client" });
  const debriefId = await asUser(t, com).mutation(api.debriefs.createForLead, {
    leadId, outcome: "vente", montantTotal: 10000, financingType: "comptant",
  });
  // createForLead(vente) bootstrape projet + dossier délivrabilité.
  const client = (await t.run((ctx) => ctx.db.query("clients").collect()))[0];
  const substeps = await t.run((ctx) => ctx.db.query("workflowSubsteps").collect());
  const byKey = Object.fromEntries(substeps.map((s) => [s.key, s._id]));
  return { com, deliv, fin, admin, leadId, debriefId, clientId: client._id, byKey };
}

test("jalon franchi → notification finances avec la tranche et le montant", async () => {
  const t = makeT();
  const { deliv, fin, byKey } = await seed(t);
  // VT : planifiée + attribuée puis validée (prérequis catalogue ignorés au niveau db ;
  // update passe par la mutation → la validation vt_validee déclenche la notif 40 %).
  await asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["vt_planifie"], status: "fait" });
  await asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["vt_attribuee"], status: "fait" });
  await asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["vt_validee"], status: "fait" });

  const notifs = await t.run((ctx) => ctx.db.query("notifications").collect());
  const acompte = notifs.filter((n) => n.type === "acompte_a_encaisser");
  expect(acompte.length).toBeGreaterThan(0);
  expect(acompte[0].title).toMatch(/4[\s\u202f]000/);
  expect((acompte[0].body ?? "")).toContain("Paul Client");
});

test("blocage : dp_envoyee_mairie refusée tant que la tranche VT (40 %) n'est pas encaissée", async () => {
  const t = makeT();
  const { deliv, fin, admin, debriefId, byKey } = await seed(t);
  await asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["vt_planifie"], status: "fait" });
  await asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["vt_attribuee"], status: "fait" });
  await asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["vt_validee"], status: "fait" });

  // Délivrabilité bloquée sur le jalon suivant (dp_envoyee_mairie = tranche 2).
  await expect(
    asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["dp_envoyee_mairie"], status: "fait" }),
  ).rejects.toThrow(/acompte.*n'est pas encaissé/i);

  // Encaissement de la tranche 1 → l'étape passe.
  await asUser(t, fin).mutation(api.payments.recordEcheance, {
    debriefId, ordre: 1, statut: "encaisse", montantReel: 4000, dateEncaissement: "2026-07-13",
  });
  await asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["dp_envoyee_mairie"], status: "fait" });
  const sub = await t.run((ctx) => ctx.db.get(byKey["dp_envoyee_mairie"]));
  expect(sub?.status).toBe("fait");
});

test("admin passe outre le blocage ; étape sans tranche jamais bloquée", async () => {
  const t = makeT();
  const { deliv, admin, byKey } = await seed(t);
  await asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["vt_planifie"], status: "fait" });
  await asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["vt_attribuee"], status: "fait" });
  await asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["vt_validee"], status: "fait" });

  // dp_validee n'est pas un jalon du template comptant → jamais bloquée.
  await asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["dp_validee"], status: "fait" });
  // admin force le jalon suivant malgré la tranche 1 impayée.
  await asUser(t, admin).mutation(api.workflowSubsteps.update, { substepId: byKey["dp_envoyee_mairie"], status: "fait" });
  const sub = await t.run((ctx) => ctx.db.get(byKey["dp_envoyee_mairie"]));
  expect(sub?.status).toBe("fait");
});

test("relances cron : notifie les tranches dues puis déduplique 3 jours", async () => {
  const t = makeT();
  const { deliv, byKey } = await seed(t);
  await asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["vt_planifie"], status: "fait" });
  await asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["vt_attribuee"], status: "fait" });
  await asUser(t, deliv).mutation(api.workflowSubsteps.update, { substepId: byKey["vt_validee"], status: "fait" });
  const before = (await t.run((ctx) => ctx.db.query("notifications").collect())).length;

  const r1 = await t.mutation(internal.acompteReminders.run, {});
  expect(r1.reminded).toBeGreaterThan(0);
  const r2 = await t.mutation(internal.acompteReminders.run, {});
  expect(r2.reminded).toBe(0); // dédup 3 jours
  const after = (await t.run((ctx) => ctx.db.query("notifications").collect())).length;
  expect(after).toBeGreaterThan(before);
});
