import { describe, expect, it } from "vitest";
import { normalizePublicDebriefBody } from "./model/debriefLinkBody";

describe("normalizePublicDebriefBody", () => {
  it("payload vente réel du front public : montants string, signedAt ISO, nulls", () => {
    const out = normalizePublicDebriefBody({
      outcome: "vente",
      nonSaleReason: null,
      objection: "Prix",
      acceptanceFactors: ["confiance"],
      notes: null,
      montantTotal: "9259.00",
      financingType: "organisme",
      kits: "3kW",
      signedAt: "2026-07-20",
      paymentSubMethod: null,
      financingOrg: "sofinco",
      acomptePercent: 40,
      acompteAmount: "3703.50",
    });
    expect(out).toEqual({
      outcome: "vente",
      objection: "Prix",
      acceptanceFactors: ["confiance"],
      montantTotal: 9259,
      financingType: "organisme",
      kits: "3kW",
      signedAt: Date.parse("2026-07-20"),
      financingOrg: "sofinco",
      acomptePercent: 40,
      acompteAmount: 3703.5,
    });
  });

  it("non_vente : nulls supprimés, enums vides ignorés", () => {
    const out = normalizePublicDebriefBody({
      outcome: "non_vente",
      nonSaleReason: "trop_cher",
      objection: null,
      acceptanceFactors: [],
      notes: "à relancer",
      montantTotal: null,
      financingType: "",
      signedAt: null,
      acomptePercent: null,
      acompteAmount: null,
    });
    expect(out).toEqual({
      outcome: "non_vente",
      nonSaleReason: "trop_cher",
      notes: "à relancer",
      acceptanceFactors: [],
    });
  });

  it("virgule décimale française et nombres déjà typés acceptés", () => {
    const out = normalizePublicDebriefBody({ outcome: "vente", montantTotal: "9 259,50".replace(" ", ""), acompteAmount: 100 });
    expect(out.montantTotal).toBe(9259.5);
    expect(out.acompteAmount).toBe(100);
  });

  it("customEcheancier booléen ou string coercé, clés inconnues et rdvId ignorés", () => {
    const out = normalizePublicDebriefBody({
      outcome: "vente", customEcheancier: "true", rdvId: "hack", foo: "bar",
    });
    expect(out).toEqual({ outcome: "vente", customEcheancier: true });
  });

  it("montant non numérique : erreur explicite", () => {
    expect(() => normalizePublicDebriefBody({ outcome: "vente", acompteAmount: "abc" }))
      .toThrow(/acompteAmount invalide/);
    expect(() => normalizePublicDebriefBody({ outcome: "vente", signedAt: "pas-une-date" }))
      .toThrow(/signedAt invalide/);
  });

  it("signedAt epoch ms conservé tel quel", () => {
    expect(normalizePublicDebriefBody({ outcome: "vente", signedAt: 1783918800000 }).signedAt).toBe(1783918800000);
  });
});
