import { describe, expect, it } from "vitest";
import { reunionDayRange } from "./model/analyticsRange";

// Bornes telles qu'envoyées par buildPeriodRange : minuit → 23:59:59.999 dans
// le fuseau LOCAL du navigateur, converties en ISO UTC.

describe("reunionDayRange", () => {
  it("navigateur UTC+4 (Réunion) : juillet reste juillet", () => {
    const r = reunionDayRange(
      "2026-06-30T20:00:00.000Z", "2026-07-31T19:59:59.999Z",
      30, Date.parse("2026-07-31T19:59:59.999Z"),
    );
    expect(r.fromDay).toBe("2026-07-01");
    expect(r.toDay).toBe("2026-07-31");
    expect(r.days).toBe(31);
  });

  it("navigateur UTC+3 (Madagascar) : juillet ne déborde plus sur le 1er août", () => {
    const r = reunionDayRange(
      "2026-06-30T21:00:00.000Z", "2026-07-31T20:59:59.999Z",
      30, Date.parse("2026-07-31T20:59:59.999Z"),
    );
    expect(r.fromDay).toBe("2026-07-01");
    expect(r.toDay).toBe("2026-07-31");
    expect(r.days).toBe(31);
  });

  it("navigateur UTC+2 (métropole) : « hier » = un seul jour, sans aujourd'hui", () => {
    const r = reunionDayRange(
      "2026-07-30T22:00:00.000Z", "2026-07-31T21:59:59.999Z",
      30, Date.parse("2026-07-31T21:59:59.999Z"),
    );
    expect(r.fromDay).toBe("2026-07-31");
    expect(r.toDay).toBe("2026-07-31");
    expect(r.days).toBe(1);
  });

  it("réaligne les bornes ms sur les jours Réunion (cohortes = buckets)", () => {
    const r = reunionDayRange(
      "2026-06-30T21:00:00.000Z", "2026-07-31T20:59:59.999Z",
      30, Date.parse("2026-07-31T20:59:59.999Z"),
    );
    expect(r.fromMs).toBe(Date.parse("2026-07-01T00:00:00+04:00"));
    expect(r.toMs).toBe(Date.parse("2026-07-31T23:59:59.999+04:00"));
  });

  it("bornes dégénérées (from = to) : retombe sur un seul jour", () => {
    const r = reunionDayRange(
      "2026-07-15T00:00:00.000Z", "2026-07-15T00:00:00.000Z",
      30, Date.parse("2026-07-15T00:00:00.000Z"),
    );
    expect(r.toDay).toBe(r.fromDay);
    expect(r.days).toBe(1);
  });
});
