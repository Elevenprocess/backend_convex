import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function setup() {
  const t = makeT();
  const admin = await insertUser(t, { role: "admin" });
  const setter = await insertUser(t, { role: "setter", email: "s@ecoi.fr" });
  const commercialId = await insertUser(t, { role: "commercial", email: "c@ecoi.fr" });
  const promotionId = await asUser(t, admin).mutation(api.promotions.create, { name: "BF", startDay: "2026-11-23", endDay: "2026-11-29" });
  const leadId = await t.run((ctx) => ctx.db.insert("leads", {
    source: "ghl", status: "nouveau", firstName: "Julie", phone: "+262692000001", promotionId,
    promotionSlotDay: "2026-11-27", promotionSlotHour: 10, promotionTicket: "BF-0007",
  }));
  return { t, setter, commercialId, leadId };
}

describe("RDV à domicile choisi → RDV au bureau annulé", () => {
  it("un RDV à domicile programme l'annulation ; le créneau est retiré de la fiche (billet gardé) et tracé", async () => {
    vi.useFakeTimers();
    try {
      const { t, commercialId, leadId } = await setup();
      await asUser(t, commercialId).mutation(api.rdv.create, { leadId, commercialId, scheduledAt: Date.now() + 86_400_000 });
      const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
      expect(scheduled.map((s) => s.name)).toContain("promotions:cancelOfficeSlotForDomicile");
      // Funnel et GHL non configurés en test : la place est signalée « à rendre à la main ».
      await t.action(internal.promotions.cancelOfficeSlotForDomicile, { leadId });
      const lead = await t.run((ctx) => ctx.db.get(leadId));
      expect(lead?.promotionSlotDay).toBeUndefined();
      expect(lead?.promotionSlotHour).toBeUndefined();
      expect(lead?.promotionTicket).toBe("BF-0007");
      const logs = await t.run((ctx) => ctx.db.query("activityLog").collect());
      expect(logs.some((l) => l.action === "lead.promotion.office_slot_cancelled")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un RDV au bureau (agence) ne déclenche rien", async () => {
    vi.useFakeTimers();
    try {
      const { t, commercialId, leadId } = await setup();
      await asUser(t, commercialId).mutation(api.rdv.create, { leadId, commercialId, scheduledAt: Date.now() + 86_400_000, locationType: "agence" });
      const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
      expect(scheduled.map((s) => s.name)).not.toContain("promotions:cancelOfficeSlotForDomicile");
    } finally {
      vi.useRealTimers();
    }
  });
});
