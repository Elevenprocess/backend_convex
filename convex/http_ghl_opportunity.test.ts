import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeT } from "./test.kit";

const PATH = "/webhooks/ghl/opportunity";
const SECRET_HEADER = "x-elevenprocess-webhook-secret";

function post(t: ReturnType<typeof makeT>, body: unknown) {
  return t.fetch(PATH, {
    method: "POST",
    headers: { "content-type": "application/json", [SECRET_HEADER]: "test-secret" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.ELEVENPROCESS_WEBHOOK_SECRET = "test-secret";
  delete process.env.IMPORTS_DISABLED;
});
afterEach(() => {
  delete process.env.ELEVENPROCESS_WEBHOOK_SECRET;
  delete process.env.IMPORTS_DISABLED;
});

describe("POST /webhooks/ghl/opportunity", () => {
  it("403 sans secret", async () => {
    const t = makeT();
    const res = await t.fetch(PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact_id: "c1", stage_name: "x" }),
    });
    expect(res.status).toBe(403);
  });

  it("nominal : applique le stage, réponse parité, event processed", async () => {
    const t = makeT();
    await t.run((ctx) =>
      ctx.db.insert("leads", { source: "ghl", externalId: "c1", status: "qualifie" }),
    );
    const res = await post(t, {
      event: "opportunity.stage_changed",
      contact_id: "c1",
      stage_name: "5. RDV Planifié 📅",
      monetary_value: "9500",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true, created: false, statusChanged: true, historyAppended: true, sideEffect: null,
    });
    const [lead] = await t.run((ctx) => ctx.db.query("leads").collect());
    expect(lead).toMatchObject({ status: "rdv_pris", monetaryValue: 9500 });
    const [event] = await t.run((ctx) => ctx.db.query("webhookEvents").collect());
    expect(event).toMatchObject({ eventType: "opportunity.stage_changed", status: "processed" });
  });

  it("sideEffect propagé dans la réponse (no-show)", async () => {
    const t = makeT();
    await t.run((ctx) =>
      ctx.db.insert("leads", { source: "ghl", externalId: "c1", status: "rdv_pris" }),
    );
    const res = await post(t, { contact_id: "c1", stage_name: "🙅‍♂️ (BIS) No-Show" });
    expect(await res.json()).toMatchObject({ ok: true, sideEffect: "rdv_no_show" });
  });

  it("sync projet : le statut projet est calqué sur le statut lead", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      const commercialId = await ctx.db.insert("users", {
        email: "c@ecoi.fr", role: "commercial", active: true,
      });
      const leadId = await ctx.db.insert("leads", {
        source: "ghl", externalId: "c1", status: "rdv_pris", assignedToId: commercialId,
      });
      await ctx.db.insert("projects", {
        leadId, commercialId, name: "P", status: "qualification",
      });
    });
    await post(t, { contact_id: "c1", stage_name: "10. Devis En Attente 📝" });
    const [project] = await t.run((ctx) => ctx.db.query("projects").collect());
    expect(project.status).toBe("devis_en_cours");
  });

  it("payload invalide (contact_id manquant) → 200 ok:false + event failed", async () => {
    const t = makeT();
    const res = await post(t, { stage_name: "5. RDV Planifié 📅" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("contact_id");
    const [event] = await t.run((ctx) => ctx.db.query("webhookEvents").collect());
    expect(event.status).toBe("failed");
  });

  it("IMPORTS_DISABLED=true → skipped, aucun changement lead", async () => {
    const t = makeT();
    process.env.IMPORTS_DISABLED = "true";
    const leadId = await t.run((ctx) =>
      ctx.db.insert("leads", { source: "ghl", externalId: "c1", status: "qualifie" }),
    );
    const res = await post(t, { contact_id: "c1", stage_name: "12. Devis Perdu 💔" });
    expect(await res.json()).toMatchObject({ ok: true, skipped: true });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.status).toBe("qualifie");
  });

  it("eventType par défaut opportunity.changed", async () => {
    const t = makeT();
    await post(t, { contact_id: "c1", stage_name: "5. RDV Planifié 📅" });
    const [event] = await t.run((ctx) => ctx.db.query("webhookEvents").collect());
    expect(event.eventType).toBe("opportunity.changed");
  });
});
