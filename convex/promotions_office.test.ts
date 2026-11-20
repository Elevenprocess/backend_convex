import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function seed(t: ReturnType<typeof makeT>, now: number) {
  const admin = await insertUser(t, { role: "admin" });
  return await t.run((ctx) => ctx.db.insert("promotions", {
    name: "BF", tag: "bf", tagKey: "bf", startAt: now - 3_600_000, endAt: now + 3_600_000,
    officeCalendarId: "CAL_BUREAU", officeAddress: "45 rue ruisseaux des noirs, Saint-Denis",
    archived: false, createdBy: admin, createdAt: now,
  }));
}

describe("RDV bureau", () => {
  it("officeCalendarForBooking : promo en cours seulement", async () => {
    const t = makeT();
    const now = Date.now();
    const promoId = await seed(t, now);
    expect(await t.query(internal.promotions.officeCalendarForBooking, { calendarId: "CAL_BUREAU", now }))
      .toMatchObject({ promotionId: promoId });
    expect(await t.query(internal.promotions.officeCalendarForBooking, { calendarId: "AUTRE", now })).toBeNull();
    expect(await t.query(internal.promotions.officeCalendarForBooking, { calendarId: "CAL_BUREAU", now: now + 7_200_000 })).toBeNull();
  });

  it("finalizeAppointment pose agence + promotionId sur le RDV", async () => {
    const t = makeT();
    const now = Date.now();
    const promoId = await seed(t, now);
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", createdAt: now }));
    const { rdvId } = await t.mutation(internal.ghlAppointments.finalizeAppointment, {
      leadId, contactId: "ghl-x", appointmentId: "appt-1", scheduledAt: now + 86_400_000,
      locationType: "agence", promotionId: promoId,
    });
    const rdv = await t.run((ctx) => ctx.db.get(rdvId));
    expect(rdv).toMatchObject({ locationType: "agence", promotionId: promoId });
  });

  it("createAppointment en agence avec un calendrier non autorisé est refusé avant tout appel GHL", async () => {
    process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "x";
    process.env.GHL_LOCATION_ID = "loc";
    // Tout appel réseau doit échouer bruyamment : le refus doit arriver avant.
    const fetchSpy = vi.fn(() => { throw new Error("appel réseau inattendu"); });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const t = makeT();
      const now = Date.now();
      await seed(t, now);
      const setter = await insertUser(t, { role: "setter", email: "s@x.fr" });
      const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", createdAt: now }));
      await expect(asUser(t, setter).action(api.ghlAppointments.createAppointment, {
        leadId, sector: "Bureau", calendarId: "CAL_PIRATE", scheduledAt: now + 86_400_000, locationType: "agence",
      })).rejects.toThrow(/aucune promotion en cours/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
      delete process.env.GHL_LOCATION_ID;
    }
  });
});
