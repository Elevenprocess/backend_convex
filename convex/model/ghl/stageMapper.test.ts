import { describe, expect, it } from "vitest";
import {
  GHL_STAGE_MAP,
  CLIENT_VISIBLE_STAGES,
  CLIENT_VISIBLE_STATUSES,
  isClientVisibleStage,
  mapGhlStageToStatus,
} from "./stageMapper";

describe("mapGhlStageToStatus", () => {
  it("mappe les 17 stages connus", () => {
    expect(mapGhlStageToStatus("0. Nouveaux Prospects 🌱")).toMatchObject({ status: "nouveau", isKnown: true });
    expect(mapGhlStageToStatus("4. Qualification Commerciale 📋")).toMatchObject({ status: "qualifie", isKnown: true });
    expect(mapGhlStageToStatus("5. RDV Planifié 📅")).toMatchObject({ status: "rdv_pris", isKnown: true });
    expect(mapGhlStageToStatus("10. Devis En Attente 📝")).toMatchObject({ status: "rdv_honore", isKnown: true });
    expect(mapGhlStageToStatus("10.5 Devis En Cours De Signature ✍️")).toMatchObject({ status: "signature_en_cours" });
    expect(mapGhlStageToStatus("11. Devis Signé ✍️")).toMatchObject({ status: "signe" });
    expect(mapGhlStageToStatus("12. Devis Perdu 💔")).toMatchObject({ status: "perdu" });
    expect(mapGhlStageToStatus("2. Suivi & Relance 🔄")).toMatchObject({ status: "relance" });
    expect(mapGhlStageToStatus("3. Pas Qualifiés ❌")).toMatchObject({ status: "pas_qualifie" });
    expect(mapGhlStageToStatus("6. RDV Annulé 🛑")).toMatchObject({ status: "perdu" });
    expect(mapGhlStageToStatus("7. RDV Pas Qualifié ⚠️")).toMatchObject({ status: "perdu" });
    expect(mapGhlStageToStatus("9. Relance Long Terme ⏳")).toMatchObject({ status: "perdu" });
    expect(mapGhlStageToStatus("(BIS) Retour à l'Assistant 🔙")).toMatchObject({ status: "nouveau" });
    expect(mapGhlStageToStatus("(BIS) Prospects Attribués 🫴")).toMatchObject({ status: "qualifie" });
    expect(mapGhlStageToStatus("(BIS) En cours de traitement")).toMatchObject({ status: "qualifie" });
  });

  it("porte les side-effects", () => {
    expect(mapGhlStageToStatus("🙅‍♂️ (BIS) No-Show")).toMatchObject({ status: "perdu", sideEffect: "rdv_no_show" });
    expect(mapGhlStageToStatus("8. RDV Reprogrammé 🔁")).toMatchObject({ status: "rdv_pris", sideEffect: "rdv_reporte" });
    expect(mapGhlStageToStatus("1. Prospects Archivés 📦")).toMatchObject({ status: "perdu", sideEffect: "archived" });
  });

  it("normalise espaces multiples / trim / NFC", () => {
    expect(mapGhlStageToStatus("  5. RDV  Planifié 📅 ")).toMatchObject({
      status: "rdv_pris",
      normalizedName: "5. RDV Planifié 📅",
    });
    // NFD (é décomposé) → NFC
    expect(mapGhlStageToStatus("5. RDV Planifié 📅".normalize("NFD"))).toMatchObject({
      status: "rdv_pris",
      isKnown: true,
    });
  });

  it("stage inconnu ou vide → isKnown:false, status null", () => {
    expect(mapGhlStageToStatus("Stage Futur Inconnu")).toEqual({
      status: null, isKnown: false, normalizedName: "Stage Futur Inconnu",
    });
    expect(mapGhlStageToStatus("")).toEqual({ status: null, isKnown: false, normalizedName: null });
    expect(mapGhlStageToStatus(null)).toEqual({ status: null, isKnown: false, normalizedName: null });
    expect(mapGhlStageToStatus(undefined)).toEqual({ status: null, isKnown: false, normalizedName: null });
  });
});

describe("CLIENT_VISIBLE_*", () => {
  it("6 stages du chemin positif", () => {
    expect(CLIENT_VISIBLE_STAGES).toHaveLength(6);
    expect(isClientVisibleStage("5. RDV Planifié 📅")).toBe(true);
    expect(isClientVisibleStage(" 11. Devis  Signé ✍️ ")).toBe(true);
    expect(isClientVisibleStage("🙅‍♂️ (BIS) No-Show")).toBe(false);
    expect(isClientVisibleStage(null)).toBe(false);
  });

  it("CLIENT_VISIBLE_STATUSES dérivé du mapping (pas de drift)", () => {
    expect(CLIENT_VISIBLE_STATUSES).toEqual(
      [...new Set(CLIENT_VISIBLE_STAGES.map((s) => GHL_STAGE_MAP[s].status))],
    );
  });
});
