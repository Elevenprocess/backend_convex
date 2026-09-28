import { describe, expect, it } from "vitest";
import { debriefTargetStage, isStaleRdvStage } from "./model/ghl/debriefStage";
import { RETOUR_SETTERS_STAGE } from "./model/ghl/stageMapper";

describe("debriefTargetStage", () => {
  it("suivi prévu / en réflexion → Retour aux Setters", () => {
    expect(debriefTargetStage("suivi_prevu", null)).toBe(RETOUR_SETTERS_STAGE);
    expect(debriefTargetStage("en_reflexion", null)).toBe(RETOUR_SETTERS_STAGE);
    expect(debriefTargetStage("non_vente", "suivi_prevu")).toBe(RETOUR_SETTERS_STAGE);
  });
  it("vente et non-vente définitive → rien (workflows GHL client/CAPI)", () => {
    expect(debriefTargetStage("vente", null)).toBeNull();
    for (const r of ["non_qualifie", "no_show", "contact_annule", "annulation_administrative", "pas_interesse"] as const) {
      expect(debriefTargetStage("non_vente", r)).toBeNull();
    }
  });
});

describe("isStaleRdvStage", () => {
  it("seules les étapes « RDV à venir » sont remplacées", () => {
    expect(isStaleRdvStage("5. RDV Planifié 📅")).toBe(true);
    expect(isStaleRdvStage("  8. RDV  Reprogrammé 🔁 ")).toBe(true);
    expect(isStaleRdvStage("10. Devis En Attente 📝")).toBe(false);
    expect(isStaleRdvStage("11. Devis Signé ✍️")).toBe(false);
    expect(isStaleRdvStage(null)).toBe(false);
  });
});
