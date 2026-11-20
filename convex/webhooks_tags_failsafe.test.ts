import { describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";

// Le rattachement aux promos lève : la création / re-soumission du lead doit réussir quand même.
vi.mock("./model/promotionAttach", () => ({
  applyTagsToLead: vi.fn(async () => {
    throw new Error("boom promo");
  }),
}));

describe("createLeadFromWebhook : rattachement promo défaillant", () => {
  it("crée quand même le lead", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = makeT();
    const r = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      externalId: "c1", data: { firstName: "Jean" }, signals: {}, tags: ["bf"],
    });
    expect(r.duplicate).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(r.leadId))).toMatchObject({ externalId: "c1", status: "nouveau" });
    expect(warn).toHaveBeenCalled();
  });

  it("re-soumission : le lead est quand même repassé à rappeler", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = makeT();
    const first = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      externalId: "c2", data: { firstName: "Jean" }, signals: {}, tags: ["bf"],
    });
    await t.run((ctx) => ctx.db.patch(first.leadId, { status: "perdu" }));
    const again = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      externalId: "c2", data: {}, signals: {}, tags: ["bf"],
    });
    expect(again).toEqual({ leadId: first.leadId, duplicate: true });
    expect((await t.run((ctx) => ctx.db.get(first.leadId)))?.status).toBe("a_rappeler");
  });
});
