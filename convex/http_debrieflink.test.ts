import { describe, expect, it } from "vitest";
import { makeT } from "./test.kit";
import { signDebriefToken } from "./model/debriefLinkToken";

const SECRET = "test-secret-http";

async function drain(t: ReturnType<typeof makeT>) {
  await new Promise((r) => setTimeout(r, 25));
  await t.finishInProgressScheduledFunctions();
}

async function seed(t: ReturnType<typeof makeT>) {
  process.env.DEBRIEF_LINK_SECRET = SECRET;
  delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  delete process.env.GHL_API_KEY;
  delete process.env.GHL_LOCATION_ID;
  const commercialId = await t.run((ctx) => ctx.db.insert("users", { email: "c@e.fr", name: "Paul", role: "commercial", active: true }));
  const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "qualifie" }));
  const rdvId = await t.run((ctx) => ctx.db.insert("rdv", { leadId, commercialId, locationType: "domicile", status: "honore", scheduledAt: 1000 }));
  return { rdvId };
}

describe("surface publique lien débrief", () => {
  it("/d/<token> → 302 vers la page débrief", async () => {
    const t = makeT();
    process.env.FRONTEND_URL = "https://crm.example.re";
    const res = await t.fetch("/d/abc.def", { method: "GET", redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://crm.example.re/#/debrief/abc.def");
  });

  it("GET /debrief-link/<token> valide → 200 payload ; token pourri → 410", async () => {
    const t = makeT();
    const { rdvId } = await seed(t);
    const token = await signDebriefToken(rdvId, SECRET);
    const ok = await t.fetch(`/debrief-link/${token}`, { method: "GET" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).rdv.id).toBe(rdvId);
    const bad = await t.fetch("/debrief-link/pas-un-token", { method: "GET" });
    expect(bad.status).toBe(410);
  });

  it("POST submit → 200 + RDV débriefé", async () => {
    const t = makeT();
    const { rdvId } = await seed(t);
    const token = await signDebriefToken(rdvId, SECRET);
    const res = await t.fetch(`/debrief-link/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "non_vente", nonSaleReason: "trop_cher" }),
    });
    await drain(t);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await t.run((ctx) => ctx.db.get(rdvId)))?.debriefFilledAt).toBeGreaterThan(0);
  });

  it("POST reschedule date passée → 400 ; future → 200", async () => {
    const t = makeT();
    const { rdvId } = await seed(t);
    const token = await signDebriefToken(rdvId, SECRET);
    const past = await t.fetch(`/debrief-link/${token}/reschedule`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduledAt: "2020-01-01T00:00:00Z" }),
    });
    expect(past.status).toBe(400);
    const future = await t.fetch(`/debrief-link/${token}/reschedule`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduledAt: "2027-01-01T09:00:00Z" }),
    });
    expect(future.status).toBe(200);
    expect((await t.run((ctx) => ctx.db.get(rdvId)))?.status).toBe("reporte");
  });
});
