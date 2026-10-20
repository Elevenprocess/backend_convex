import { describe, expect, it } from "vitest";
import { decideVeloraSale, parseSolteoDate, pickSaleRdv } from "./veloraSale";
import { buildGhlPlan } from "./signedQuote";

describe("decideVeloraSale", () => {
  it("remplit les champs vides", () => {
    expect(decideVeloraSale({ status: "planifie" }, { ttc: 5119, signedAtMs: 10 })).toEqual({
      patch: { result: "signe", montantTotal: 5119, signatureAt: 10, status: "honore" }, discrepancies: [],
    });
  });
  it("ne remplace jamais un montant différent → écart", () => {
    const d = decideVeloraSale({ status: "honore", result: "signe", montantTotal: 4000, signatureAt: 1 }, { ttc: 5119 });
    expect(d.patch).toEqual({});
    expect(d.discrepancies[0]?.kind).toBe("montant_velora_diff");
  });
  it("result final différent → aucun patch, écart", () => {
    const d = decideVeloraSale({ status: "honore", result: "perdu" }, { ttc: 5119 });
    expect(d.patch).toEqual({});
    expect(d.discrepancies.map((x) => x.kind)).toContain("rdv_result_diff");
  });
  it("RDV choisi : signé > dernier avant signature", () => {
    expect(pickSaleRdv([{ status: "honore", scheduledAt: 1 }, { status: "honore", result: "signe", scheduledAt: 0 }])?.result).toBe("signe");
    expect(pickSaleRdv([{ status: "honore", scheduledAt: 5 }, { status: "planifie", scheduledAt: 50 }], 10)?.scheduledAt).toBe(5);
  });
  it("date Soltéo sans fuseau = heure Réunion", () => {
    expect(parseSolteoDate("2026-10-19T08:21:01")).toBe(Date.parse("2026-10-19T04:21:01Z"));
  });
});

describe("ELE-176 champ date de signature", () => {
  const target = { pipelineId: "p", stageId: "s11" };
  it("écrit avec le montant, AVANT l'étape", () => {
    const p = buildGhlPlan({ totalPriceTtc: 100, opp: { id: "o", pipelineId: "p", pipelineStageId: "s10", monetaryValue: 100 }, target, signedAtField: { id: "f", date: "2026-10-19" } });
    expect(p.ok && p.steps).toEqual([
      { op: "set_amount", opportunityId: "o", monetaryValue: 100, customFields: [{ id: "f", field_value: "2026-10-19" }] },
      { op: "move_stage", opportunityId: "o", pipelineId: "p", pipelineStageId: "s11" },
    ]);
  });
});
