import { describe, expect, it } from "vitest";
import { buildDebriefNote } from "./debriefNote";

const filledAt = Date.parse("2026-08-27T10:32:00Z"); // 14:32 à La Réunion

describe("buildDebriefNote", () => {
  it("vente : en-tête, résultat avec montant + financement, facteurs, remarques", () => {
    const note = buildDebriefNote({
      outcome: "vente", montantTotal: 12000, financingType: "financement", financingOrg: "cmoi",
      acceptanceFactors: ["prix_convenable", "garanties"], kits: "6 kWc + batterie",
      notes: "Client très motivé.\n\n\nInstallation souhaitée en octobre.",
      commercialName: "Laurent C.", filledAt, rdvAt: Date.parse("2026-08-25T06:00:00Z"),
      signedAt: filledAt,
    });
    expect(note).toContain("DÉBRIEF RDV — Velora");
    expect(note).toContain("Commercial : Laurent C.");
    expect(note).toContain("Saisi le : jeudi 27/08/2026 à 14:32");
    expect(note).toContain("RDV du : mardi 25/08/2026 à 10:00");
    expect(note).toMatch(/RÉSULTAT : VENTE — 12[\u202f\u00a0 ]000 €, Financement · CMOI/);
    expect(note).toContain("Facteurs d'acceptation : Prix convenable, Garanties rassurantes");
    expect(note).toContain("Kits : 6 kWc + batterie");
    expect(note).toContain("Signé le : jeudi 27/08/2026 à 14:32");
    expect(note).toContain("REMARQUES DU COMMERCIAL\nClient très motivé.\n\nInstallation souhaitée en octobre.");
    expect(note).not.toContain("(mis à jour)");
  });

  it("non-vente : motif libellé FR, objection, pas de bloc remarques vide", () => {
    const note = buildDebriefNote({
      outcome: "non_vente", nonSaleReason: "pas_interesse", objection: "Trop cher", filledAt, updated: true,
    });
    expect(note).toContain("DÉBRIEF RDV — Velora (mis à jour)");
    expect(note).toContain("RÉSULTAT : NON-VENTE");
    expect(note).toContain("Motif : Pas intéressé");
    expect(note).toContain("Objection : Trop cher");
    expect(note).not.toContain("REMARQUES");
    expect(note).not.toContain("Commercial :");
  });

  it("réflexion / suivi : motif issu de la bonne liste ; valeur inconnue rendue brute", () => {
    expect(buildDebriefNote({ outcome: "en_reflexion", reflexionReason: "budget_a_revoir", filledAt }))
      .toContain("RÉSULTAT : EN RÉFLEXION\nMotif : Budget à revoir");
    expect(buildDebriefNote({ outcome: "suivi_prevu", suiviReason: "rappel_programme", filledAt }))
      .toContain("RÉSULTAT : SUIVI PRÉVU\nMotif : Rappel programmé");
    expect(buildDebriefNote({ outcome: "suivi_prevu", suiviReason: "nouveau_motif", filledAt }))
      .toContain("Motif : nouveau_motif");
  });

  it("tronque à 5000 caractères", () => {
    const note = buildDebriefNote({ outcome: "vente", notes: "x".repeat(9000), filledAt });
    expect(note.length).toBeLessThanOrEqual(5000);
  });
});
