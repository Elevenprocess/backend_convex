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

  it("persistGhlEvents : sector Bureau -> agence, secteur Nord -> domicile", async () => {
    const t = makeT();
    const iso = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const r = await t.mutation(internal.ghlCalendar.persistGhlEvents, {
      events: [
        { id: "evB", calendarId: "CAL_BUREAU", startTime: iso, contactId: "cB", status: "confirmed", sector: "Bureau", contactName: "Ana Bureau" },
        { id: "evN", calendarId: "CAL_NORD", startTime: iso, contactId: "cN", status: "confirmed", sector: "Nord", contactName: "Luc Nord" },
      ] as never,
      now: Date.now(),
    });
    expect(r.created).toBe(2);
    const rdvs = await t.run((ctx) => ctx.db.query("rdv").collect());
    expect(rdvs.find((x) => x.externalId === "evB")?.locationType).toBe("agence");
    expect(rdvs.find((x) => x.externalId === "evN")?.locationType).toBe("domicile");
  });

  it("calendrier bureau en erreur 500 : les événements des secteurs reviennent quand même", async () => {
    process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "x";
    process.env.GHL_LOCATION_ID = "loc";
    process.env.GHL_SECTOR_CALENDARS = JSON.stringify({ nord: "CAL_NORD" });
    const now = Date.now();
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname.startsWith("/contacts/")) return new Response("{}", { status: 404 });
      if (u.searchParams.get("calendarId") === "CAL_BUREAU") return new Response('{"message":"boom"}', { status: 500 });
      return new Response(JSON.stringify({ events: [{
        id: "evN", calendarId: "CAL_NORD", startTime: new Date(now + 86_400_000).toISOString(),
        endTime: new Date(now + 90_000_000).toISOString(), appointmentStatus: "confirmed",
      }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const t = makeT();
      await seed(t, now);
      const setter = await insertUser(t, { role: "setter", email: "s2@x.fr" });
      const r = await asUser(t, setter).action(api.ghlCalendar.syncEvents, { from: now, to: now + 3 * 86_400_000 });
      expect(r.configured).toBe(true);
      expect(r.events.map((e) => e.id)).toEqual(["evN"]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("CAL_BUREAU"));
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
      delete process.env.GHL_LOCATION_ID;
      delete process.env.GHL_SECTOR_CALENDARS;
    }
  });
});
