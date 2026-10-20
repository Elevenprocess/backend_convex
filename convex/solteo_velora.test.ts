import { afterEach, describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";

afterEach(() => { delete process.env.SOLTEO_VELORA_WRITE_ENABLED; delete process.env.SYNC_ALERT_EMAILS; });

async function seed(t: ReturnType<typeof makeT>, rdv: Record<string, unknown> = {}) {
  await t.run((ctx) => ctx.db.insert("users", { email: "erwan@x.fr", role: "admin", active: true } as never));
  const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "rdv_honore", externalId: "ct1" } as never));
  const rdvId = await t.run((ctx) => ctx.db.insert("rdv", { leadId, locationType: "domicile", status: "planifie", scheduledAt: 1, ...rdv } as never));
  return { leadId, rdvId };
}
const apply = (t: ReturnType<typeof makeT>) => t.mutation(internal.solteo.applySaleToVelora, {
  quoteId: "q1", projectId: "p1", ghlContactId: "ct1", ttc: 5119, signedAt: "2026-10-19T08:21:01",
});

describe("ELE-179 devis signé → Velora", () => {
  it("flag OFF : rien écrit, plan journalisé", async () => {
    const t = makeT(); const { rdvId } = await seed(t);
    expect(await apply(t)).toMatch(/^logged:/);
    expect((await t.run((ctx) => ctx.db.get(rdvId)))?.result).toBeUndefined();
  });
  it("flag ON : champs vides remplis, lead signé, idempotent", async () => {
    process.env.SOLTEO_VELORA_WRITE_ENABLED = "true";
    const t = makeT(); const { rdvId, leadId } = await seed(t);
    await apply(t); await apply(t);
    expect(await t.run((ctx) => ctx.db.get(rdvId))).toMatchObject({ result: "signe", montantTotal: 5119, status: "honore" });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.status).toBe("signe");
    const [q] = await t.run((ctx) => ctx.db.query("solteoSignedQuotes").collect());
    expect(q?.veloraAppliedAt).toBeDefined();
  });
  it("montant différent : pas d'écrasement, écart + alerte immédiate à l'admin", async () => {
    process.env.SOLTEO_VELORA_WRITE_ENABLED = "true";
    const t = makeT(); const { rdvId } = await seed(t, { result: "signe", montantTotal: 4000, status: "honore" });
    await apply(t);
    expect((await t.run((ctx) => ctx.db.get(rdvId)))?.montantTotal).toBe(4000);
    const [d] = await t.run((ctx) => ctx.db.query("syncDiscrepancies").collect());
    expect(d?.kind).toBe("montant_velora_diff");
    const notifs = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notifs).toHaveLength(1);
  });
  it("vente sans RDV → écart grave", async () => {
    const t = makeT();
    await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "qualifie", externalId: "ct1" } as never));
    expect(await apply(t)).toBe("no_rdv");
    const [d] = await t.run((ctx) => ctx.db.query("syncDiscrepancies").collect());
    expect(d?.kind).toBe("vente_solteo_sans_rdv");
  });
  it("motif périmé effacé quand le devis est relié", async () => {
    const t = makeT();
    const base = { quoteId: "q9", projectId: "p9", plan: "[]" };
    await t.mutation(internal.solteo.upsertSignedQuote, { ...base, status: "skipped", reason: "opportunity_not_found" });
    await t.mutation(internal.solteo.upsertSignedQuote, { ...base, status: "already_ok" });
    const [q] = await t.run((ctx) => ctx.db.query("solteoSignedQuotes").collect());
    expect(q?.reason).toBeUndefined();
  });
  it("résumé quotidien", async () => {
    const t = makeT(); await seed(t);
    await t.mutation(internal.solteo.flagDiscrepancy, { key: "k", kind: "rdv_result_diff", entityRef: "x", details: "d" });
    expect(await t.mutation(internal.syncAlerts.dailyDigest, {})).toEqual({ total: 1, recipients: 1 });
  });
});
