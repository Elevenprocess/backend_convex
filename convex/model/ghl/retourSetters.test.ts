import { describe, expect, it } from "vitest";
import { pickRetourCandidates, splitContactName } from "./retourSetters";

const now = Date.parse("2026-08-27T12:00:00Z");
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const H = 3_600_000;

describe("pickRetourCandidates", () => {
  it("garde les entrées récentes, ignore le stock ancien et les lignes sans contact", () => {
    const out = pickRetourCandidates([
      { id: "o1", contact: { id: "c1", name: "Jean Payet", email: "j@x.re", phone: "0692" }, lastStageChangeAt: iso(2 * H), assignedTo: "u1", monetaryValue: 8000, pipelineId: "p1" },
      { id: "o2", contact: { id: "c2", name: "Vieux Stock" }, lastStageChangeAt: iso(40 * 24 * H) },
      { id: "o3", contact: { name: "Sans Id" }, lastStageChangeAt: iso(H) },
      { id: "o4", contactId: "c4", name: "Marie", updatedAt: iso(5 * H) }, // pas de lastStageChangeAt → updatedAt
    ], now);
    expect(out.map((c) => c.contactId)).toEqual(["c4", "c1"]); // trié par date croissante
    expect(out[1]).toMatchObject({
      contactId: "c1", occurredAt: now - 2 * H, ghlAssignedUserId: "u1", monetaryValue: 8000, ghlPipelineId: "p1",
      contactSeed: { firstName: "Jean", lastName: "Payet", email: "j@x.re", phone: "0692" },
    });
    expect(out[0].contactSeed).toEqual({ firstName: "Marie" });
  });

  it("fenêtre paramétrable ; un contact en double → la plus récente seulement", () => {
    const rows = [
      { contact: { id: "c1", name: "A" }, lastStageChangeAt: iso(10 * 24 * H) },
      { contact: { id: "c1", name: "A" }, lastStageChangeAt: iso(20 * 24 * H) },
    ];
    expect(pickRetourCandidates(rows, now)).toHaveLength(0);
    const wide = pickRetourCandidates(rows, now, 30 * 24 * H);
    expect(wide).toHaveLength(1);
    expect(wide[0].occurredAt).toBe(now - 10 * 24 * H);
  });

  it("splitContactName", () => {
    expect(splitContactName("  Jean   Marie Payet ")).toEqual({ firstName: "Jean", lastName: "Marie Payet" });
    expect(splitContactName("Lydie")).toEqual({ firstName: "Lydie" });
    expect(splitContactName(null)).toEqual({});
  });
});
