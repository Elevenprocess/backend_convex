import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { ensureDossier } from "./model/ensureDossier";

async function seed(t: ReturnType<typeof makeT>) {
  const boId = await insertUser(t, { role: "back_office" });
  const tech1 = await insertUser(t, { role: "technicien", email: "t1@e.fr", name: "Tech Un" });
  const tech2 = await insertUser(t, { role: "technicien", email: "t2@e.fr", name: "Tech Deux" });
  const leadId = await t.run((ctx: any) =>
    ctx.db.insert("leads", {
      source: "manual",
      status: "signe",
      firstName: "Sophie",
      lastName: "Martin",
      city: "Lyon",
    }),
  );
  const clientId = await t.run((ctx: any) => ensureDossier(ctx, { leadId }));
  return { boId, tech1, tech2, leadId, clientId };
}

async function junction(t: ReturnType<typeof makeT>, clientId: any) {
  return t.run((ctx: any) =>
    ctx.db.query("vtTechniciens").withIndex("by_client", (q: any) => q.eq("clientId", clientId)).collect(),
  );
}

test("assignation multi : jonction remplacée, scalaire = premier, notifs aux nouveaux", async () => {
  const t = makeT();
  const { boId, tech1, tech2, clientId } = await seed(t);
  const res = await asUser(t, boId).mutation(api.clients.assignTechniciens, {
    clientId,
    technicienVtIds: [tech1, tech2],
  });
  expect(res.techniciens.map((x: any) => x.id)).toEqual([tech1, tech2]);
  expect(res.technicienVtId).toBe(tech1); // scalaire back-compat
  expect(await junction(t, clientId)).toHaveLength(2);
  const notifs = await t.run((ctx: any) => ctx.db.query("notifications").collect());
  expect(notifs.filter((n: any) => n.type === "vt_assigned")).toHaveLength(2);
  expect(notifs[0].body).toBe("Sophie Martin — Lyon");
});

test("ré-assignation : seuls les NOUVEAUX sont notifiés", async () => {
  const t = makeT();
  const { boId, tech1, tech2, clientId } = await seed(t);
  await asUser(t, boId).mutation(api.clients.assignTechniciens, { clientId, technicienVtIds: [tech1] });
  await asUser(t, boId).mutation(api.clients.assignTechniciens, {
    clientId,
    technicienVtIds: [tech1, tech2],
  });
  const notifs = await t.run((ctx: any) => ctx.db.query("notifications").collect());
  const byUser = notifs.filter((n: any) => n.type === "vt_assigned").map((n: any) => n.userId);
  expect(byUser.filter((u: any) => u === tech1)).toHaveLength(1); // pas re-notifié
  expect(byUser.filter((u: any) => u === tech2)).toHaveLength(1);
});

test("désassignation : set vide → scalaire effacé, jonction vidée, aucune notif", async () => {
  const t = makeT();
  const { boId, tech1, clientId } = await seed(t);
  await asUser(t, boId).mutation(api.clients.assignTechniciens, { clientId, technicienVtIds: [tech1] });
  const before = (await t.run((ctx: any) => ctx.db.query("notifications").collect())).length;
  const res = await asUser(t, boId).mutation(api.clients.assignTechniciens, {
    clientId,
    technicienVtIds: [],
  });
  expect(res.technicienVtId).toBeUndefined();
  expect(await junction(t, clientId)).toHaveLength(0);
  expect(await t.run((ctx: any) => ctx.db.query("notifications").collect())).toHaveLength(before);
});

test("scalaire back-compat : technicienVtId seul fourni", async () => {
  const t = makeT();
  const { boId, tech1, clientId } = await seed(t);
  const res = await asUser(t, boId).mutation(api.clients.assignTechniciens, {
    clientId,
    technicienVtId: tech1,
  });
  expect(res.technicienVtId).toBe(tech1);
  expect(await junction(t, clientId)).toHaveLength(1);
});

test("rôles refusés (technicien, commercial) et dossier supprimé → throw", async () => {
  const t = makeT();
  const { boId, tech1, clientId } = await seed(t);
  const comId = await insertUser(t, { role: "commercial", email: "c@e.fr" });
  await expect(
    asUser(t, tech1).mutation(api.clients.assignTechniciens, { clientId, technicienVtIds: [tech1] }),
  ).rejects.toThrow(/attribuer/);
  await expect(
    asUser(t, comId).mutation(api.clients.assignTechniciens, { clientId, technicienVtIds: [tech1] }),
  ).rejects.toThrow(/Accès refusé|attribuer/);
  await t.run((ctx: any) => ctx.db.patch(clientId, { deletedAt: 1000 }));
  await expect(
    asUser(t, boId).mutation(api.clients.assignTechniciens, { clientId, technicienVtIds: [tech1] }),
  ).rejects.toThrow(/introuvable/);
});
