import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { ensureDossier } from "./model/ensureDossier";

async function seed(t: ReturnType<typeof makeT>) {
  const boId = await insertUser(t, { role: "back_office" });
  const techId = await insertUser(t, { role: "technicien", email: "t@e.fr", name: "Tech Un" });
  const leadId = await t.run((ctx: any) =>
    ctx.db.insert("leads", {
      source: "manual",
      status: "signe",
      firstName: "Sophie",
      lastName: "Martin",
      city: "Lyon",
      phone: "0600000000",
    }),
  );
  const clientId = await t.run((ctx: any) => ensureDossier(ctx, { leadId }));
  const subs = await t.run((ctx: any) =>
    ctx.db.query("workflowSubsteps").withIndex("by_client", (q: any) => q.eq("clientId", clientId)).collect(),
  );
  const subByKey = Object.fromEntries(subs.map((s: any) => [s.key, s]));
  return { boId, techId, leadId, clientId, subByKey };
}

test("entrée vt : date/heure priorité vt_planifie, infos lead", async () => {
  const t = makeT();
  const { boId, subByKey } = await seed(t);
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.vt_planifie._id,
    dateRealisee: "2026-07-10",
    heure: "14:30",
  });
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.vt_attribuee._id,
    dateRealisee: "2026-07-01",
    heure: "09:00",
  });
  const entries = await asUser(t, boId).query(api.clients.vtCalendar, {});
  const vt = entries.filter((e: any) => e.kind === "vt");
  expect(vt).toHaveLength(1);
  expect(vt[0].date).toBe("2026-07-10");
  expect(vt[0].heure).toBe("14:30");
  expect(vt[0].leadName).toBe("Sophie Martin");
  expect(vt[0].city).toBe("Lyon");
  expect(vt[0].phone).toBe("0600000000");
});

test("filtre from/to exclut hors période", async () => {
  const t = makeT();
  const { boId, subByKey } = await seed(t);
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.vt_planifie._id,
    dateRealisee: "2026-07-10",
  });
  expect(await asUser(t, boId).query(api.clients.vtCalendar, { from: "2026-07-11" })).toHaveLength(0);
  expect(
    await asUser(t, boId).query(api.clients.vtCalendar, { from: "2026-07-01", to: "2026-07-31" }),
  ).toHaveLength(1);
});

test("entrée installation : datePlanifiee du step, visible ops ; technicien seulement si responsable", async () => {
  const t = makeT();
  const { boId, techId, clientId, subByKey } = await seed(t);
  // VT du dossier attribuée au technicien → dossier visible pour lui
  await asUser(t, boId).mutation(api.clients.assignTechniciens, {
    clientId,
    technicienVtIds: [techId],
  });
  // Planifier l'installation SANS responsable
  await t.run(async (ctx: any) => {
    const step = await ctx.db
      .query("workflowSteps")
      .withIndex("by_client_phase", (q: any) => q.eq("clientId", clientId).eq("phase", "installation"))
      .first();
    await ctx.db.patch(step._id, { datePlanifiee: "2026-07-20" });
  });
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.install_a_faire._id,
    heure: "08:00",
  });
  // Ops : voit l'installation
  const opsEntries = await asUser(t, boId).query(api.clients.vtCalendar, {});
  const install = opsEntries.filter((e: any) => e.kind === "installation");
  expect(install).toHaveLength(1);
  expect(install[0].date).toBe("2026-07-20");
  expect(install[0].heure).toBe("08:00");
  // Technicien : dossier visible (sa VT) mais installation d'un autre → masquée
  expect(
    (await asUser(t, techId).query(api.clients.vtCalendar, {})).filter(
      (e: any) => e.kind === "installation",
    ),
  ).toHaveLength(0);
  // Devient responsable de l'étape → visible
  await t.run(async (ctx: any) => {
    const step = await ctx.db
      .query("workflowSteps")
      .withIndex("by_client_phase", (q: any) => q.eq("clientId", clientId).eq("phase", "installation"))
      .first();
    await ctx.db.patch(step._id, { responsableId: techId });
  });
  const after = await asUser(t, techId).query(api.clients.vtCalendar, {});
  const afterInstall = after.filter((e: any) => e.kind === "installation");
  expect(afterInstall).toHaveLength(1);
  expect(afterInstall[0].technicienId).toBe(techId);
});
