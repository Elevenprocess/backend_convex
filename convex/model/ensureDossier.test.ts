import { expect, test } from "vitest";
import { makeT } from "../test.kit";
import { insertUser } from "../test.helpers";
import { ensureDossier, recomputePhase, recomputeClientStatus } from "./ensureDossier";

// ─── Helpers de seed ─────────────────────────────────────────────────────────

async function seedLead(t: ReturnType<typeof makeT>) {
  return t.run((ctx: any) =>
    ctx.db.insert("leads", {
      source: "manual",
      status: "qualifie",
      firstName: "Sophie",
      lastName: "Martin",
    }),
  );
}

async function seedProject(
  t: ReturnType<typeof makeT>,
  leadId: any,
  commercialId: any,
) {
  return t.run((ctx: any) =>
    ctx.db.insert("projects", {
      leadId,
      commercialId,
      name: "Projet Sophie",
      status: "signe",
    }),
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("crée 1 client + 6 workflowSteps + 12 workflowSubsteps tous a_faire", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await seedLead(t);
  const projectId = await seedProject(t, leadId, comId);

  const clientId = await t.run((ctx: any) =>
    ensureDossier(ctx, { leadId, projectId }),
  );

  // 1 client
  const clients = await t.run((ctx: any) =>
    ctx.db.query("clients").collect(),
  );
  expect(clients).toHaveLength(1);
  expect(clients[0]._id).toBe(clientId);

  // 6 workflowSteps
  const steps = await t.run((ctx: any) =>
    ctx.db
      .query("workflowSteps")
      .withIndex("by_client", (q: any) => q.eq("clientId", clientId))
      .collect(),
  );
  expect(steps).toHaveLength(6);
  expect(steps.every((s: any) => s.status === "a_faire")).toBe(true);

  // 12 workflowSubsteps
  const substeps = await t.run((ctx: any) =>
    ctx.db
      .query("workflowSubsteps")
      .withIndex("by_client", (q: any) => q.eq("clientId", clientId))
      .collect(),
  );
  expect(substeps).toHaveLength(12);
  expect(substeps.every((s: any) => s.status === "a_faire")).toBe(true);
});

test("après création statusGlobal='vt_a_faire', currentPhase='vt', blocked=false", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await seedLead(t);
  const projectId = await seedProject(t, leadId, comId);

  const clientId = await t.run((ctx: any) =>
    ensureDossier(ctx, { leadId, projectId }),
  );

  const client = await t.run((ctx: any) => ctx.db.get(clientId));
  expect(client.statusGlobal).toBe("vt_a_faire");
  expect(client.currentPhase).toBe("vt");
  expect(client.blocked).toBe(false);
});

test("idempotence par projectId : 2e appel ne recrée rien et met à jour champs vente", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await seedLead(t);
  const projectId = await seedProject(t, leadId, comId);

  // 1er appel
  const id1 = await t.run((ctx: any) =>
    ensureDossier(ctx, { leadId, projectId, montantTotal: 10000 }),
  );

  // 2e appel avec montantTotal mis à jour
  const id2 = await t.run((ctx: any) =>
    ensureDossier(ctx, { leadId, projectId, montantTotal: 15000 }),
  );

  expect(id2).toBe(id1);

  // Toujours 1 seul client
  const clients = await t.run((ctx: any) =>
    ctx.db.query("clients").collect(),
  );
  expect(clients).toHaveLength(1);

  // Champ vente mis à jour
  const client = await t.run((ctx: any) => ctx.db.get(id1));
  expect(client.montantTotal).toBe(15000);

  // Steps & substeps non re-seedés (toujours 6 + 12)
  const steps = await t.run((ctx: any) =>
    ctx.db
      .query("workflowSteps")
      .withIndex("by_client", (q: any) => q.eq("clientId", id1))
      .collect(),
  );
  expect(steps).toHaveLength(6);

  const substeps = await t.run((ctx: any) =>
    ctx.db
      .query("workflowSubsteps")
      .withIndex("by_client", (q: any) => q.eq("clientId", id1))
      .collect(),
  );
  expect(substeps).toHaveLength(12);
});

