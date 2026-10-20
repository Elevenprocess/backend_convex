import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";

const DETAILS = (totalPrice: number) => ({
  id: "proj1", companyId: "co", externalId: "opp1", client: { id: "cl1", externalId: "ct1" },
  offers: [{ id: "q1", status: "signed", totalPrice, signedAt: "2026-10-19T08:00:00Z" }],
});
const PIPES = { pipelines: [{ id: "p1", name: "1. CRM Vente 📊", stages: [{ id: "s10", name: "10. Devis En Attente" }, { id: "s11", name: "11. Devis Signé ✍️" }] }] };
const OPP = { opportunity: { id: "opp1", pipelineId: "p1", pipelineStageId: "s10", monetaryValue: 0 } };

let calls: Array<{ method: string; url: string; body?: string }> = [];
function mockFetch(totalPrice: number) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method ?? "GET", url, ...(init?.body ? { body: String(init.body) } : {}) });
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("solteo") && url.includes("/projects/proj1/details")) return ok(DETAILS(totalPrice));
    if (url.includes("/opportunities/pipelines")) return ok(PIPES);
    if (url.includes("/opportunities/opp1")) return ok(init?.method === "PUT" ? {} : OPP);
    return new Response("not found", { status: 404 });
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env.SOLTEO_API_KEY = "k";
  process.env.SOLTEO_API_BASE_URL = "https://solteo.test/external-api";
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "t";
  process.env.GHL_LOCATION_ID = "loc";
  process.env.GHL_API_BASE_URL = "https://ghl.test";
  delete process.env.SOLTEO_GHL_WRITE_ENABLED;
  delete process.env.SOLTEO_COMPANY_ID;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const k of ["SOLTEO_API_KEY", "SOLTEO_API_BASE_URL", "GHL_PRIVATE_INTEGRATION_TOKEN", "GHL_LOCATION_ID", "GHL_API_BASE_URL", "SOLTEO_GHL_WRITE_ENABLED", "SOLTEO_WEBHOOK_SECRET"]) delete process.env[k];
});

async function runEvent(t: ReturnType<typeof makeT>) {
  const r = await t.mutation(internal.solteo.recordEvent, {
    dedupeKey: "quote_signed:q1:x", eventType: "quote_signed", projectId: "proj1", quoteId: "q1", payload: "{}", now: 1,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return r;
}

describe("ELE-179 Soltéo → GHL", () => {
  it("flag OFF (défaut) : plan journalisé, AUCUNE écriture GHL", async () => {
    const t = makeT();
    mockFetch(5119);
    await runEvent(t);
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
    const [row] = await t.run((ctx) => ctx.db.query("solteoSignedQuotes").collect());
    expect(row).toMatchObject({ quoteId: "q1", status: "logged", totalPriceTtc: 5119, ghlOpportunityId: "opp1" });
    expect(JSON.parse(row!.plan).map((s: { op: string }) => s.op)).toEqual(["set_amount", "move_stage"]);
    const [ev] = await t.run((ctx) => ctx.db.query("solteoEvents").collect());
    expect(ev?.status).toBe("processed");
  });

  it("flag ON : PUT montant PUIS PUT étape 11", async () => {
    process.env.SOLTEO_GHL_WRITE_ENABLED = "true";
    const t = makeT();
    mockFetch(5119);
    await runEvent(t);
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => JSON.parse(c.body!))).toEqual([
      { monetaryValue: 5119 }, { pipelineId: "p1", pipelineStageId: "s11" },
    ]);
    const [row] = await t.run((ctx) => ctx.db.query("solteoSignedQuotes").collect());
    expect(row?.status).toBe("stage_set");
  });

  it("montant 0 : aucun PUT même flag ON, écart journalisé", async () => {
    process.env.SOLTEO_GHL_WRITE_ENABLED = "true";
    const t = makeT();
    mockFetch(0);
    await runEvent(t);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    const [d] = await t.run((ctx) => ctx.db.query("syncDiscrepancies").collect());
    expect(d).toMatchObject({ source: "solteo", kind: "amount_not_positive" });
  });

  it("dédoublonnage : même événement → un seul enregistrement", async () => {
    const t = makeT();
    mockFetch(5119);
    const a = await runEvent(t);
    const b = await t.mutation(internal.solteo.recordEvent, {
      dedupeKey: "quote_signed:q1:x", eventType: "quote_signed", projectId: "proj1", quoteId: "q1", payload: "{}", now: 2,
    });
    expect(b).toEqual({ eventId: a.eventId, duplicate: true });
  });

  it("route HTTP : 403 sans secret, 200 + file avec secret", async () => {
    const t = makeT();
    mockFetch(5119);
    process.env.SOLTEO_WEBHOOK_SECRET = "s3cret";
    const body = JSON.stringify({ eventType: "project_created", details: { projectId: "proj1" } });
    expect((await t.fetch("/webhooks/solteo", { method: "POST", body })).status).toBe(403);
    const res = await t.fetch("/webhooks/solteo?token=s3cret", { method: "POST", body });
    expect(res.status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [ev] = await t.run((ctx) => ctx.db.query("solteoEvents").collect());
    expect(ev?.status).toBe("ignored");
  });

  it("rattrapage : no-op sans SOLTEO_API_KEY", async () => {
    delete process.env.SOLTEO_API_KEY;
    const t = makeT();
    expect(await t.action(internal.solteo.catchUpScheduled, {})).toBeNull();
  });
});
