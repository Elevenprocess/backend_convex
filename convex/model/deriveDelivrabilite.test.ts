import { describe, test, expect } from "vitest";
import { deriveClientStatus, derivePhaseStatus, WORKFLOW_PHASE_ORDER } from "./deriveDelivrabilite";

const steps = (m: Record<string, string>) =>
  WORKFLOW_PHASE_ORDER.map((phase) => ({ phase, status: (m[phase] ?? "a_faire") as any }));

describe("deriveClientStatus", () => {
  test("dossier neuf → vt_a_faire / phase vt / non bloqué", () => {
    const d = deriveClientStatus(steps({}));
    expect(d).toEqual({ statusGlobal: "vt_a_faire", currentPhase: "vt", blocked: false });
  });

  test("vt fait → administratif_en_cours, phase dp", () => {
    expect(deriveClientStatus(steps({ vt: "fait" }))).toMatchObject({
      statusGlobal: "administratif_en_cours",
      currentPhase: "dp",
    });
  });

  test("un step annule → annule (terminal)", () => {
    expect(deriveClientStatus(steps({ vt: "fait", dp: "annule" })).statusGlobal).toBe("annule");
  });

  test("un step probleme → blocked + bloque", () => {
    const d = deriveClientStatus(steps({ vt: "probleme" }));
    expect(d.blocked).toBe(true);
    expect(d.statusGlobal).toBe("bloque");
  });

  test("installation fait → installe_en_attente_mes", () => {
    expect(
      deriveClientStatus(
        steps({ vt: "fait", dp: "fait", racco: "fait", installation: "fait" }),
      ).statusGlobal,
    ).toBe("installe_en_attente_mes");
  });

  test("installation planifie → installation_planifiee", () => {
    expect(
      deriveClientStatus(steps({ vt: "fait", installation: "planifie" })).statusGlobal,
    ).toBe("installation_planifiee");
  });

  test("toutes phases fait → cloture, currentPhase mes", () => {
    const all = Object.fromEntries(WORKFLOW_PHASE_ORDER.map((p) => [p, "fait"]));
    expect(deriveClientStatus(steps(all))).toMatchObject({
      statusGlobal: "cloture",
      currentPhase: "mes",
    });
  });
});

describe("derivePhaseStatus", () => {
  test("priorités : annule > probleme > fait > en_cours > a_faire", () => {
    expect(
      derivePhaseStatus([
        { status: "fait", optional: false },
        { status: "annule", optional: false },
      ]),
    ).toBe("annule");

    expect(
      derivePhaseStatus([
        { status: "fait", optional: false },
        { status: "probleme", optional: false },
      ]),
    ).toBe("probleme");

    expect(
      derivePhaseStatus([
        { status: "fait", optional: false },
        { status: "fait", optional: false },
      ]),
    ).toBe("fait");

    expect(
      derivePhaseStatus([
        { status: "fait", optional: false },
        { status: "a_faire", optional: false },
      ]),
    ).toBe("en_cours");

    expect(derivePhaseStatus([{ status: "a_faire", optional: false }])).toBe("a_faire");

    expect(derivePhaseStatus([])).toBe("a_faire");
  });

  test("ignore optionnels a_faire pour tout-fait", () => {
    expect(
      derivePhaseStatus([
        { status: "fait", optional: false },
        { status: "a_faire", optional: true },
      ]),
    ).toBe("fait");
  });
});
