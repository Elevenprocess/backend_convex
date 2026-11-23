import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { reunionDayStartMs } from "./model/promotions";

const SYNC = { pipelineId: "p", stageId: "s", dayFieldId: "d", hourFieldId: "h", labelFieldId: "l", startFieldId: "st" };
const NOW = reunionDayStartMs("2026-11-25");

async function setup(withSync = true) {
  const t = makeT();
  const admin = await insertUser(t, { role: "admin" });
  const setter = await insertUser(t, { role: "setter", email: "s@ecoi.fr" });
  const promotionId = await asUser(t, admin).mutation(api.promotions.create, { name: "BF", startDay: "2026-11-23", endDay: "2026-11-29" });
  if (withSync) await t.mutation(internal.promotions.setGhlSlotSync, { id: promotionId, sync: SYNC });
  const leadId = await t.run((ctx) => ctx.db.insert("leads", {
    source: "ghl", status: "nouveau", firstName: "Julie", externalId: "c1", promotionId, promotionJoinedAt: NOW, promotionSource: "tag",
  }));
  return { t, admin, setter, promotionId, leadId };
}

describe("RDV au bureau choisi par le setter", () => {
  it("range le créneau sur la fiche et renvoie la config GHL", async () => {
    const { t, setter, leadId } = await setup();
    const r = await asUser(t, setter).mutation(internal.promotions.setOfficeSlotByStaff, { leadId, day: "2026-11-29", hour: 10, now: NOW });
    expect(r).toMatchObject({ externalId: "c1", name: "Julie", sync: SYNC });
    expect(await t.run((ctx) => ctx.db.get(leadId))).toMatchObject({ promotionSlotDay: "2026-11-29", promotionSlotHour: 10 });
  });

  it("refuse un créneau hors règles (dimanche 13 h, jeudi)", async () => {
    const { t, setter, leadId } = await setup();
    const as = asUser(t, setter);
    await expect(as.mutation(internal.promotions.setOfficeSlotByStaff, { leadId, day: "2026-11-29", hour: 13, now: NOW })).rejects.toThrow(/Créneau impossible/);
    await expect(as.mutation(internal.promotions.setOfficeSlotByStaff, { leadId, day: "2026-11-26", hour: 10, now: NOW })).rejects.toThrow(/Créneau impossible/);
  });

  it("refuse sans synchro configurée sur la promo, et en mode Explorer", async () => {
    const a = await setup(false);
    await expect(asUser(a.t, a.setter).mutation(internal.promotions.setOfficeSlotByStaff, { leadId: a.leadId, day: "2026-11-27", hour: 9, now: NOW })).rejects.toThrow(/RDV au bureau/);
    const b = await setup();
    await asUser(b.t, b.admin).mutation(api.users.setViewAs, { userId: b.setter });
    await expect(asUser(b.t, b.admin).mutation(internal.promotions.setOfficeSlotByStaff, { leadId: b.leadId, day: "2026-11-27", hour: 9, now: NOW })).rejects.toThrow(/Lecture seule/);
  });

  it("la promo en cours annonce ses créneaux bureau", async () => {
    const { t, setter } = await setup();
    const [p] = await asUser(t, setter).query(api.promotions.active, { now: NOW });
    expect(p.officeSlots).toBe(true);
  });
});
