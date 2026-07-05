import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";

describe("cache events GHL", () => {
  it("set → get non expiré → payload ; expiré → null", async () => {
    const t = makeT();
    await t.mutation(internal.ghlCalendar.cacheSet, { key: "k1", payload: "[1]", expiresAt: 1_000 });
    expect(await t.query(internal.ghlCalendar.cacheGet, { key: "k1", now: 999 })).toBe("[1]");
    expect(await t.query(internal.ghlCalendar.cacheGet, { key: "k1", now: 1_000 })).toBeNull();
    expect(await t.query(internal.ghlCalendar.cacheGet, { key: "absent", now: 0 })).toBeNull();
  });

  it("set remplace l'entrée existante du même key (pas de doublon)", async () => {
    const t = makeT();
    await t.mutation(internal.ghlCalendar.cacheSet, { key: "k1", payload: "old", expiresAt: 10 });
    await t.mutation(internal.ghlCalendar.cacheSet, { key: "k1", payload: "new", expiresAt: 20 });
    expect(await t.query(internal.ghlCalendar.cacheGet, { key: "k1", now: 15 })).toBe("new");
    const rows = await t.run((ctx) => ctx.db.query("ghlEventsCache").collect());
    expect(rows).toHaveLength(1);
  });
});
