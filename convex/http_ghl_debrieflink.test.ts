// ─── Webhook GHL « envoi du lien débrief » ────────────────────────────────────
// GHL (workflow) appelle POST /webhooks/ghl/debrief-link quand le commercial
// doit débriefer ; le backend répond avec l'URL permanente du lien magique et
// pousse le champ contact `lien_debrief` (best-effort).

import { describe, expect, it } from "vitest";
import { makeT } from "./test.kit";
import { verifyDebriefToken } from "./model/debriefLinkToken";

const WEBHOOK_SECRET = "hook-secret";
const LINK_SECRET = "link-secret";

function setupEnv() {
  process.env.ELEVENPROCESS_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.DEBRIEF_LINK_SECRET = LINK_SECRET;
  process.env.CONVEX_SITE_URL = "https://spotted.convex.site";
  // GHL débranché : l'écriture du champ contact échoue proprement (false).
  delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  delete process.env.GHL_API_KEY;
  delete process.env.GHL_LOCATION_ID;
}

async function post(t: ReturnType<typeof makeT>, body: unknown, secret = WEBHOOK_SECRET) {
  return await t.fetch("/webhooks/ghl/debrief-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-elevenprocess-webhook-secret": secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function seed(t: ReturnType<typeof makeT>) {
  const leadId = await t.run((ctx) =>
    ctx.db.insert("leads", { source: "ghl", status: "rdv_honore", externalId: "contact-1" }),
  );
  const rdvId = await t.run((ctx) =>
    ctx.db.insert("rdv", {
      leadId, locationType: "domicile", status: "honore",
      externalId: "appt-1", scheduledAt: 2000,
    }),
  );
  return { leadId, rdvId };
}

describe("POST /webhooks/ghl/debrief-link", () => {
  it("refuse sans secret webhook (403)", async () => {
    const t = makeT();
    setupEnv();
    await seed(t);
    const res = await post(t, { contact_id: "contact-1" }, "");
    expect(res.status).toBe(403);
  });

  it("appointment_id → URL permanente /d/<token> + debriefDueAt marqué", async () => {
    const t = makeT();
    setupEnv();
    const { rdvId } = await seed(t);

    const res = await post(t, { appointment_id: "appt-1", contact_id: "contact-1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rdvId).toBe(rdvId);
    expect(body.url).toMatch(/^https:\/\/spotted\.convex\.site\/d\//);
    // GHL non configuré → champ contact non poussé, mais l'URL est dans la réponse.
    expect(body.fieldUpdated).toBe(false);

    // Le token est permanent (exp=0) et pointe le bon RDV.
    const payload = await verifyDebriefToken(body.token, LINK_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.rdvId).toBe(rdvId);
    expect(payload!.exp).toBe(0);

    const rdv = await t.run((ctx: any) => ctx.db.get(rdvId));
    expect(rdv.debriefDueAt).toBeGreaterThan(0);
  });

  it("contact_id seul → dernier RDV non débriefé du lead", async () => {
    const t = makeT();
    setupEnv();
    const { leadId } = await seed(t);
    // RDV plus récent mais déjà débriefé → doit être ignoré.
    await t.run((ctx) =>
      ctx.db.insert("rdv", {
        leadId, locationType: "visio", status: "honore",
        scheduledAt: 9000, debriefFilledAt: 9500,
      }),
    );
    // RDV non débriefé plus ancien → choisi.
    const res = await post(t, { contact: { id: "contact-1" } });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const rdv = await t.run((ctx: any) => ctx.db.get(body.rdvId));
    expect(rdv.debriefFilledAt).toBeUndefined();
    expect(rdv.externalId).toBe("appt-1");
  });

  it("contact inconnu → 200 {ok:false} (pas de retry GHL)", async () => {
    const t = makeT();
    setupEnv();
    await seed(t);
    const res = await post(t, { contact_id: "inconnu" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(false);
  });

  it("payload sans contact ni rendez-vous → 200 {ok:false}", async () => {
    const t = makeT();
    setupEnv();
    const res = await post(t, { hello: "world" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/contact_id ou appointment_id/);
  });

  it("customData.appointmentId accepté (payload workflow custom)", async () => {
    const t = makeT();
    setupEnv();
    const { rdvId } = await seed(t);
    const res = await post(t, { customData: { appointmentId: "appt-1" } });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rdvId).toBe(rdvId);
  });
});