test("idempotence par leadId sans projectId : 2e appel retourne le même dossier", async () => {
  const t = makeT();
  const leadId = await seedLead(t);

  // 1er appel : sans projectId
  const id1 = await t.run((ctx: any) =>
    ensureDossier(ctx, { leadId }),
  );

  // 2e appel : sans projectId, même leadId
  const id2 = await t.run((ctx: any) =>
    ensureDossier(ctx, { leadId, kits: "Kit 6kWc" }),
  );

  expect(id2).toBe(id1);

  // Toujours 1 seul client
  const clients = await t.run((ctx: any) =>
    ctx.db.query("clients").collect(),
  );
  expect(clients).toHaveLength(1);

  // Champ vente kits mis à jour
  const client = await t.run((ctx: any) => ctx.db.get(id1));
  expect(client.kits).toBe("Kit 6kWc");
});

test("recomputePhase + recomputeClientStatus mettent à jour step + client", async () => {
  const t = makeT();
  const leadId = await seedLead(t);
  const clientId = await t.run((ctx: any) =>
    ensureDossier(ctx, { leadId }),
  );

  // Marquer toutes les substeps de VT en fait
  const vtStep = await t.run((ctx: any) =>
    ctx.db
      .query("workflowSteps")
      .withIndex("by_client_phase", (q: any) =>
        q.eq("clientId", clientId).eq("phase", "vt"),
      )
      .first(),
  );
  const vtSubsteps = await t.run((ctx: any) =>
    ctx.db
      .query("workflowSubsteps")
      .withIndex("by_step", (q: any) => q.eq("stepId", vtStep._id))
      .collect(),
  );
  await t.run(async (ctx: any) => {
    for (const s of vtSubsteps) {
      await ctx.db.patch(s._id, { status: "fait" });
    }
  });

  // Recompute (chaîne scindée : le step depuis SES substeps, puis le client)
  await t.run(async (ctx: any) => {
    await recomputePhase(ctx, vtStep._id);
    await recomputeClientStatus(ctx, clientId);
  });

  // VT step doit être 'fait'
  const vtStepAfter = await t.run((ctx: any) => ctx.db.get(vtStep._id));
  expect(vtStepAfter.status).toBe("fait");

  // statusGlobal doit être 'administratif_en_cours' (VT fait, reste à faire)
  const client = await t.run((ctx: any) => ctx.db.get(clientId));
  expect(client.statusGlobal).toBe("administratif_en_cours");
  expect(client.currentPhase).toBe("dp");
});

test("recomputeClientStatus ne re-dérive PAS les steps : un step annulé reste annulé", async () => {
  const t = makeT();
  const leadId = await seedLead(t);
  const clientId = await t.run((ctx: any) => ensureDossier(ctx, { leadId }));
  // Annuler TOUS les steps directement (comme setSaleCancelled), substeps intactes
  await t.run(async (ctx: any) => {
    const steps = await ctx.db
      .query("workflowSteps")
      .withIndex("by_client", (q: any) => q.eq("clientId", clientId))
      .collect();
    for (const s of steps) await ctx.db.patch(s._id, { status: "annule" });
  });
  await t.run((ctx: any) => recomputeClientStatus(ctx, clientId));
  const client = await t.run((ctx: any) => ctx.db.get(clientId));
  expect(client.statusGlobal).toBe("annule"); // pas écrasé par les substeps a_faire
  const steps = await t.run((ctx: any) =>
    ctx.db
      .query("workflowSteps")
      .withIndex("by_client", (q: any) => q.eq("clientId", clientId))
      .collect(),
  );
  expect(steps.every((s: any) => s.status === "annule")).toBe(true);
});
