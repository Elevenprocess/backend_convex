// ─── devisEcheancier — mapping échéancier devis → tranches finances ──────────

import { describe, test, expect } from "vitest";
import {
  jalonFromDevisEcheance,
  templatesFromDevisEcheancier,
} from "./devisEcheancier";

describe("jalonFromDevisEcheance", () => {
  test("signature / commande → signature", () => {
    expect(jalonFromDevisEcheance("Acompte à la signature", null)).toBe("signature");
    expect(jalonFromDevisEcheance("40% à la commande", null)).toBe("signature");
  });

  test("validation / visite technique → vt_validee (accents-insensible)", () => {
    expect(jalonFromDevisEcheance("Validation technique", null)).toBe("vt_validee");
    expect(jalonFromDevisEcheance("Après la visite technique", null)).toBe("vt_validee");
    expect(jalonFromDevisEcheance("VALIDATION TECHNIQUE", null)).toBe("vt_validee");
  });

  test("réception CNO / accord mairie → dp_validee", () => {
    expect(jalonFromDevisEcheance("Réception du CNO", null)).toBe("dp_validee");
    expect(jalonFromDevisEcheance("Après acceptation mairie", null)).toBe("dp_validee");
  });

  test("dépôt DP mairie → dp_envoyee_mairie", () => {
    expect(jalonFromDevisEcheance("Déclaration préalable déposée", null)).toBe("dp_envoyee_mairie");
  });

  test("planification / début des travaux → install_a_faire", () => {
    expect(jalonFromDevisEcheance("Planification de la pose", null)).toBe("install_a_faire");
    expect(jalonFromDevisEcheance("Au début des travaux", null)).toBe("install_a_faire");
  });

  test("fin de pose / installation → install_effectuee", () => {
    expect(jalonFromDevisEcheance("Fin de pose", null)).toBe("install_effectuee");
    expect(jalonFromDevisEcheance("Solde à la fin de chantier", null)).toBe("install_effectuee");
    expect(jalonFromDevisEcheance("Installation terminée", null)).toBe("install_effectuee");
  });

  test("raccordement / mise en service → racco_validee", () => {
    expect(jalonFromDevisEcheance("Solde au raccordement", null)).toBe("racco_validee");
    expect(jalonFromDevisEcheance("Mise en service", null)).toBe("racco_validee");
  });

  test("le champ phase est pris en compte quand le label est muet", () => {
    expect(jalonFromDevisEcheance("Tranche 2", "visite technique")).toBe("vt_validee");
  });

  test("libellé inconnu ou vide → null", () => {
    expect(jalonFromDevisEcheance("Divers", null)).toBe(null);
    expect(jalonFromDevisEcheance(null, null)).toBe(null);
  });
});

describe("templatesFromDevisEcheancier", () => {
  const ECHEANCIER = [
    { label: "Signature du devis", montant: 4000 },
    { label: "Validation technique", montant: 2000 },
    { label: "Réception du CNO", montant: 2000 },
    { label: "Fin de pose", montant: 2000 },
  ];

  test("somme ≈ montantTotal → montants du devis repris tels quels", () => {
    const tpl = templatesFromDevisEcheancier(ECHEANCIER, 10000);
    expect(tpl).toHaveLength(4);
    expect(tpl[0]).toMatchObject({
      ordre: 1,
      label: "Signature du devis",
      jalonKey: "signature",
      percent: 40,
      montantOverride: 4000,
    });
    expect(tpl[1].jalonKey).toBe("vt_validee");
    expect(tpl[2].jalonKey).toBe("dp_validee");
    expect(tpl[3].jalonKey).toBe("install_effectuee");
  });

  test("somme ≠ montantTotal (devis TTC vs net) → proportions en percent, pas d'override", () => {
    // Devis à 10 000 mais débrief net de prime à 9 000 : on garde 40/20/20/20.
    const tpl = templatesFromDevisEcheancier(ECHEANCIER, 9000);
    expect(tpl).toHaveLength(4);
    expect(tpl[0].percent).toBe(40);
    expect(tpl[0].montantOverride).toBeUndefined();
    expect(tpl[1].percent).toBe(20);
  });

  test("montantTotal inconnu → montants du devis tels quels", () => {
    const tpl = templatesFromDevisEcheancier(ECHEANCIER, null);
    expect(tpl[0].montantOverride).toBe(4000);
  });

  test("montant en string numérique ('4 500,00 €') toléré", () => {
    const tpl = templatesFromDevisEcheancier(
      [{ label: "Signature", montant: "4 500,00 €" }],
      4500,
    );
    expect(tpl).toHaveLength(1);
    expect(tpl[0].montantOverride).toBe(4500);
  });

  test("une ligne sans montant exploitable → échéancier entier rejeté ([])", () => {
    expect(
      templatesFromDevisEcheancier(
        [{ label: "Signature", montant: 4000 }, { label: "Solde" }],
        10000,
      ),
    ).toEqual([]);
    expect(
      templatesFromDevisEcheancier([{ label: "Signature", montant: 0 }], 10000),
    ).toEqual([]);
  });

  test("échéancier vide, non-tableau ou lignes non-objets → []", () => {
    expect(templatesFromDevisEcheancier([], 10000)).toEqual([]);
    expect(templatesFromDevisEcheancier(undefined, 10000)).toEqual([]);
    expect(templatesFromDevisEcheancier(["texte"], 10000)).toEqual([]);
  });

  test("label manquant → libellé par défaut « Échéance N »", () => {
    const tpl = templatesFromDevisEcheancier([{ montant: 1000 }], 1000);
    expect(tpl[0].label).toBe("Échéance 1");
    expect(tpl[0].jalonKey).toBe(null);
  });
});
