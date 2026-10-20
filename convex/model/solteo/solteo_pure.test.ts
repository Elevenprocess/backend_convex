import { describe, expect, it } from "vitest";
import { normalizeSolteoWebhook } from "./webhook";
import { buildGhlPlan, findSignedStage, pickSignedOffer } from "./signedQuote";

const PIPES = [
  { id: "p2", name: "2. Attribution", stages: [{ id: "x", name: "11. Autre" }] },
  { id: "p1", name: "1. CRM Vente 📊", stages: [{ id: "s10", name: "10. Devis En Attente 📝" }, { id: "s11", name: "11. Devis Signé ✍️" }] },
];

describe("Soltéo webhook", () => {
  it("normalise et dédoublonne sur (type, id, date)", () => {
    const n = normalizeSolteoWebhook({ eventType: "quote_signed", eventDateTime: "2026-10-20T10:00:00Z", companyId: "co", details: { quoteId: "q1", projectId: "p1" } });
    expect(n).toMatchObject({ eventType: "quote_signed", quoteId: "q1", projectId: "p1", companyId: "co", dedupeKey: "quote_signed:q1:2026-10-20T10:00:00Z" });
    expect(normalizeSolteoWebhook(null).eventType).toBe("unknown");
  });
});

describe("plan GHL", () => {
  const target = findSignedStage(PIPES);
  it("trouve l'étape 11 du pipeline CRM Vente", () => expect(target).toEqual({ pipelineId: "p1", stageId: "s11" }));
  it("montant PUIS étape", () => {
    const p = buildGhlPlan({ totalPriceTtc: 5119, opp: { id: "o", pipelineId: "p1", pipelineStageId: "s10", monetaryValue: 0 }, target });
    expect(p.ok && p.steps.map((s) => s.op)).toEqual(["set_amount", "move_stage"]);
  });
  it("garde-fou montant > 0", () => {
    for (const v of [0, -1, null, undefined, Number.NaN]) {
      expect(buildGhlPlan({ totalPriceTtc: v as never, opp: { id: "o" }, target })).toMatchObject({ ok: false, reason: "amount_not_positive" });
    }
  });
  it("déjà conforme → aucune étape ; opp introuvable → refus", () => {
    const p = buildGhlPlan({ totalPriceTtc: 100, opp: { id: "o", pipelineId: "p1", pipelineStageId: "s11", monetaryValue: 100 }, target });
    expect(p.ok && p.steps).toEqual([]);
    expect(buildGhlPlan({ totalPriceTtc: 100, opp: null, target })).toMatchObject({ ok: false, reason: "opportunity_not_found" });
  });
  it("offre signée ciblée par quoteId sinon la plus récente", () => {
    const d = { id: "p", offers: [
      { id: "a", status: "signed", signedAt: "2026-01-01" }, { id: "b", status: "signed", signedAt: "2026-02-01" }, { id: "c", status: "created" }] };
    expect(pickSignedOffer(d, "a")?.id).toBe("a");
    expect(pickSignedOffer(d)?.id).toBe("b");
    expect(pickSignedOffer({ id: "p", offers: [{ id: "c", status: "created" }] })).toBeNull();
  });
});
