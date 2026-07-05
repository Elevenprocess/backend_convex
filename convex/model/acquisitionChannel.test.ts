import { describe, expect, it } from "vitest";
import { deriveAcquisitionChannel, normalizeSource } from "./acquisitionChannel";

const empty = new Map<string, string>();

describe("deriveAcquisitionChannel", () => {
  it("Meta : medium facebook/instagram prioritaire", () => {
    expect(deriveAcquisitionChannel({ medium: "facebook" }, empty)).toBe("meta");
    expect(deriveAcquisitionChannel({ medium: "Instagram" }, empty)).toBe("meta");
  });
  it("Meta : fbclid, utm, sessionSource Paid Social / Social media", () => {
    expect(deriveAcquisitionChannel({ fbclid: "abc" }, empty)).toBe("meta");
    expect(deriveAcquisitionChannel({ utmSource: "ig" }, empty)).toBe("meta");
    expect(deriveAcquisitionChannel({ sessionSource: "Paid Social" }, empty)).toBe("meta");
    expect(deriveAcquisitionChannel({ sessionSource: "Social media" }, empty)).toBe("meta");
  });
  it("WhatsApp → referral (décision métier)", () => {
    expect(deriveAcquisitionChannel({ medium: "whatsapp" }, empty)).toBe("referral");
  });
  it("Google : gclid ou utm", () => {
    expect(deriveAcquisitionChannel({ gclid: "x" }, empty)).toBe("google");
    expect(deriveAcquisitionChannel({ utmSource: "adwords" }, empty)).toBe("google");
  });
  it("Organic : Organic Search / form / Manual / CRM", () => {
    expect(deriveAcquisitionChannel({ sessionSource: "Organic Search" }, empty)).toBe("organic");
    expect(deriveAcquisitionChannel({ medium: "form" }, empty)).toBe("organic");
    expect(deriveAcquisitionChannel({ medium: "Manual" }, empty)).toBe("organic");
    expect(deriveAcquisitionChannel({ sessionSource: "CRM Workflows" }, empty)).toBe("organic");
    expect(deriveAcquisitionChannel({ sessionSource: "CRM UI" }, empty)).toBe("organic");
  });
  it("Direct traffic → direct", () => {
    expect(deriveAcquisitionChannel({ sessionSource: "Direct traffic" }, empty)).toBe("direct");
  });
  it("fallback sourceMap sur la source brute normalisée, sinon other", () => {
    const map = new Map([["parrainage bouche à oreille", "referral"]]);
    expect(deriveAcquisitionChannel({ canalAcquisition: " Parrainage bouche à oreille " }, map)).toBe("referral");
    expect(deriveAcquisitionChannel({ canalAcquisition: "site inconnu" }, map)).toBe("other");
    expect(deriveAcquisitionChannel({}, empty)).toBe("other");
  });
  it("priorité : Meta gagne sur Google et sur le fallback", () => {
    const map = new Map([["x", "organic"]]);
    expect(deriveAcquisitionChannel({ fbclid: "a", gclid: "b", canalAcquisition: "x" }, map)).toBe("meta");
  });
});

describe("normalizeSource", () => {
  it("lowercase + trim, tolère null/undefined", () => {
    expect(normalizeSource("  Facebook ")).toBe("facebook");
    expect(normalizeSource(null)).toBe("");
    expect(normalizeSource(undefined)).toBe("");
  });
});
