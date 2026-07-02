/**
 * Task 4 — Schéma délivrabilité : 4 tables (clients, workflowSteps, workflowSubsteps, products)
 *
 * LIMITE convex-test : le moteur offline ne valide PAS le schéma. Un insert sur une
 * table non déclarée passerait sans erreur. Ces tests vérifient la FORME des données
 * (colonnes renseignées, valeurs retournées par db.get) mais la vraie garantie de
 * conformité du schéma = relecture manuelle de schema.ts.
 */
import { expect, test } from "vitest";
import { makeT } from "./test.kit";

// ─── products ────────────────────────────────────────────────────────────────

test("products : insert basique (panneau)", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const id = await ctx.db.insert("products", {
      nom: "Panneau XS400",
      marque: "Jinko",
      type: "panneau",
      stockActuel: 10,
      seuilAlerte: 2,
    });
    const row = await ctx.db.get(id);
    expect(row).toMatchObject({ nom: "Panneau XS400", type: "panneau", stockActuel: 10 });
  });
});

test("products : tous les types valides", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    for (const type of ["panneau", "onduleur", "batterie", "autre"] as const) {
      const id = await ctx.db.insert("products", {
        nom: `Produit ${type}`,
        type,
        stockActuel: 0,
        seuilAlerte: 0,
      });
      const row = await ctx.db.get(id);
      expect(row?.type).toBe(type);
    }
  });
});

test("products : externalId et metadata optionnels", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const id = await ctx.db.insert("products", {
      externalId: "ext-prod-1",
      nom: "Onduleur SolarEdge",
      type: "onduleur",
      stockActuel: 5,
      seuilAlerte: 1,
      metadata: { ref: "SE3000H" },
    });
    const row = await ctx.db.get(id);
    expect(row?.externalId).toBe("ext-prod-1");
    expect(row?.metadata).toMatchObject({ ref: "SE3000H" });
  });
});

// ─── clients ─────────────────────────────────────────────────────────────────

test("clients : insert minimal (leadId + dérivés stockés requis)", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    const id = await ctx.db.insert("clients", {
      leadId,
      statusGlobal: "nouveau",
      currentPhase: "vt",
      blocked: false,
    });
    const row = await ctx.db.get(id);
    expect(row).toMatchObject({ statusGlobal: "nouveau", currentPhase: "vt", blocked: false });
  });
});

test("clients : insert complet avec refs produits", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    const pannId = await ctx.db.insert("products", { nom: "Panneau", type: "panneau", stockActuel: 10, seuilAlerte: 2 });
    const ondId  = await ctx.db.insert("products", { nom: "Onduleur", type: "onduleur", stockActuel: 5, seuilAlerte: 1 });

    const id = await ctx.db.insert("clients", {
      leadId,
      panneauProductId: pannId,
      panneauQty: 12,
      onduleurProductId: ondId,
      onduleurQty: 1,
      montantTotal: 18000,
      typeFinancement: "financement",
      kits: "3kWc",
      signedAt: Date.now(),
      statusGlobal: "vt_a_faire",
      currentPhase: "vt",
      blocked: false,
      solteoProjectId: "SOL-001",
      notes: "Toiture sud",
    });
    const row = await ctx.db.get(id);
    expect(row?.panneauQty).toBe(12);
    expect(row?.statusGlobal).toBe("vt_a_faire");
    expect(row?.montantTotal).toBe(18000);
  });
});

test("clients : tous les statusGlobal valides", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const statuses = [
      "nouveau", "vt_a_faire", "administratif_en_cours",
      "installation_planifiee", "installe_en_attente_mes",
      "cloture", "bloque", "annule",
    ] as const;
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    for (const statusGlobal of statuses) {
      const id = await ctx.db.insert("clients", { leadId, statusGlobal, currentPhase: "vt", blocked: false });
      const row = await ctx.db.get(id);
      expect(row?.statusGlobal).toBe(statusGlobal);
    }
  });
});

