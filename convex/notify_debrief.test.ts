import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { notifyDebriefCreated } from "./model/notify";
import { debriefCreatedMessage } from "./model/notifMessages";

describe("debriefCreatedMessage", () => {
  it("titre + corps avec commercial, issue et montant", () => {
    const vente = debriefCreatedMessage({ commercialName: "Paul", outcome: "vente", montantTotal: 15000 });
    expect(vente.title).toContain("débrief");
    expect(vente.body).toContain("Paul");
    expect(vente.body).toContain("15");
    const nv = debriefCreatedMessage({ commercialName: "Paul", outcome: "non_vente" });
    expect(nv.body).toContain("Paul");
  });
});

describe("notifyDebriefCreated", () => {
  it("notifie chaque commercial_lead actif, ignore supprimés/autres rôles", async () => {
    const t = makeT();
    const managerA = await t.run((ctx) => ctx.db.insert("users", { email: "a", name: "A", role: "commercial_lead", active: true }));
    await t.run((ctx) => ctx.db.insert("users", { email: "b", name: "B", role: "commercial_lead", active: true, deletedAt: 1 }));
    await t.run((ctx) => ctx.db.insert("users", { email: "c", name: "C", role: "commercial", active: true }));
    const commercialId = await t.run((ctx) => ctx.db.insert("users", { email: "d", name: "Vendeur", role: "commercial", active: true }));

    await t.run((ctx) => notifyDebriefCreated(ctx, { commercialId, outcome: "vente", montantTotal: 9000 }));

    const notifs = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({ userId: managerA, type: "debrief_created" });
    expect(notifs[0].body).toContain("Vendeur");
  });

  it("intégration : createForLead(vente) déclenche la notification", async () => {
    const t = makeT();
    await t.run((ctx) => ctx.db.insert("users", { email: "m", name: "Manager", role: "commercial_lead", active: true }));
    const comId = await insertUser(t, { role: "commercial" });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "manual", status: "rdv_pris" }));
    await asUser(t, comId).mutation(api.debriefs.createForLead, { leadId, outcome: "non_vente", nonSaleReason: "trop_cher" });
    const notifs = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(notifs.some((n) => n.type === "debrief_created")).toBe(true);
  });
});
