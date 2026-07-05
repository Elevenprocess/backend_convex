import { describe, expect, it } from "vitest";
import { isReplanToFuture, shouldRearmDebriefOnReschedule } from "./rdvReschedule";

const NOW = Date.parse("2026-07-05T12:00:00Z");
const PAST = NOW - 86_400_000;
const FUTURE = NOW + 86_400_000;

describe("shouldRearmDebriefOnReschedule", () => {
  const closedBase = { existingScheduledAt: PAST, existingStatus: "honore", existingResult: undefined, existingDebriefFilledAt: undefined, now: NOW };
  it("clôturé + déplacé + futur → true (par statut, result, ou debriefFilledAt)", () => {
    expect(shouldRearmDebriefOnReschedule({ ...closedBase, newScheduledAt: FUTURE })).toBe(true);
    expect(shouldRearmDebriefOnReschedule({ ...closedBase, existingStatus: "planifie", existingResult: "signe", newScheduledAt: FUTURE })).toBe(true);
    expect(shouldRearmDebriefOnReschedule({ ...closedBase, existingStatus: "planifie", existingDebriefFilledAt: PAST, newScheduledAt: FUTURE })).toBe(true);
    for (const s of ["no_show", "annule"]) {
      expect(shouldRearmDebriefOnReschedule({ ...closedBase, existingStatus: s, newScheduledAt: FUTURE })).toBe(true);
    }
  });
  it("pas déplacé, pas futur, pas clôturé, ou dates absentes → false", () => {
    expect(shouldRearmDebriefOnReschedule({ ...closedBase, newScheduledAt: PAST })).toBe(false);          // même date
    expect(shouldRearmDebriefOnReschedule({ ...closedBase, newScheduledAt: NOW - 3_600_000 })).toBe(false); // déplacé mais passé
    expect(shouldRearmDebriefOnReschedule({ ...closedBase, existingStatus: "planifie", newScheduledAt: FUTURE })).toBe(false); // pas clôturé
    expect(shouldRearmDebriefOnReschedule({ ...closedBase, newScheduledAt: undefined })).toBe(false);
    expect(shouldRearmDebriefOnReschedule({ ...closedBase, existingScheduledAt: undefined, newScheduledAt: FUTURE })).toBe(false);
  });
});

describe("isReplanToFuture", () => {
  it("reporte (status ou result) + date future", () => {
    expect(isReplanToFuture({ status: "reporte", newScheduledAt: FUTURE, now: NOW })).toBe(true);
    expect(isReplanToFuture({ result: "reporte", newScheduledAt: FUTURE, now: NOW })).toBe(true);
    expect(isReplanToFuture({ status: "reporte", newScheduledAt: PAST, now: NOW })).toBe(false);
    expect(isReplanToFuture({ status: "honore", newScheduledAt: FUTURE, now: NOW })).toBe(false);
    expect(isReplanToFuture({ status: "reporte", newScheduledAt: undefined, now: NOW })).toBe(false);
  });
});