test("clients : index by_lead requêtable", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    await ctx.db.insert("clients", { leadId, statusGlobal: "nouveau", currentPhase: "vt", blocked: false });
    const results = await ctx.db.query("clients").withIndex("by_lead", (q) => q.eq("leadId", leadId)).collect();
    expect(results.length).toBe(1);
  });
});

// ─── workflowSteps ───────────────────────────────────────────────────────────

test("workflowSteps : insert basique (clientId + phase + status)", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    const clientId = await ctx.db.insert("clients", { leadId, statusGlobal: "nouveau", currentPhase: "vt", blocked: false });

    const id = await ctx.db.insert("workflowSteps", {
      clientId,
      phase: "vt",
      status: "a_faire",
    });
    const row = await ctx.db.get(id);
    expect(row).toMatchObject({ phase: "vt", status: "a_faire" });
  });
});

test("workflowSteps : toutes les phases valides", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    const clientId = await ctx.db.insert("clients", { leadId, statusGlobal: "nouveau", currentPhase: "vt", blocked: false });

    for (const phase of ["vt", "dp", "racco", "installation", "consuel", "mes"] as const) {
      const id = await ctx.db.insert("workflowSteps", { clientId, phase, status: "a_faire" });
      const row = await ctx.db.get(id);
      expect(row?.phase).toBe(phase);
    }
  });
});

test("workflowSteps : tous les statuts workflow valides", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    const clientId = await ctx.db.insert("clients", { leadId, statusGlobal: "nouveau", currentPhase: "vt", blocked: false });

    for (const status of ["a_faire", "planifie", "en_cours", "fait", "probleme", "en_attente", "annule"] as const) {
      const id = await ctx.db.insert("workflowSteps", { clientId, phase: "vt", status });
      const row = await ctx.db.get(id);
      expect(row?.status).toBe(status);
    }
  });
});

test("workflowSteps : champs optionnels (problemReason, deadline, metadata)", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    const clientId = await ctx.db.insert("clients", { leadId, statusGlobal: "nouveau", currentPhase: "vt", blocked: false });

    const id = await ctx.db.insert("workflowSteps", {
      clientId,
      phase: "vt",
      status: "probleme",
      problemReason: "vt_client_absent",
      problemNotes: "Client injoignable",
      problemResolvedAt: undefined,
      deadline: "2026-07-15",
      notes: "À replanifier",
      metadata: { tentatives: 2 },
      lastSlaNotifiedAt: Date.now(),
    });
    const row = await ctx.db.get(id);
    expect(row?.problemReason).toBe("vt_client_absent");
    expect(row?.deadline).toBe("2026-07-15");
  });
});

test("workflowSteps : index by_client_phase requêtable", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    const clientId = await ctx.db.insert("clients", { leadId, statusGlobal: "nouveau", currentPhase: "vt", blocked: false });
    await ctx.db.insert("workflowSteps", { clientId, phase: "dp", status: "a_faire" });

    const results = await ctx.db.query("workflowSteps")
      .withIndex("by_client_phase", (q) => q.eq("clientId", clientId).eq("phase", "dp"))
      .collect();
    expect(results.length).toBe(1);
  });
});

// ─── workflowSubsteps ────────────────────────────────────────────────────────

test("workflowSubsteps : insert basique (stepId + clientId + key + position + status)", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    const clientId = await ctx.db.insert("clients", { leadId, statusGlobal: "nouveau", currentPhase: "vt", blocked: false });
    const stepId = await ctx.db.insert("workflowSteps", { clientId, phase: "vt", status: "a_faire" });

    const id = await ctx.db.insert("workflowSubsteps", {
      stepId,
      clientId,
      key: "vt_planifie",
      position: 1,
      status: "a_faire",
      optional: false,
    });
    const row = await ctx.db.get(id);
    expect(row).toMatchObject({ key: "vt_planifie", position: 1, status: "a_faire", optional: false });
  });
});

