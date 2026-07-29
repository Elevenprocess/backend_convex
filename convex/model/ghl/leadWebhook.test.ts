import { describe, expect, it } from "vitest";
import { mapGhlLeadPayload } from "./leadWebhook";

describe("mapGhlLeadPayload", () => {
  it("extrait externalId depuis contact_id / contactId / id (priorité)", () => {
    expect(mapGhlLeadPayload({ contact_id: "c1" }).externalId).toBe("c1");
    expect(mapGhlLeadPayload({ contactId: "c2" }).externalId).toBe("c2");
    expect(mapGhlLeadPayload({ id: "c3" }).externalId).toBe("c3");
    expect(mapGhlLeadPayload({}).externalId).toBeUndefined();
  });

  it("alias snake/camel : premier non-vide gagne, valeurs trimées", () => {
    const m = mapGhlLeadPayload({
      contact_id: "c1", first_name: " Jean ", lastName: "Dupont",
      email: "j@d.re", phone: "0692", address1: "1 rue X", city: "Saint-Denis",
      postal_code: "97400", utm_source: "fb", utm_medium: "cpc", utmCampaign: "camp",
      campaign: "A", adset: "B", ad: "C", canal_acquisition: "src",
      campaign_id: "ci", adsetId: "asi", ad_id: "ai",
      medium: "facebook", session_source: "Paid Social",
    });
    expect(m.data).toMatchObject({
      firstName: "Jean", lastName: "Dupont", email: "j@d.re", phone: "0692",
      addressLine: "1 rue X", city: "Saint-Denis", postalCode: "97400",
      utmSource: "fb", utmMedium: "cpc", utmCampaign: "camp",
      campaign: "A", adset: "B", ad: "C", canalAcquisition: "src",
      campaignId: "ci", adsetId: "asi", adId: "ai",
      attributionMedium: "facebook", attributionSessionSource: "Paid Social",
    });
    expect(m.signals).toEqual({
      fbclid: undefined, gclid: undefined, utmSource: "fb",
      medium: "facebook", sessionSource: "Paid Social", canalAcquisition: "src",
    });
  });

  it("full_name / name splitté si first/last absents", () => {
    expect(mapGhlLeadPayload({ full_name: "Marie Claire Payet" }).data).toMatchObject({
      firstName: "Marie", lastName: "Claire Payet",
    });
    expect(mapGhlLeadPayload({ name: "Cimendef" }).data).toMatchObject({
      firstName: "Cimendef",
    });
    expect(mapGhlLeadPayload({ name: "Cimendef" }).data.lastName).toBeUndefined();
    // first_name présent → pas de split
    expect(mapGhlLeadPayload({ first_name: "A", full_name: "B C" }).data.lastName).toBeUndefined();
  });

  it("canalAcquisition : canal_acquisition > canalAcquisition > source ; champs vides → undefined", () => {
    expect(mapGhlLeadPayload({ source: "site" }).data.canalAcquisition).toBe("site");
    expect(mapGhlLeadPayload({ canal_acquisition: "x", source: "y" }).data.canalAcquisition).toBe("x");
    const m = mapGhlLeadPayload({ email: "", phone: "   " });
    expect(m.data.email).toBeUndefined();
    expect(m.data.phone).toBeUndefined();
  });

  it("valeurs non-string ignorées (payload GHL freestyle)", () => {
    const m = mapGhlLeadPayload({ contact_id: 42 as unknown as string, first_name: { a: 1 } });
    expect(m.externalId).toBeUndefined();
    expect(m.data.firstName).toBeUndefined();
  });

  it("attribution IMBRIQUÉE lue : contact.attributionSource (payload workflow réel)", () => {
    const m = mapGhlLeadPayload({
      contact_id: "abc",
      contact: { attributionSource: { sessionSource: "CRM Workflows", medium: "Manual", mediumId: null } },
      workflow: { id: "w1", name: "[01.2] New Lead | Simulateur" },
    });
    expect(m.signals).toMatchObject({
      medium: "Manual",
      sessionSource: "CRM Workflows",
      canalAcquisition: "[01.2] New Lead | Simulateur",
    });
    expect(m.data.attributionMedium).toBe("Manual");
    expect(m.data.attributionSessionSource).toBe("CRM Workflows");
  });

  it("attribution imbriquée : contact.attributionSource prime sur lastAttributionSource, clés à plat priment sur tout", () => {
    const nested = mapGhlLeadPayload({
      lastAttributionSource: { medium: "form", utmSource: "old" },
      contact: { attributionSource: { medium: "facebook", fbclid: "f1" } },
    });
    expect(nested.signals.medium).toBe("facebook");
    expect(nested.signals.fbclid).toBe("f1");
    expect(nested.signals.utmSource).toBe("old"); // fusion : le champ absent remonte
    const flat = mapGhlLeadPayload({
      medium: "instagram",
      contact: { attributionSource: { medium: "form" } },
    });
    expect(flat.signals.medium).toBe("instagram");
  });

  it("canalAcquisition : repli sur le nom du workflow quand source absente", () => {
    expect(
      mapGhlLeadPayload({ workflow: { name: "[01.2] New Lead | Simulateur" } }).data.canalAcquisition,
    ).toBe("[01.2] New Lead | Simulateur");
    // source contact prioritaire sur le workflow
    expect(
      mapGhlLeadPayload({ source: "site", workflow: { name: "W" } }).data.canalAcquisition,
    ).toBe("site");
  });
});
