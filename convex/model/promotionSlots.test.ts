import { describe, expect, it } from "vitest";
import { ghlSlotTexts, isOfficeSlot, officeSlotDays, officeSlotHours } from "./promotionSlots";
import { reunionDayStartMs } from "./promotions";

const START = reunionDayStartMs("2026-11-23");
const END = reunionDayStartMs("2026-11-30") - 1;
const BEFORE = reunionDayStartMs("2026-11-23");

describe("créneaux bureau de la promo", () => {
  it("jeudi, vendredi, samedi, dimanche seulement", () => {
    expect(officeSlotDays(START, END, BEFORE)).toEqual(["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
  });
  it("jeudi/vendredi/samedi 8 h → 17 h (fin 18 h), dimanche 8 h → 12 h (fin 13 h)", () => {
    expect(officeSlotHours("2026-11-27", BEFORE)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(officeSlotHours("2026-11-28", BEFORE)).toHaveLength(10);
    expect(officeSlotHours("2026-11-29", BEFORE)).toEqual([8, 9, 10, 11, 12]);
    expect(officeSlotHours("2026-11-26", BEFORE)).toHaveLength(10);
    expect(officeSlotHours("2026-11-25", BEFORE)).toEqual([]);
  });
  it("le jour même, les heures déjà commencées disparaissent ; les jours passés aussi", () => {
    const vendrediMidiQuart = reunionDayStartMs("2026-11-27") + 12.25 * 3_600_000;
    expect(officeSlotHours("2026-11-27", vendrediMidiQuart)).toEqual([13, 14, 15, 16, 17]);
    const samedi = reunionDayStartMs("2026-11-28") + 3_600_000;
    expect(officeSlotDays(START, END, samedi)).toEqual(["2026-11-28", "2026-11-29"]);
    expect(isOfficeSlot(START, END, "2026-11-27", 10, samedi)).toBe(false);
    expect(isOfficeSlot(START, END, "2026-11-29", 13, BEFORE)).toBe(false);
  });
  it("textes GHL au format du site d'invitation", () => {
    expect(ghlSlotTexts("2026-11-27", 9)).toEqual({
      jour: "Vendredi 27 novembre", heure: "9 h à 10 h",
      creneau: "Vendredi 27 novembre, 9 h à 10 h", debut: "11-27-2026 09:00 AM",
    });
    expect(ghlSlotTexts("2026-11-27", 12).debut).toBe("11-27-2026 12:00 PM");
    expect(ghlSlotTexts("2026-11-29", 13).debut).toBe("11-29-2026 01:00 PM");
  });
});