test("workflowSubsteps : toutes les clés workflowSubstepKey valides", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    const clientId = await ctx.db.insert("clients", { leadId, statusGlobal: "nouveau", currentPhase: "vt", blocked: false });
    const stepId = await ctx.db.insert("workflowSteps", { clientId, phase: "vt", status: "a_faire" });

    const keys = [
      "vt_planifie", "vt_attribuee", "vt_validee",
      "dp_envoyee_mairie", "dp_validee",
      "racco_envoye", "racco_validee",
      "consuel_a_faire", "consuel_valide",
      "install_a_faire", "install_effectuee",
      "enquete_satisfaction",
    ] as const;

    for (const [i, key] of keys.entries()) {
      const id = await ctx.db.insert("workflowSubsteps", { stepId, clientId, key, position: i + 1, status: "a_faire", optional: false });
      const row = await ctx.db.get(id);
      expect(row?.key).toBe(key);
    }
  });
});

test("workflowSubsteps : champ heure optionnel (VT)", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    const clientId = await ctx.db.insert("clients", { leadId, statusGlobal: "nouveau", currentPhase: "vt", blocked: false });
    const stepId = await ctx.db.insert("workflowSteps", { clientId, phase: "vt", status: "a_faire" });

    const id = await ctx.db.insert("workflowSubsteps", {
      stepId,
      clientId,
      key: "vt_planifie",
      position: 1,
      status: "planifie",
      optional: false,
      heure: "09:30",
      dateRealisee: "2026-07-10",
    });
    const row = await ctx.db.get(id);
    expect(row?.heure).toBe("09:30");
    expect(row?.dateRealisee).toBe("2026-07-10");
  });
});

test("workflowSubsteps : index by_client_key requêtable (seam isJalonReached)", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    const clientId = await ctx.db.insert("clients", { leadId, statusGlobal: "nouveau", currentPhase: "vt", blocked: false });
    const stepId = await ctx.db.insert("workflowSteps", { clientId, phase: "vt", status: "a_faire" });

    await ctx.db.insert("workflowSubsteps", {
      stepId, clientId, key: "vt_validee", position: 3, status: "fait", optional: false,
    });

    const results = await ctx.db.query("workflowSubsteps")
      .withIndex("by_client_key", (q) => q.eq("clientId", clientId).eq("key", "vt_validee"))
      .collect();
    expect(results.length).toBe(1);
    expect(results[0].status).toBe("fait");
  });
});

test("workflowSubsteps : index by_step_key requêtable", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    const clientId = await ctx.db.insert("clients", { leadId, statusGlobal: "nouveau", currentPhase: "vt", blocked: false });
    const stepId = await ctx.db.insert("workflowSteps", { clientId, phase: "dp", status: "a_faire" });

    await ctx.db.insert("workflowSubsteps", {
      stepId, clientId, key: "dp_envoyee_mairie", position: 1, status: "a_faire", optional: false,
    });

    const results = await ctx.db.query("workflowSubsteps")
      .withIndex("by_step_key", (q) => q.eq("stepId", stepId).eq("key", "dp_envoyee_mairie"))
      .collect();
    expect(results.length).toBe(1);
  });
});

test("workflowSubsteps : problemReason parmi les valeurs valides", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    const clientId = await ctx.db.insert("clients", { leadId, statusGlobal: "bloque", currentPhase: "installation", blocked: true });
    const stepId = await ctx.db.insert("workflowSteps", { clientId, phase: "installation", status: "probleme" });

    const id = await ctx.db.insert("workflowSubsteps", {
      stepId,
      clientId,
      key: "install_a_faire",
      position: 1,
      status: "probleme",
      optional: false,
      problemReason: "installation_stock_panneaux",
      problemNotes: "Rupture de stock Jinko 400W",
    });
    const row = await ctx.db.get(id);
    expect(row?.problemReason).toBe("installation_stock_panneaux");
  });
});
