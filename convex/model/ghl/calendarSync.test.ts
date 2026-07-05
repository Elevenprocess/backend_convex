import { describe, expect, it } from "vitest";
import {
  GHL_RDV_SYNC_MIN_MS, SYNCED_NOTES_PREFIX, boundRdvEventsRange,
  buildSyncedRdvNotes, leadPatchFromGhlEvent, mapGhlStatusToRdvStatus,
  scopeGhlEventsToCommercial, splitDateRange,
} from "./calendarSync";

const DAY = 24 * 60 * 60 * 1000;

describe("mapGhlStatusToRdvStatus", () => {
  it("matrice complète, insensible à la casse, défaut planifie", () => {
    for (const s of ["cancelled", "canceled", "cancel", "annule", "annulé"]) expect(mapGhlStatusToRdvStatus(s)).toBe("annule");
    for (const s of ["showed", "completed", "complete", "honore", "honoré"]) expect(mapGhlStatusToRdvStatus(s)).toBe("honore");
    for (const s of ["noshow", "no_show", "no-show"]) expect(mapGhlStatusToRdvStatus(s)).toBe("no_show");
    for (const s of ["rescheduled", "reporte", "reporté"]) expect(mapGhlStatusToRdvStatus(s)).toBe("reporte");
    expect(mapGhlStatusToRdvStatus("CONFIRMED")).toBe("planifie");
    expect(mapGhlStatusToRdvStatus(undefined)).toBe("planifie");
  });
});

describe("buildSyncedRdvNotes", () => {
  it("préfixe marqueur + lignes optionnelles", () => {
    const notes = buildSyncedRdvNotes({
      id: "e", calendarId: "c", startTime: "2026-07-10T09:00:00Z",
      sector: "ouest", commercialName: "Paul", contactName: "Jean", contactPhone: "0692",
    });
    expect(notes.startsWith(SYNCED_NOTES_PREFIX)).toBe(true);
    expect(notes).toContain("Secteur : ouest");
    expect(notes).toContain("Commercial ECOI : Paul");
    expect(notes).not.toContain("Email");
  });
});

describe("splitDateRange", () => {
  it("≤30 j = 1 fenêtre ; 90 j = 4 ; bornes couvrantes", () => {
    const from = Date.parse("2026-07-01T00:00:00Z");
    expect(splitDateRange(from, from + 10 * DAY)).toHaveLength(1);
    const ranges = splitDateRange(from, from + 90 * DAY);
    expect(ranges.length).toBeGreaterThanOrEqual(3);
    expect(ranges[0].fromMs).toBe(from);
    expect(ranges.at(-1)!.toMs).toBe(from + 90 * DAY);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].fromMs).toBe(ranges[i - 1].toMs + 1);
  });
});

describe("boundRdvEventsRange", () => {
  it("borne min 2026-01-01, plage entièrement avant → null", () => {
    const before = Date.parse("2025-12-01T00:00:00Z");
    expect(boundRdvEventsRange(before, before + DAY)).toBeNull();
    const r = boundRdvEventsRange(before, GHL_RDV_SYNC_MIN_MS + DAY);
    expect(r).toEqual({ fromMs: GHL_RDV_SYNC_MIN_MS, toMs: GHL_RDV_SYNC_MIN_MS + DAY });
    const after = GHL_RDV_SYNC_MIN_MS + 10 * DAY;
    expect(boundRdvEventsRange(after, after + DAY)).toEqual({ fromMs: after, toMs: after + DAY });
  });
});

describe("leadPatchFromGhlEvent", () => {
  it("champs non vides seulement, split du contactName, status qualifie toujours", () => {
    const patch = leadPatchFromGhlEvent({
      id: "e", calendarId: "c", startTime: "s",
      contactName: "Marie Claire Payet", contactPhone: "0692", commercialId: "u1",
    });
    expect(patch).toEqual({
      firstName: "Marie Claire", lastName: "Payet", phone: "0692",
      assignedToId: "u1", status: "qualifie",
    });
    expect(leadPatchFromGhlEvent({ id: "e", calendarId: "c", startTime: "s" })).toEqual({ status: "qualifie" });
  });
});

describe("scopeGhlEventsToCommercial", () => {
  const events = [
    { id: "a", calendarId: "c", startTime: "s", commercialId: "u1" },
    { id: "b", calendarId: "c", startTime: "s" },
  ];
  it("commercial → seulement ses events ; autres rôles inchangés ; copie", () => {
    const result = { configured: true, events };
    const scoped = scopeGhlEventsToCommercial(result, { userId: "u1", role: "commercial" });
    expect(scoped.events.map((e) => e.id)).toEqual(["a"]);
    expect(result.events).toHaveLength(2);
    expect(scopeGhlEventsToCommercial(result, { userId: "u1", role: "commercial_lead" })).toBe(result);
    expect(scopeGhlEventsToCommercial(result, undefined)).toBe(result);
  });
});
