import { describe, expect, it } from "vitest";
import { decideRdvStatusFromGhl } from "./calendarSync";

describe("ELE-177 decideRdvStatusFromGhl", () => {
  it("confirmed / inconnu / vide ne rétrograde jamais un RDV clôturé", () => {
    for (const ghl of ["confirmed", "booked", "new", "", undefined, "weird"]) {
      for (const existingStatus of ["honore", "no_show", "annule", "reporte"]) {
        expect(decideRdvStatusFromGhl({ existingStatus, ghlStatus: ghl })).toEqual({ kind: "keep" });
      }
      expect(decideRdvStatusFromGhl({ existingStatus: "planifie", existingResult: "signe", ghlStatus: ghl })).toEqual({ kind: "keep" });
    }
  });
  it("RDV planifié non débriefé : statuts finaux GHL appliqués", () => {
    expect(decideRdvStatusFromGhl({ existingStatus: "planifie", ghlStatus: "showed" })).toEqual({ kind: "set", status: "honore" });
    expect(decideRdvStatusFromGhl({ existingStatus: "planifie", ghlStatus: "noshow" })).toEqual({ kind: "set", status: "no_show" });
    expect(decideRdvStatusFromGhl({ existingStatus: "planifie", ghlStatus: "cancelled" })).toEqual({ kind: "set", status: "annule" });
    expect(decideRdvStatusFromGhl({ existingStatus: "planifie", ghlStatus: "confirmed" })).toEqual({ kind: "keep" });
  });
  it("deux statuts finaux divergents → conflit (journalisé, pas écrasé)", () => {
    const d = decideRdvStatusFromGhl({ existingStatus: "honore", existingResult: "signe", ghlStatus: "cancelled" });
    expect(d.kind).toBe("conflict");
    const d2 = decideRdvStatusFromGhl({ existingStatus: "planifie", existingDebriefFilledAt: 1, ghlStatus: "noshow" });
    expect(d2.kind).toBe("conflict");
  });
  it("même statut → keep", () => {
    expect(decideRdvStatusFromGhl({ existingStatus: "honore", ghlStatus: "showed" })).toEqual({ kind: "keep" });
  });
});
