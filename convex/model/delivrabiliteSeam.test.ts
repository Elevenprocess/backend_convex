import { expect, test } from "vitest";
import { makeT } from "../test.kit";
import { isJalonReached, clientStatusGlobal } from "./delivrabiliteSeam";
import { ensureDossier } from "./ensureDossier";

// ─── Helpers de seed ─────────────────────────────────────────────────────────

async function seedLead(t: ReturnType<typeof makeT>) {
  return t.run((ctx: any) =>
    ctx.db.insert("leads", { source: "manual", status: "qualifie", firstName: "S" }),
  );
}

async function seedProject(t: ReturnType<typeof makeT>, leadId: any) {
  const comId = await t.run((ctx: any) =>
    ctx.db.insert("users", { email: "c@ecoi.fr", name: "C", role: "commercial", active: true }),
  );
  return t.run((ctx: any) =>
    ctx.db.insert("projects", { leadId, commercialId: comId, name: "P", status: "signe" }),
  );
}

async function markSubstepFait(
  t: ReturnType<typeof makeT>,
  clientId: any,
  key: string,
) {
  await t.run(async (ctx: any) => {
    const sub = await ctx.db
      .query("workflowSubsteps")
      .withIndex("by_client_key", (q: any) => q.eq("clientId", clientId).eq("key", key))
      .first();
    await ctx.db.patch(sub._id, { status: "fait" });
  });
}

// ─── isJalonReached ──────────────────────────────────────────────────────────

test("signature toujours atteint (même sans dossier)", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    expect(await isJalonReached(ctx, { jalonKey: "signature" })).toBe(true);
  });
});

test("jalonKey null → false", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    expect(await isJalonReached(ctx, { jalonKey: null })).toBe(false);
  });
});

test("sans dossier → jalons workflow non atteints", async () => {
  const t = makeT();
  const leadId = await seedLead(t);
  await t.run(async (ctx: any) => {
    expect(await isJalonReached(ctx, { leadId, jalonKey: "vt_validee" })).toBe(false);
    expect(await isJalonReached(ctx, { leadId, jalonKey: "install_effectuee" })).toBe(false);
  });
});

test("substep vt_validee fait → jalon atteint (dossier par projet)", async () => {
  const t = makeT();
  const leadId = await seedLead(t);
  const projectId = await seedProject(t, leadId);
  const clientId = await t.run((ctx: any) => ensureDossier(ctx, { leadId, projectId }));
  await markSubstepFait(t, clientId, "vt_validee");

  await t.run(async (ctx: any) => {
    expect(await isJalonReached(ctx, { projectId, leadId, jalonKey: "vt_validee" })).toBe(true);
    // Les autres jalons du dossier restent non atteints
    expect(await isJalonReached(ctx, { projectId, leadId, jalonKey: "install_effectuee" })).toBe(false);
  });
});

test("dossier scopé au lead (sans projet) : jalon lu via by_lead", async () => {
  const t = makeT();
  const leadId = await seedLead(t);
  const clientId = await t.run((ctx: any) => ensureDossier(ctx, { leadId }));
  await markSubstepFait(t, clientId, "racco_validee");

  await t.run(async (ctx: any) => {
    expect(await isJalonReached(ctx, { leadId, jalonKey: "racco_validee" })).toBe(true);
  });
});

test("dossier supprimé → jalon non atteint", async () => {
  const t = makeT();
  const leadId = await seedLead(t);
  const projectId = await seedProject(t, leadId);
  const clientId = await t.run((ctx: any) => ensureDossier(ctx, { leadId, projectId }));
  await markSubstepFait(t, clientId, "vt_validee");
  await t.run((ctx: any) => ctx.db.patch(clientId, { deletedAt: 1_000 }));

  await t.run(async (ctx: any) => {
    expect(await isJalonReached(ctx, { projectId, leadId, jalonKey: "vt_validee" })).toBe(false);
  });
});

// ─── clientStatusGlobal ──────────────────────────────────────────────────────

test("clientStatusGlobal null sans dossier", async () => {
  const t = makeT();
  const leadId = await seedLead(t);
  await t.run(async (ctx: any) => {
    expect(await clientStatusGlobal(ctx, {})).toBeNull();
    expect(await clientStatusGlobal(ctx, { leadId })).toBeNull();
  });
});

test("clientStatusGlobal renvoie le statut du dossier actif", async () => {
  const t = makeT();
  const leadId = await seedLead(t);
  const projectId = await seedProject(t, leadId);
  await t.run((ctx: any) => ensureDossier(ctx, { leadId, projectId }));

  await t.run(async (ctx: any) => {
    expect(await clientStatusGlobal(ctx, { projectId, leadId })).toBe("vt_a_faire");
  });
});

test("dossier annulé → clientStatusGlobal 'annule'", async () => {
  const t = makeT();
  const leadId = await seedLead(t);
  const projectId = await seedProject(t, leadId);
  const clientId = await t.run((ctx: any) => ensureDossier(ctx, { leadId, projectId }));
  await t.run((ctx: any) => ctx.db.patch(clientId, { statusGlobal: "annule" }));

  await t.run(async (ctx: any) => {
    expect(await clientStatusGlobal(ctx, { projectId, leadId })).toBe("annule");
  });
});
