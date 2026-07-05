import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";

describe("createLeadFromWebhook", () => {
  it("crée le lead source ghl status nouveau avec canal dérivé", async () => {
    const t = makeT();
    const r = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      externalId: "c1",
      data: { firstName: "Jean", city: "Saint-Paul", utmSource: "fb" },
      signals: { utmSource: "fb" },
    });
    expect(r.duplicate).toBe(false);
    const lead = await t.run((ctx) => ctx.db.get(r.leadId));
    expect(lead).toMatchObject({
      externalId: "c1", source: "ghl", status: "nouveau",
      firstName: "Jean", acquisitionChannel: "meta",
    });
  });

  it("dédup par externalId : pas de recréation ni de re-classification", async () => {
    const t = makeT();
    const first = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      externalId: "c1", data: { firstName: "Jean" }, signals: {},
    });
    const again = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      externalId: "c1", data: { firstName: "Autre" }, signals: { fbclid: "x" },
    });
    expect(again).toEqual({ leadId: first.leadId, duplicate: true });
    const lead = await t.run((ctx) => ctx.db.get(first.leadId));
    expect(lead?.firstName).toBe("Jean"); // aucune écriture au replay
    expect(await t.run((ctx) => ctx.db.query("leads").collect())).toHaveLength(1);
  });

  it("fallback acquisitionSourceMap consulté dans la transaction", async () => {
    const t = makeT();
    await t.run((ctx) =>
      ctx.db.insert("acquisitionSourceMap", {
        rawSource: "salon habitat", channel: "other", label: "Salon",
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("acquisitionSourceMap", {
        rawSource: "parrainage", channel: "referral", label: "Parrainage",
      }),
    );
    const r = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      externalId: "c2",
      data: { canalAcquisition: " Parrainage " },
      signals: { canalAcquisition: " Parrainage " },
    });
    expect((await t.run((ctx) => ctx.db.get(r.leadId)))?.acquisitionChannel).toBe("referral");
  });

  it("externalId absent → création quand même (pas de dédup possible)", async () => {
    const t = makeT();
    const r = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      data: { firstName: "Anonyme" }, signals: {},
    });
    expect(r.duplicate).toBe(false);
    expect((await t.run((ctx) => ctx.db.get(r.leadId)))?.externalId).toBeUndefined();
  });
});
