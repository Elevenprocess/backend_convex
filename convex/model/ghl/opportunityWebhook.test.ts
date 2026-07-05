import { describe, expect, it } from "vitest";
import {
  GhlOpportunityWebhookValidationError,
  normalizeOpportunityWebhook,
} from "./opportunityWebhook";

const NOW = Date.parse("2026-07-05T10:00:00Z");

describe("normalizeOpportunityWebhook", () => {
  it("payload nominal : alias résolus, monetary_value string → number", () => {
    const n = normalizeOpportunityWebhook({
      event: " opportunity.stage_changed ",
      contact_id: "c1",
      pipeline_id: "p1",
      stage_name: "11. Devis Signé ✍️",
      status: "won",
      monetary_value: "12500,50",
      assigned_user_id: "ghl-u1",
      lost_reason_name: "Trop cher",
      occurred_at: "2026-07-04T08:30:00.000Z",
      first_name: "Jean", email: "j@d.re",
    }, NOW);
    expect(n).toMatchObject({
      event: "opportunity.stage_changed",
      externalId: "c1",
      ghlStageName: "11. Devis Signé ✍️",
      ghlPipelineId: "p1",
      status: "won",
      monetaryValue: 12500.5,
      ghlAssignedUserId: "ghl-u1",
      lostReason: "Trop cher",
      occurredAt: Date.parse("2026-07-04T08:30:00.000Z"),
    });
    expect(n.contactSeed).toEqual({
      firstName: "Jean", lastName: undefined, email: "j@d.re", phone: undefined,
    });
  });

  it("contact_id manquant → GhlOpportunityWebhookValidationError", () => {
    expect(() => normalizeOpportunityWebhook({ stage_name: "x" }, NOW))
      .toThrow(GhlOpportunityWebhookValidationError);
  });

  it("stage_name manquant → GhlOpportunityWebhookValidationError", () => {
    expect(() => normalizeOpportunityWebhook({ contact_id: "c1" }, NOW))
      .toThrow(GhlOpportunityWebhookValidationError);
  });

  it("stage via pipeline_stage / pipelineStage ; assigned via assigned_to", () => {
    const n = normalizeOpportunityWebhook(
      { contactId: "c1", pipeline_stage: "5. RDV Planifié 📅", assigned_to: "u9" }, NOW);
    expect(n.ghlStageName).toBe("5. RDV Planifié 📅");
    expect(n.ghlAssignedUserId).toBe("u9");
  });

  it("occurred_at absent ou invalide → nowMs ; event absent → opportunity.changed", () => {
    expect(normalizeOpportunityWebhook({ contact_id: "c", stage_name: "s" }, NOW).occurredAt).toBe(NOW);
    expect(normalizeOpportunityWebhook(
      { contact_id: "c", stage_name: "s", occurred_at: "pas-une-date" }, NOW).occurredAt).toBe(NOW);
    expect(normalizeOpportunityWebhook({ contact_id: "c", stage_name: "s" }, NOW).event)
      .toBe("opportunity.changed");
  });

  it("monetary_value number direct ; invalide → undefined", () => {
    expect(normalizeOpportunityWebhook(
      { contact_id: "c", stage_name: "s", monetaryValue: 990 }, NOW).monetaryValue).toBe(990);
    expect(normalizeOpportunityWebhook(
      { contact_id: "c", stage_name: "s", monetary_value: "abc" }, NOW).monetaryValue).toBeUndefined();
  });
});
