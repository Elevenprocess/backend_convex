import { expect, test } from "vitest";
import { pickVtDate, pickVtHeure, inPeriod, newlyAddedTechs } from "./vtCalendar";

test("pickVtDate : vt_planifie prioritaire, repli vt_attribuee, sinon null", () => {
  expect(pickVtDate({ vt_planifie: "2026-07-10", vt_attribuee: "2026-07-01" })).toBe("2026-07-10");
  expect(pickVtDate({ vt_planifie: null, vt_attribuee: "2026-07-01" })).toBe("2026-07-01");
  expect(pickVtDate({ vt_planifie: null, vt_attribuee: null })).toBeNull();
});

test("pickVtHeure : même priorité sur les heures", () => {
  expect(pickVtHeure({ vt_planifie: "14:30", vt_attribuee: "09:00" })).toBe("14:30");
  expect(pickVtHeure({ vt_planifie: null, vt_attribuee: "09:00" })).toBe("09:00");
  expect(pickVtHeure({ vt_planifie: null, vt_attribuee: null })).toBeNull();
});

test("inPeriod : bornes incluses, undefined = ouvert", () => {
  expect(inPeriod("2026-07-10", "2026-07-10", "2026-07-10")).toBe(true);
  expect(inPeriod("2026-07-10", "2026-07-11", undefined)).toBe(false);
  expect(inPeriod("2026-07-10", undefined, "2026-07-09")).toBe(false);
  expect(inPeriod("2026-07-10", undefined, undefined)).toBe(true);
});

test("newlyAddedTechs : seulement les nouveaux du set", () => {
  expect(newlyAddedTechs(["a", "b"], ["b", "c"])).toEqual(["c"]);
  expect(newlyAddedTechs([], ["a"])).toEqual(["a"]);
  expect(newlyAddedTechs(["a"], [])).toEqual([]);
});
