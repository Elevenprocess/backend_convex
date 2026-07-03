import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { ensureDossier } from "./model/ensureDossier";

async function seedDossier(t: ReturnType<typeof makeT>, opts: { assignedToId?: any } = {}) {
  const leadId = await t.run((ctx: any) =>
    ctx.db.insert("leads", {
      source: "manual",
      status: "signe",
      firstName: "S",
      ...(opts.assignedToId ? { assignedToId: opts.assignedToId } : {}),
    }),
  );
  const clientId = await t.run((ctx: any) => ensureDossier(ctx, { leadId }));
  return { leadId, clientId };
}

test("scoping technicien : VT attribuée OU responsable d'une étape installation", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const techId = await insertUser(t, { role: "technicien", email: "t@e.fr" });
  const viaVt = await seedDossier(t);
  const viaInstall = await seedDossier(t);
  const hidden = await seedDossier(t);
  await asUser(t, boId).mutation(api.clients.assignTechniciens, {
    clientId: viaVt.clientId,
    technicienVtIds: [techId],
  });
  await t.run(async (ctx: any) => {
    const step = await ctx.db
      .query("workflowSteps")
      .withIndex("by_client_phase", (q: any) =>
        q.eq("clientId", viaInstall.clientId).eq("phase", "installation"),
      )
      .first();
    await ctx.db.patch(step._id, { responsableId: techId });
  });
  const rows = await asUser(t, techId).query(api.clients.list, {});
  expect(new Set(rows.map((r: any) => r._id))).toEqual(
    new Set([viaVt.clientId, viaInstall.clientId]),
  );
  expect(rows.map((r: any) => r._id)).not.toContain(hidden.clientId);
});

test("scoping commercial : ses leads seulement ; commercial_lead tout", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const clId = await insertUser(t, { role: "commercial_lead", email: "cl@e.fr" });
  const mine = await seedDossier(t, { assignedToId: comId });
  await seedDossier(t);
  const rows = await asUser(t, comId).query(api.clients.list, {});
  expect(rows.map((r: any) => r._id)).toEqual([mine.clientId]);
  expect(await asUser(t, clId).query(api.clients.list, {})).toHaveLength(2);
});

test("filtres technicienVtId / unassignedVt + décor techniciens", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const techId = await insertUser(t, { role: "technicien", email: "t@e.fr", name: "Tech Un" });
  const assigned = await seedDossier(t);
  const unassigned = await seedDossier(t);
  await asUser(t, boId).mutation(api.clients.assignTechniciens, {
    clientId: assigned.clientId,
    technicienVtIds: [techId],
  });
  const byTech = await asUser(t, boId).query(api.clients.list, { technicienVtId: techId });
  expect(byTech.map((r: any) => r._id)).toEqual([assigned.clientId]);
  expect(byTech[0].techniciens).toEqual([{ id: techId, name: "Tech Un" }]);
  const noVt = await asUser(t, boId).query(api.clients.list, { unassignedVt: true });
  expect(noVt.map((r: any) => r._id)).toEqual([unassigned.clientId]);
  const one = await asUser(t, boId).query(api.clients.getByLead, { leadId: assigned.leadId });
  expect(one!.techniciens).toEqual([{ id: techId, name: "Tech Un" }]);
});
