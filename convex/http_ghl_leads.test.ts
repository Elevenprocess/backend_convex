import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeT } from "./test.kit";

const PATH = "/webhooks/elevenprocess";
const SECRET_HEADER = "x-elevenprocess-webhook-secret";

function post(t: ReturnType<typeof makeT>, body: unknown, headers: Record<string, string> = {}) {
  return t.fetch(PATH, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.ELEVENPROCESS_WEBHOOK_SECRET = "test-secret";
  delete process.env.IMPORTS_DISABLED;
});
afterEach(() => {
  delete process.env.ELEVENPROCESS_WEBHOOK_SECRET;
  delete process.env.GHL_WEBHOOK_SECRET;
  delete process.env.IMPORTS_DISABLED;
});

describe("POST /webhooks/elevenprocess", () => {
  it("403 sans secret, avec mauvais secret, ou si le secret serveur manque", async () => {
    const t = makeT();
    expect((await post(t, { contact_id: "c1" })).status).toBe(403);
    expect((await post(t, { contact_id: "c1" }, { [SECRET_HEADER]: "faux" })).status).toBe(403);
    delete process.env.ELEVENPROCESS_WEBHOOK_SECRET;
    expect((await post(t, { contact_id: "c1" }, { [SECRET_HEADER]: "test-secret" })).status).toBe(403);
  });

  it("secret en query param accepté ; GHL_WEBHOOK_SECRET en repli", async () => {
    const t = makeT();
    const res = await t.fetch(`${PATH}?${SECRET_HEADER}=test-secret`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact_id: "c1" }),
    });
    expect(res.status).toBe(200);

    delete process.env.ELEVENPROCESS_WEBHOOK_SECRET;
    process.env.GHL_WEBHOOK_SECRET = "repli";
    const res2 = await post(t, { contact_id: "c2" }, { [SECRET_HEADER]: "repli" });
    expect(res2.status).toBe(200);
  });

  it("nominal : crée le lead, event processed, réponse parité", async () => {
    const t = makeT();
    const res = await post(
      t,
      { contact_id: "c1", first_name: "Jean", utm_source: "fb" },
      { [SECRET_HEADER]: "test-secret", "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, duplicate: false });
    expect(body.eventId).toBeTypeOf("string");
    expect(body.leadId).toBeTypeOf("string");

    const [lead] = await t.run((ctx) => ctx.db.query("leads").collect());
    expect(lead).toMatchObject({
      externalId: "c1", source: "ghl", firstName: "Jean", acquisitionChannel: "meta",
    });
    const [event] = await t.run((ctx) => ctx.db.query("webhookEvents").collect());
    expect(event).toMatchObject({
      provider: "ghl", eventType: "contact.created", status: "processed", ipAddress: "1.2.3.4",
    });
    expect(JSON.parse(event.payload)).toMatchObject({ contact_id: "c1" });
  });

  it("doublon → duplicate:true sans recréation", async () => {
    const t = makeT();
    await post(t, { contact_id: "c1" }, { [SECRET_HEADER]: "test-secret" });
    const res = await post(t, { contact_id: "c1" }, { [SECRET_HEADER]: "test-secret" });
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true });
    expect(await t.run((ctx) => ctx.db.query("leads").collect())).toHaveLength(1);
  });

  it("IMPORTS_DISABLED=true → event processed + skipped, AUCUN lead", async () => {
    const t = makeT();
    process.env.IMPORTS_DISABLED = "true";
    const res = await post(t, { contact_id: "c1" }, { [SECRET_HEADER]: "test-secret" });
    expect(await res.json()).toMatchObject({ ok: true, skipped: true });
    expect(await t.run((ctx) => ctx.db.query("leads").collect())).toHaveLength(0);
    const [event] = await t.run((ctx) => ctx.db.query("webhookEvents").collect());
    expect(event.status).toBe("processed");
  });

  it("body non-JSON → 400 sans event", async () => {
    const t = makeT();
    const res = await t.fetch(PATH, {
      method: "POST",
      headers: { "content-type": "application/json", [SECRET_HEADER]: "test-secret" },
      body: "pas du json",
    });
    expect(res.status).toBe(400);
    expect(await t.run((ctx) => ctx.db.query("webhookEvents").collect())).toHaveLength(0);
  });
});
