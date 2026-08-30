import { describe, expect, it } from "vitest";
import { excludeMirroredNotes, parseGhlNotes } from "./contactNotes";

describe("parseGhlNotes", () => {
  it("lit la forme GHL standard { notes: [...] } et trie du plus récent au plus ancien", () => {
    const out = parseGhlNotes({
      notes: [
        { id: "a", body: "Client absent, rappeler", userId: "u1", dateAdded: "2026-08-20T10:00:00.000Z", contactId: "c" },
        { id: "b", body: "RDV fixé le 25", userId: "u2", dateAdded: "2026-08-22T08:00:00.000Z", contactId: "c" },
      ],
      traceId: "x",
    });
    expect(out.map((n) => n.id)).toEqual(["b", "a"]);
    expect(out[1]).toMatchObject({ body: "Client absent, rappeler", ghlUserId: "u1", dateAdded: Date.parse("2026-08-20T10:00:00.000Z") });
  });

  it("ignore les entrées vides/dupliquées et accepte un tableau nu", () => {
    const out = parseGhlNotes([
      { id: "a", body: "  " },
      { id: "a", body: "ok", dateAdded: 1700000000000 },
      { id: "a", body: "dup", dateAdded: 1700000001000 },
      { body: "sans id" },
      null,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a", body: "ok", dateAdded: 1700000000000 });
  });

  it("date manquante → now ; secondes epoch → ms", () => {
    const out = parseGhlNotes({ notes: [{ id: "a", note: "x" }, { id: "b", body: "y", dateAdded: 1700000000 }] }, 123);
    expect(out.find((n) => n.id === "a")?.dateAdded).toBe(123);
    expect(out.find((n) => n.id === "b")?.dateAdded).toBe(1700000000000);
  });

  it("excludeMirroredNotes retire les notes poussées par Velora (id miroir débrief, en-tête RDV setter / débrief)", () => {
    const notes = parseGhlNotes({
      notes: [
        { id: "mir", body: "débrief" },
        { id: "rdv", body: "RDV ECOI — Secteur Est — Jean\n\nCréneau : …\n\nCOMMENTAIRE SETTER\n…" },
        { id: "deb", body: "DÉBRIEF RDV — Velora (mis à jour)\nRÉSULTAT : …" },
        { id: "ghl", body: "Client rappelé, veut un devis batterie" },
      ],
    });
    expect(excludeMirroredNotes(notes, ["mir"]).map((n) => n.id)).toEqual(["ghl"]);
  });
});
