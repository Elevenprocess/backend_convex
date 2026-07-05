import { describe, expect, it } from "vitest";
import { makeT } from "../../test.kit";
import { mapLeadStatusToProjectStatus, syncProjectFromLeadStatus } from "./projectSync";

describe("mapLeadStatusToProjectStatus (pur)", () => {
  it("table de calque lead → projet", () => {
    expect(mapLeadStatusToProjectStatus("qualifie")).toBe("qualification");
    expect(mapLeadStatusToProjectStatus("rdv_pris")).toBe("qualification");
    expect(mapLeadStatusToProjectStatus("rdv_honore")).toBe("devis_en_cours");
    expect(mapLeadStatusToProjectStatus("signature_en_cours")).toBe("signature_en_cours");
    expect(mapLeadStatusToProjectStatus("signe")).toBe("signe");
    expect(mapLeadStatusToProjectStatus("perdu")).toBe("perdu");
    expect(mapLeadStatusToProjectStatus("pas_qualifie")).toBe("perdu");
    for (const s of ["nouveau", "relance", "a_rappeler", "pas_de_reponse"] as const) {
      expect(mapLeadStatusToProjectStatus(s)).toBeNull();
    }
  });
});

async function seedLeadWithCommercial(t: ReturnType<typeof makeT>) {
  return await t.run(async (ctx) => {
    const commercialId = await ctx.db.insert("users", {
      email: "c@ecoi.fr", name: "Com", role: "commercial", active: true,
    });
    const leadId = await ctx.db.insert("leads", {
      source: "ghl", status: "rdv_pris", externalId: "c1",
      firstName: "Jean", lastName: "Payet", city: "Saint-Paul",
      assignedToId: commercialId,
    });
    return { commercialId, leadId };
  });
}

describe("syncProjectFromLeadStatus", () => {
  it("statut sans calque (relance) → no-op", async () => {
    const t = makeT();
    const { leadId } = await seedLeadWithCommercial(t);
    await t.run((ctx) => syncProjectFromLeadStatus(ctx, leadId, "relance"));
    const projects = await t.run((ctx) => ctx.db.query("projects").collect());
    expect(projects).toHaveLength(0);
  });

  it("lead sans projet → création au statut cible (commercial requis)", async () => {
    const t = makeT();
    const { leadId, commercialId } = await seedLeadWithCommercial(t);
    await t.run((ctx) => syncProjectFromLeadStatus(ctx, leadId, "perdu"));
    const [p] = await t.run((ctx) => ctx.db.query("projects").collect());
    expect(p).toMatchObject({
      leadId, commercialId, status: "perdu", name: "Jean Payet", city: "Saint-Paul",
    });
  });

  it("lead sans commercial assigné → skip (pas de projet)", async () => {
    const t = makeT();
    const leadId = await t.run((ctx) =>
      ctx.db.insert("leads", { source: "ghl", status: "rdv_pris", externalId: "c2" }),
    );
    await t.run((ctx) => syncProjectFromLeadStatus(ctx, leadId, "perdu"));
    expect(await t.run((ctx) => ctx.db.query("projects").collect())).toHaveLength(0);
  });

  it("projet ouvert existant → patch du statut ; même statut → no-op", async () => {
    const t = makeT();
    const { leadId, commercialId } = await seedLeadWithCommercial(t);
    const projectId = await t.run((ctx) =>
      ctx.db.insert("projects", {
        leadId, commercialId, name: "P", status: "qualification",
      }),
    );
    await t.run((ctx) => syncProjectFromLeadStatus(ctx, leadId, "rdv_honore"));
    expect((await t.run((ctx) => ctx.db.get(projectId)))?.status).toBe("devis_en_cours");
  });

  it("passage à signe → bootstrap dossier délivrabilité (idempotent)", async () => {
    const t = makeT();
    const { leadId, commercialId } = await seedLeadWithCommercial(t);
    await t.run((ctx) =>
      ctx.db.insert("projects", { leadId, commercialId, name: "P", status: "devis_en_cours" }),
    );
    await t.run((ctx) => syncProjectFromLeadStatus(ctx, leadId, "signe"));
    const clients = await t.run((ctx) => ctx.db.query("clients").collect());
    expect(clients).toHaveLength(1);
    expect(clients[0].leadId).toBe(leadId);
    // Replay → toujours 1 dossier
    await t.run((ctx) => syncProjectFromLeadStatus(ctx, leadId, "signe"));
    expect(await t.run((ctx) => ctx.db.query("clients").collect())).toHaveLength(1);
  });

  it("bootstrap enrichi depuis le devis signé (montantNet prioritaire)", async () => {
    const t = makeT();
    const { leadId, commercialId } = await seedLeadWithCommercial(t);
    const projectId = await t.run((ctx) =>
      ctx.db.insert("projects", { leadId, commercialId, name: "P", status: "devis_en_cours" }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("devis", {
        leadId, projectId, commercialId,
        status: "signe", ocrStatus: "done",
        filename: "devis.pdf", sizeBytes: 1000,
        lignes: [], echeancier: [], extracted: {},
        montantTtc: 11000, montantNet: 9900, financingType: "comptant",
        signedAt: 1_750_000_000_000,
      });
    });
    await t.run((ctx) => syncProjectFromLeadStatus(ctx, leadId, "signe"));
    const [c] = await t.run((ctx) => ctx.db.query("clients").collect());
    expect(c.montantTotal).toBe(9900);
    expect(c.typeFinancement).toBe("comptant");
  });
});
