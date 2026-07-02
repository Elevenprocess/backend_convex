import { describe, test, expect } from "vitest";
import { SUBSTEP_CATALOG, substepsForPhase, catalogByKey, SLA_DAYS } from "./substepCatalog";

describe("substepCatalog", () => {
  test("catalogue = 12 sous-étapes", () => {
    expect(SUBSTEP_CATALOG).toHaveLength(12);
  });

  test("VT = 3 sous-étapes ordonnées", () => {
    expect(substepsForPhase("vt").map((d) => d.key)).toEqual([
      "vt_planifie",
      "vt_attribuee",
      "vt_validee",
    ]);
  });

  test("racco_validee depositOnly + doc crae", () => {
    const d = catalogByKey("racco_validee");
    expect(d?.depositOnly).toBe(true);
    expect(d?.expectedDocs).toContain("crae");
  });

  test("dp_envoyee_mairie slaTargetKey = dp_validee", () => {
    expect(catalogByKey("dp_envoyee_mairie")?.slaTargetKey).toBe("dp_validee");
  });

  test("SLA_DAYS = 28", () => {
    expect(SLA_DAYS).toBe(28);
  });

  test("chaque phase a ses sous-étapes", () => {
    for (const p of ["vt", "dp", "racco", "installation", "consuel", "mes"] as const) {
      expect(substepsForPhase(p).length).toBeGreaterThan(0);
    }
  });

  test("racco_envoye slaTargetKey = racco_validee", () => {
    expect(catalogByKey("racco_envoye")?.slaTargetKey).toBe("racco_validee");
  });

  test("consuel_a_faire slaTargetKey = consuel_valide", () => {
    expect(catalogByKey("consuel_a_faire")?.slaTargetKey).toBe("consuel_valide");
  });

  test("vt_validee expectedDocs = rapport_vt", () => {
    expect(catalogByKey("vt_validee")?.expectedDocs).toContain("rapport_vt");
  });

  test("dp_validee expectedDocs = cno_dp", () => {
    expect(catalogByKey("dp_validee")?.expectedDocs).toContain("cno_dp");
  });

  test("consuel_valide expectedDocs = attestation_consuel", () => {
    expect(catalogByKey("consuel_valide")?.expectedDocs).toContain("attestation_consuel");
  });

  test("positions dans chaque phase sont consécutives depuis 1", () => {
    for (const p of ["vt", "dp", "racco", "installation", "consuel", "mes"] as const) {
      const subs = substepsForPhase(p);
      subs.forEach((s, i) => expect(s.position).toBe(i + 1));
    }
  });
});
