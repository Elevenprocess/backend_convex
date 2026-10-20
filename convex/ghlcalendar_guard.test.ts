import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const PAST_ISO = "2026-10-01T09:00:00.000Z";

async function seed(t: ReturnType<typeof makeT>, rdv: Record<string, unknown>) {
  const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "rdv_pris", externalId: "c1" }));
  return t.run((ctx) =>
    ctx.db.insert("rdv", {
      externalId: "evt1", leadId, locationType: "domicile", scheduledAt: Date.parse(PAST_ISO), status: "planifie", ...rdv,
    } as never),
  );
}
const persist = (t: ReturnType<typeof makeT>, status: string) =>
  t.mutation(internal.ghlCalendar.persistGhlEvents, {
    events: [{ id: "evt1", calendarId: "cal", startTime: PAST_ISO, contactId: "c1", status }] as never, now: NOW,
  });

describe("ELE-177 persistGhlEvents garde-fou", () => {
  it("RDV honoré (corrigé) + GHL confirmed → reste honoré, aucun écart", async () => {
    const t = makeT();
    const id = await seed(t, { status: "honore" });
    await persist(t, "confirmed");
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("honore");
    expect(await t.run((ctx) => ctx.db.query("syncDiscrepancies").collect())).toHaveLength(0);
  });
  it("RDV signé + GHL cancelled → inchangé, écart journalisé (idempotent)", async () => {
    const t = makeT();
    const id = await seed(t, { status: "honore", result: "signe" });
    await persist(t, "cancelled");
    await persist(t, "cancelled");
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("honore");
    const rows = await t.run((ctx) => ctx.db.query("syncDiscrepancies").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "ghl_calendar", kind: "rdv_status_conflict", entityRef: "evt1", count: 2 });
  });
  it("RDV planifié + GHL showed → honoré", async () => {
    const t = makeT();
    const id = await seed(t, {});
    await persist(t, "showed");
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("honore");
  });
});
