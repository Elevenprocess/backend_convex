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
    source: "ghl", status: "nouveau", firstName: "Julie", externalId: "c1aaaaaaaaaaaaaaaaaa", promotionId, promotionJoinedAt: NOW, promotionSource: "tag",
  }));
  return { t, admin, setter, promotionId, leadId };
}

describe("RDV au bureau choisi par le setter", () => {
  it("range le créneau sur la fiche et renvoie la config GHL", async () => {
    const { t, setter, leadId } = await setup();
    const r = await asUser(t, setter).mutation(internal.promotions.setOfficeSlotByStaff, { leadId, day: "2026-11-29", hour: 10, now: NOW });
    expect(r).toMatchObject({ externalId: "c1aaaaaaaaaaaaaaaaaa", name: "Julie", sync: SYNC });
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

  it("premier créneau → automatisation « créneau réservé » à lancer ; créneau déjà pris sur le site → non", async () => {
    const { t, setter, leadId, promotionId } = await setup();
    const as = asUser(t, setter);
    const first = await as.mutation(internal.promotions.setOfficeSlotByStaff, { leadId, day: "2026-11-27", hour: 9, now: NOW });
    expect(first.workflowPending).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.promotionSlotWorkflow).toBe("pending");
    // Échec GHL puis « Réessayer » : toujours à lancer tant que pas fait.
    expect((await as.mutation(internal.promotions.setOfficeSlotByStaff, { leadId, day: "2026-11-27", hour: 9, now: NOW })).workflowPending).toBe(true);
    await t.mutation(internal.promotions.markSlotWorkflowDone, { leadId });
    expect((await as.mutation(internal.promotions.setOfficeSlotByStaff, { leadId, day: "2026-11-28", hour: 9, now: NOW })).workflowPending).toBe(false);

    const fromSite = await t.run((ctx) => ctx.db.insert("leads", {
      source: "ghl", status: "nouveau", externalId: "c2", promotionId, promotionSlotDay: "2026-11-27", promotionSlotHour: 10,
    }));
    expect((await as.mutation(internal.promotions.setOfficeSlotByStaff, { leadId: fromSite, day: "2026-11-27", hour: 10, now: NOW })).workflowPending).toBe(false);
  });

  it("lead migré : utilise le vrai id de contact GHL (ghlContactId), pas l'uuid de l'ancienne base", async () => {
    const { t, setter, promotionId } = await setup();
    const migrated = await t.run((ctx) => ctx.db.insert("leads", {
      source: "ghl", status: "nouveau", externalId: "d56581e6-1725-4b83-b0b8-0aa82902061a", ghlContactId: "2aMnM4Od6x14zgwq1qUx", promotionId,
    }));
    const r = await asUser(t, setter).mutation(internal.promotions.setOfficeSlotByStaff, { leadId: migrated, day: "2026-11-27", hour: 12, now: NOW });
    expect(r.externalId).toBe("2aMnM4Od6x14zgwq1qUx");
  });

  it("ancien uuid sans contact GHL : pas d'id (le contact sera retrouvé ou recréé), coordonnées transmises", async () => {
    const { t, setter, promotionId } = await setup();
    const old = await t.run((ctx) => ctx.db.insert("leads", {
      source: "ghl", status: "nouveau", externalId: "d56581e6-1725-4b83-b0b8-0aa82902061a", firstName: "Ana", email: "ana@example.com", promotionId,
    }));
    const r = await asUser(t, setter).mutation(internal.promotions.setOfficeSlotByStaff, { leadId: old, day: "2026-11-27", hour: 12, now: NOW });
    expect(r.externalId).toBeNull();
    expect(r.contact).toMatchObject({ firstName: "Ana", email: "ana@example.com" });
    expect((await t.run((ctx) => ctx.db.get(old)))?.promotionGhlSync?.status).toBe("pending");
  });

  it("relier un contact GHL recréé : la fiche pointe dessus (les webhooks GHL le retrouvent)", async () => {
    const { t, leadId } = await setup();
    await t.mutation(internal.promotions.linkGhlContact, { leadId, contactId: "NEWaaaaaaaaaaaaaaaaa", previous: "c1aaaaaaaaaaaaaaaaaa", created: true });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.ghlContactId).toBe("NEWaaaaaaaaaaaaaaaaa");
  });

  it("remarques du setter : note GHL préparée (commentaire + éligibilité + créneau), gardée pour le renvoi", async () => {
    const { t, setter, leadId } = await setup();
    const as = asUser(t, setter);
    const notes = "RDV BUREAU\nRDV ECOI\nCommentaire setter :\nVient avec sa femme\nÉligibilité :\nPropriétaire : oui";
    const r = await as.mutation(internal.promotions.setOfficeSlotByStaff, { leadId, day: "2026-11-27", hour: 12, now: NOW, notes });
    expect(r.pendingNote).toContain("Vient avec sa femme");
    expect(r.pendingNote).toContain("Propriétaire");
    expect(r.pendingNote).toContain("Secteur Bureau");
    // Renvoi sans remarques : la note en attente est reprise.
    const again = await as.mutation(internal.promotions.setOfficeSlotByStaff, { leadId, day: "2026-11-27", hour: 12, now: NOW });
    expect(again.pendingNote).toBe(r.pendingNote);
    // Une fois créée dans GHL : plus rien à renvoyer (pas de doublon).
    await t.mutation(internal.promotions.markGhlNoteSent, { leadId });
    expect((await as.mutation(internal.promotions.setOfficeSlotByStaff, { leadId, day: "2026-11-27", hour: 12, now: NOW })).pendingNote).toBeNull();
  });
});
