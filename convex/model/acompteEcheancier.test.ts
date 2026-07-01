import { describe, test, expect } from "vitest";
import {
  resolveEcheancier,
  echeancierTemplate,
  tranchePrevue,
  normalizeJalonKey,
  customTemplatesFromRows,
} from "./acompteEcheancier";

describe("resolveEcheancier", () => {
  test("comptant = 40/20/20/20 sur jalons délivrabilité", () => {
    const t = resolveEcheancier({
      financingType: "comptant",
      montantTotal: 10000,
      acompteAmount: null,
      acomptePercent: null,
    });
    expect(t.map((x) => x.percent)).toEqual([40, 20, 20, 20]);
    expect(t.map((x) => x.jalonKey)).toEqual([
      "vt_validee",
      "dp_envoyee_mairie",
      "install_a_faire",
      "install_effectuee",
    ]);
  });

  test("financement = solde 100% install", () => {
    const t = resolveEcheancier({
      financingType: "financement",
      montantTotal: 10000,
      acompteAmount: null,
      acomptePercent: null,
    });
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ percent: 100, jalonKey: "install_effectuee" });
  });

  test("imported comptant = signature/VT/CNO/pose", () => {
    const t = resolveEcheancier({
      financingType: "comptant",
      montantTotal: 10000,
      acompteAmount: null,
      acomptePercent: null,
      imported: true,
    });
    expect(t.map((x) => x.jalonKey)).toEqual([
      "signature",
      "vt_validee",
      "dp_validee",
      "install_effectuee",
    ]);
  });

  test("10x/12x sans acompte = []", () => {
    expect(
      resolveEcheancier({
        financingType: "paiement_10x",
        montantTotal: 10000,
        acompteAmount: null,
        acomptePercent: null,
      }),
    ).toEqual([]);
  });

  test("acompte direct fallback = 1 tranche figée", () => {
    const t = resolveEcheancier({
      financingType: "paiement_12x",
      montantTotal: 10000,
      acompteAmount: 2000,
      acomptePercent: 20,
    });
    expect(t).toHaveLength(1);
    expect(t[0].montantOverride).toBe(2000);
  });

  test("mode null + montant = 40/20/20/20", () => {
    const t = resolveEcheancier({
      financingType: null,
      montantTotal: 10000,
      acompteAmount: null,
      acomptePercent: null,
    });
    expect(t.map((x) => x.percent)).toEqual([40, 20, 20, 20]);
  });
});

describe("tranchePrevue", () => {
  test("arrondi 2 décimales", () => {
    expect(tranchePrevue(10000, 40)).toBe(4000);
    expect(tranchePrevue(null, 40)).toBeNull();
  });
});

describe("normalizeJalonKey", () => {
  test("mappe les alias", () => {
    expect(normalizeJalonKey("vt")).toBe("vt_validee");
    expect(normalizeJalonKey("pose")).toBe("install_effectuee");
    expect(normalizeJalonKey("inconnu")).toBeNull();
  });
});

describe("customTemplatesFromRows", () => {
  test("trie par ordre", () => {
    const t = customTemplatesFromRows([
      {
        ordre: 2,
        label: "B",
        percent: 60,
        montantPrevu: null,
        jalonKey: "install_effectuee",
      },
      {
        ordre: 1,
        label: "A",
        percent: 40,
        montantPrevu: null,
        jalonKey: "vt",
      },
    ]);
    expect(t.map((x) => x.ordre)).toEqual([1, 2]);
    expect(t[0].jalonKey).toBe("vt_validee");
  });
});
