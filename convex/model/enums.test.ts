import { expect, test } from "vitest";
import { ROLES, LEAD_STATUSES, CALL_RESULTS, roleValidator } from "./enums";
import {
  RDV_STATUSES, RDV_LOCATIONS, RDV_RESULTS, FINANCING_TYPES, rdvStatusValidator,
} from "./enums";
import {
  PROJECT_STATUSES, DEBRIEF_OUTCOMES, DEBRIEF_NON_SALE_REASONS,
  DEBRIEF_REFLEXION_REASONS, DEBRIEF_SUIVI_REASONS, PAYMENT_SUB_METHODS,
  FINANCING_ORGS, projectStatusValidator, debriefOutcomeValidator,
} from "./enums";
import {
  DEVIS_STATUSES, OCR_STATUSES, LIGNE_TYPES, PAIEMENT_PHASES,
  devisStatusValidator, ocrStatusValidator,
} from "./enums";
import {
  ACOMPTE_STATUSES, LEGACY_ACOMPTE_STATUSES, ECHEANCE_JALONS,
} from "./enums";

test("les rôles reprennent les 10 valeurs Postgres", () => {
  expect(ROLES).toEqual([
    "admin", "setter", "setter_lead", "commercial", "commercial_lead",
    "delivrabilite", "responsable_technique", "back_office", "technicien", "finances",
  ]);
});

test("leadStatus reprend les 11 statuts", () => {
  expect(LEAD_STATUSES).toContain("nouveau");
  expect(LEAD_STATUSES).toContain("pas_de_reponse");
  expect(LEAD_STATUSES).toHaveLength(11);
});

test("callResult reprend les 7 résultats", () => {
  expect(CALL_RESULTS).toHaveLength(7);
});

test("roleValidator est un validator union", () => {
  expect(roleValidator.kind).toBe("union");
});

test("rdvStatus reprend les 5 statuts Postgres", () => {
  expect(RDV_STATUSES).toEqual(["planifie", "honore", "no_show", "reporte", "annule"]);
});

test("rdvLocation reprend les 3 lieux", () => {
  expect(RDV_LOCATIONS).toEqual(["domicile", "agence", "visio"]);
});

test("rdvResult reprend les 5 résultats", () => {
  expect(RDV_RESULTS).toEqual(["signe", "reflexion", "perdu", "no_show", "reporte"]);
});

test("financingType reprend les 6 modes", () => {
  expect(FINANCING_TYPES).toEqual([
    "comptant", "financement", "financement_sans_apport",
    "apport_financement", "paiement_10x", "paiement_12x",
  ]);
});

test("rdvStatusValidator est un union", () => {
  expect(rdvStatusValidator.kind).toBe("union");
});

test("projectStatus reprend les 6 statuts Postgres", () => {
  expect(PROJECT_STATUSES).toEqual([
    "qualification", "devis_en_cours", "signature_en_cours",
    "signe", "perdu", "abandonne",
  ]);
});

test("debriefOutcome reprend les 4 issues", () => {
  expect(DEBRIEF_OUTCOMES).toEqual(["vente", "non_vente", "en_reflexion", "suivi_prevu"]);
});

test("debriefNonSaleReason reprend les 6 motifs", () => {
  expect(DEBRIEF_NON_SALE_REASONS).toEqual([
    "suivi_prevu", "non_qualifie", "no_show",
    "contact_annule", "annulation_administrative", "pas_interesse",
  ]);
});

test("debriefReflexionReason reprend les 7 motifs", () => {
  expect(DEBRIEF_REFLEXION_REASONS).toHaveLength(7);
  expect(DEBRIEF_REFLEXION_REASONS).toContain("besoin_reflechir");
  expect(DEBRIEF_REFLEXION_REASONS).toContain("autre");
});

test("debriefSuiviReason reprend les 5 motifs", () => {
  expect(DEBRIEF_SUIVI_REASONS).toEqual([
    "rappel_programme", "pas_le_bon_moment",
    "attend_devis_detaille", "besoin_info_technique", "autre",
  ]);
});

test("paymentSubMethod reprend les 3 modes", () => {
  expect(PAYMENT_SUB_METHODS).toEqual(["cheque", "especes", "virement"]);
});

test("financingOrg reprend les 2 organismes", () => {
  expect(FINANCING_ORGS).toEqual(["cmoi", "sofider"]);
});

test("les validateurs closing sont des unions", () => {
  expect(projectStatusValidator.kind).toBe("union");
  expect(debriefOutcomeValidator.kind).toBe("union");
});

test("devisStatus reprend les 5 statuts Postgres", () => {
  expect(DEVIS_STATUSES).toEqual([
    "brouillon", "en_attente", "signature_en_cours", "signe", "perdu",
  ]);
});

test("ocrStatus reprend les 4 états", () => {
  expect(OCR_STATUSES).toEqual(["pending", "processing", "done", "failed"]);
});

test("ligneType reprend les 10 types", () => {
  expect(LIGNE_TYPES).toEqual([
    "panneau", "onduleur", "batterie", "fixation", "monitoring",
    "protection", "prestation", "consuel", "remise", "autre",
  ]);
});

test("paiementPhase reprend les 7 phases", () => {
  expect(PAIEMENT_PHASES).toEqual([
    "signature", "vt", "dp", "pose_planif", "pose", "mes", "autre",
  ]);
});

test("les validateurs devis sont des unions", () => {
  expect(devisStatusValidator.kind).toBe("union");
  expect(ocrStatusValidator.kind).toBe("union");
});

test("acompte statuses", () => {
  expect(ACOMPTE_STATUSES).toEqual([
    "en_attente", "a_encaisser", "encaisse", "en_retard", "annule",
  ]);
});

test("legacy acompte statuses", () => {
  expect(LEGACY_ACOMPTE_STATUSES).toEqual([
    "attendu", "encaisse", "en_retard", "annule",
  ]);
});

test("echeance jalons", () => {
  expect(ECHEANCE_JALONS).toContain("signature");
  expect(ECHEANCE_JALONS).toContain("racco_validee");
  expect(ECHEANCE_JALONS).toHaveLength(7);
});
