import { describe, expect, it } from "vitest";
import { makeT } from "./test.kit";
import { insertUser } from "./test.helpers";
import type { Id } from "./_generated/dataModel";

const KEY = "cle-test-promo";

async function post(t: ReturnType<typeof makeT>, body: unknown, key = KEY) {
  return await t.fetch(`/webhooks/ghl/promotion/${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function setup(window: { startAt: number; endAt: number; archived?: boolean }) {
  const t = makeT();
  const admin = await insertUser(t, { role: "admin" });
  const now = Date.now();
  const promoId: Id<"promotions"> = await t.run((ctx) => ctx.db.insert("promotions", {
    name: "BF", startAt: window.startAt, endAt: window.endAt, archived: window.archived ?? false,
    webhookKey: KEY, createdBy: admin, createdAt: now,
  }));
  return { t, promoId, now };
}

describe("POST /webhooks/ghl/promotion/<clé>", () => {
  it("clé inconnue → 404 sans rien créer", async () => {
    const now = Date.now();
    const { t } = await setup({ startAt: now - 3_600_000, endAt: now + 3_600_000 });
    const res = await post(t, { contact_id: "c1", phone: "+262692000001" }, "mauvaise");
    expect(res.status).toBe(404);
    expect(await t.run((ctx) => ctx.db.query("leads").collect())).toHaveLength(0);
  });

  it("crée le lead inconnu et le rattache à la promo en cours", async () => {
    const now = Date.now();
    const { t, promoId } = await setup({ startAt: now - 3_600_000, endAt: now + 3_600_000 });
    const res = await post(t, { contact_id: "c1", first_name: "Jean", phone: "+262692000001" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, attached: true, duplicate: false });
    const leads = await t.run((ctx) => ctx.db.query("leads").collect());
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ promotionId: promoId, promotionSource: "tag", externalId: "c1" });
    const events = await t.run((ctx) => ctx.db.query("webhookEvents").collect());
    expect(events.find((e) => e.eventType === "promotion.webhook")?.status).toBe("processed");
  });

  it("rattache un lead déjà connu sans le dupliquer", async () => {
    const now = Date.now();
    const { t, promoId } = await setup({ startAt: now - 3_600_000, endAt: now + 3_600_000 });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "a_rappeler", externalId: "c2", createdAt: now }));
    const res = await post(t, { contact_id: "c2" });
    expect(await res.json()).toMatchObject({ ok: true, attached: true, duplicate: true });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.promotionId).toBe(promoId);
    expect(await t.run((ctx) => ctx.db.query("leads").collect())).toHaveLength(1);
  });

  it("promo terminée ou archivée → ignoré, rien de créé", async () => {
    const now = Date.now();
    const { t } = await setup({ startAt: now - 7_200_000, endAt: now - 3_600_000 });
    const res = await post(t, { contact_id: "c3", phone: "+262692000003" });
    expect(await res.json()).toMatchObject({ ok: true, skipped: true });
    expect(await t.run((ctx) => ctx.db.query("leads").collect())).toHaveLength(0);
  });

  it("sans contact_id, téléphone ni email → 500 et événement en échec", async () => {
    const now = Date.now();
    const { t } = await setup({ startAt: now - 3_600_000, endAt: now + 3_600_000 });
    const res = await post(t, { first_name: "X" });
    expect(res.status).toBe(500);
    const events = await t.run((ctx) => ctx.db.query("webhookEvents").collect());
    expect(events[0]?.status).toBe("failed");
  });

  it("créneau sur un lead connu : rangé sur la fiche, sans re-soumission ni changement de statut", async () => {
    const now = Date.now();
    const { t, promoId } = await setup({ startAt: now - 3_600_000, endAt: now + 3_600_000 });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "perdu", externalId: "c5", createdAt: now }));
    const res = await post(t, { contact_id: "c5", creneau_jour: "2026-11-27", creneau_heure: 14, billet: "BF-0012" });
    expect(await res.json()).toMatchObject({ ok: true, slot: true, attached: true, duplicate: true });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead).toMatchObject({
      promotionId: promoId, promotionSlotDay: "2026-11-27", promotionSlotHour: 14, promotionTicket: "BF-0012", status: "perdu",
    });
    expect(lead?.resubmittedAt).toBeUndefined();
    const logs = await t.run((ctx) => ctx.db.query("activityLog").collect());
    expect(logs.find((l) => l.action === "lead.promotion.slot")?.summary).toContain("vendredi 27, 14 h, billet BF-0012");
    expect(logs.some((l) => l.action === "lead.resubmitted")).toBe(false);
  });

  it("changement de créneau : la fiche suit, le billet reste", async () => {
    const now = Date.now();
    const { t } = await setup({ startAt: now - 3_600_000, endAt: now + 3_600_000 });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", externalId: "c6", createdAt: now }));
    await post(t, { contact_id: "c6", creneau_jour: "2026-11-27", creneau_heure: 14, billet: "BF-0003" });
    await post(t, { contact_id: "c6", creneau_jour: "2026-11-29", creneau_heure: "9" });
    expect(await t.run((ctx) => ctx.db.get(leadId))).toMatchObject({
      promotionSlotDay: "2026-11-29", promotionSlotHour: 9, promotionTicket: "BF-0003",
    });
  });

  it("créneau sur un contact inconnu : lead créé, rattaché, créneau rangé", async () => {
    const now = Date.now();
    const { t, promoId } = await setup({ startAt: now - 3_600_000, endAt: now + 3_600_000 });
    const res = await post(t, { contact_id: "c7", first_name: "Zoé", phone: "+262692000007", creneau_jour: "2026-11-28", creneau_heure: 8, billet: "BF-0001" });
    expect(await res.json()).toMatchObject({ ok: true, slot: true, duplicate: false });
    const leads = await t.run((ctx) => ctx.db.query("leads").collect());
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ promotionId: promoId, promotionSlotDay: "2026-11-28", promotionSlotHour: 8, promotionTicket: "BF-0001" });
  });

  it("créneau invalide : ignoré, le webhook se comporte comme avant", async () => {
    const now = Date.now();
    const { t } = await setup({ startAt: now - 3_600_000, endAt: now + 3_600_000 });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", externalId: "c8", createdAt: now }));
    const res = await post(t, { contact_id: "c8", creneau_jour: "demain", creneau_heure: 30 });
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.promotionSlotDay).toBeUndefined();
  });
});
