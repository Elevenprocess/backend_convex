import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import { makeT } from "./test.kit";

describe("actions lien débrief (débranché)", () => {
  it("setContactDebriefLink → false si GHL non configuré", async () => {
    const t = makeT();
    delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
    delete process.env.GHL_API_KEY;
    delete process.env.GHL_LOCATION_ID;
    expect(await t.action(api.ghlDebriefLink.setContactDebriefLink, { contactExternalId: "c1", rdvId: "x" })).toBe(false);
  });

  it("syncDebriefLinksScheduled → no-op sans GHL_SYNC_ENABLED", async () => {
    const t = makeT();
    delete process.env.GHL_SYNC_ENABLED;
    expect(await t.action(internal.ghlDebriefLink.syncDebriefLinksScheduled, {})).toBeNull();
  });

  it("pushRdvDebriefScheduled → no-op si GHL non configuré", async () => {
    const t = makeT();
    delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
    delete process.env.GHL_API_KEY;
    delete process.env.GHL_LOCATION_ID;
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "qualifie" }));
    const rdvId = await t.run((ctx) => ctx.db.insert("rdv", { leadId, locationType: "domicile", status: "honore", externalId: "evt", result: "signe" }));
    expect(await t.action(internal.ghlDebriefLink.pushRdvDebriefScheduled, { rdvId })).toBeNull();
  });
});
