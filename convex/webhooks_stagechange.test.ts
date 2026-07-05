import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";

const base = {
  externalId: "c1",
  ghlPipelineId: "p1",
  occurredAt: Date.parse("2026-07-04T08:00:00Z"),
};

describe("applyGhlStageChange — création / patch / historique", () => {
  it("lead absent → création minimale avec contactSeed + historique", async () => {
    const t = makeT();
    const r = await t.mutation(internal.webhooks.applyGhlStageChange, {
      ...base,
      ghlStageName: "4. Qualification Commerciale 📋",
      contactSeed: { firstName: "Jean", email: "j@d.re" },
    });
    expect(r).toMatchObject({ created: true, statusChanged: true, historyAppended: true });
    const lead = await t.run((ctx) => ctx.db.get(r.leadId));
    expect(lead).toMatchObject({
      externalId: "c1", source: "ghl", status: "qualifie",
      firstName: "Jean", email: "j@d.re",
      ghlStageName: "4. Qualification Commerciale 📋", ghlPipelineId: "p1",
    });
    const hist = await t.run((ctx) => ctx.db.query("leadStageHistory").collect());
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({
      leadId: r.leadId, saasStatus: "qualifie", changedAt: base.occurredAt, source: "webhook",
    });
  });

  it("lead existant → patch statut/valeur/stage, statusChanged reflète le vrai delta", async () => {
    const t = makeT();
    const leadId = await t.run((ctx) =>
      ctx.db.insert("leads", { source: "ghl", externalId: "c1", status: "qualifie" }),
    );
    const r = await t.mutation(internal.webhooks.applyGhlStageChange, {
      ...base, ghlStageName: "5. RDV Planifié 📅", monetaryValue: 8000,
    });
    expect(r).toMatchObject({ leadId, created: false, statusChanged: true });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead).toMatchObject({ status: "rdv_pris", monetaryValue: 8000 });

    // Même stage rejoué à une autre date → statusChanged false, historique appended
    const r2 = await t.mutation(internal.webhooks.applyGhlStageChange, {
      ...base, occurredAt: base.occurredAt + 60_000, ghlStageName: "5. RDV Planifié 📅",
    });
    expect(r2).toMatchObject({ statusChanged: false, historyAppended: true });
  });

  it("replay exact (même lead+stage+occurredAt) → historyAppended:false", async () => {
    const t = makeT();
    const args = { ...base, ghlStageName: "5. RDV Planifié 📅" };
    await t.mutation(internal.webhooks.applyGhlStageChange, args);
    const r2 = await t.mutation(internal.webhooks.applyGhlStageChange, args);
    expect(r2.historyAppended).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("leadStageHistory").collect())).toHaveLength(1);
  });

  it("stage inconnu → status conservé, ghlStageName màj, historique avec statut précédent", async () => {
    const t = makeT();
    const leadId = await t.run((ctx) =>
      ctx.db.insert("leads", { source: "ghl", externalId: "c1", status: "rdv_pris" }),
    );
    const r = await t.mutation(internal.webhooks.applyGhlStageChange, {
      ...base, ghlStageName: "Stage Futur Inconnu",
    });
    expect(r.statusChanged).toBe(false);
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.status).toBe("rdv_pris");
    expect(lead?.ghlStageName).toBe("Stage Futur Inconnu");
    const [h] = await t.run((ctx) => ctx.db.query("leadStageHistory").collect());
    expect(h.saasStatus).toBe("rdv_pris");
  });

  it("commercial GHL mappé → assignedToId résolu ; non mappé → inchangé", async () => {
    const t = makeT();
    const commercialId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "c@ecoi.fr", role: "commercial", ghlUserId: "ghl-u1", active: true }),
    );
    const r = await t.mutation(internal.webhooks.applyGhlStageChange, {
      ...base, ghlStageName: "5. RDV Planifié 📅", ghlAssignedUserId: "ghl-u1",
    });
    expect((await t.run((ctx) => ctx.db.get(r.leadId)))?.assignedToId).toBe(commercialId);

    const r2 = await t.mutation(internal.webhooks.applyGhlStageChange, {
      ...base, occurredAt: base.occurredAt + 1, ghlStageName: "5. RDV Planifié 📅",
      ghlAssignedUserId: "ghl-inconnu",
    });
    expect((await t.run((ctx) => ctx.db.get(r2.leadId)))?.assignedToId).toBe(commercialId);
  });

  it("silent → createdAt posé sur le lead créé + historique source backfill", async () => {
    const t = makeT();
    const r = await t.mutation(internal.webhooks.applyGhlStageChange, {
      ...base, ghlStageName: "5. RDV Planifié 📅", silent: true,
    });
    expect((await t.run((ctx) => ctx.db.get(r.leadId)))?.createdAt).toBe(base.occurredAt);
    const [h] = await t.run((ctx) => ctx.db.query("leadStageHistory").collect());
    expect(h.source).toBe("backfill");
  });
});
