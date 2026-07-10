import { describe, test, expect } from "vitest";
import {
  buildGhlProspectRemark,
  parseSetterRemarkSections,
  formatRdvForCommercial,
} from "./prospectRemark";

// mercredi 15 juillet 2026 09:00 à La Réunion (UTC+4) = 05:00 UTC
const SLOT = Date.UTC(2026, 6, 15, 5, 0, 0);

describe("formatRdvForCommercial", () => {
  test("formate en français, fuseau Réunion", () => {
    const s = formatRdvForCommercial(SLOT);
    expect(s).toMatch(/mercredi 15\/07\/2026 à 09:00/);
  });
});

describe("parseSetterRemarkSections", () => {
  test("extrait commentaire + éligibilité + extra", () => {
    const raw = [
      "RDV ECOI — Secteur Sud — sera retiré",
      "Toiture récente",
      "Commentaire setter : Client très motivé,\nveut réduire sa facture.",
      "Éligibilité :\n- Propriétaire\n- Facture > 150 €",
    ].join("\n");
    const s = parseSetterRemarkSections(raw);
    expect(s.comment).toContain("Client très motivé");
    expect(s.eligibility).toEqual(["Propriétaire", "Facture > 150 €"]);
    expect(s.extra).toEqual(["Toiture récente"]);
  });

  test("texte vide → sections vides", () => {
    expect(parseSetterRemarkSections("")).toEqual({ comment: null, eligibility: [], extra: [] });
  });
});

describe("buildGhlProspectRemark", () => {
  test("note complète, blocs professionnels", () => {
    const note = buildGhlProspectRemark({
      sector: "Sud",
      firstName: "Jean",
      lastName: "Payet",
      addressLine: "12 chemin des Cocotiers",
      city: "Saint-Pierre",
      postalCode: "97410",
      typeLogement: "Maison individuelle",
      revenuFiscal: 32000,
      scheduledAt: SLOT,
      notes: "Commentaire setter : Très motivé.\nÉligibilité :\n- Propriétaire",
    });
    expect(note).toContain("RDV ECOI — Secteur Sud — Jean Payet");
    expect(note).toContain("Créneau : mercredi 15/07/2026 à 09:00");
    expect(note).toContain("Adresse : 12 chemin des Cocotiers");
    expect(note).toContain("Ville / CP : 97410 Saint-Pierre");
    expect(note).toContain("Logement : Maison individuelle");
    expect(note).toMatch(/Revenu fiscal : 32\s?000 €/);
    expect(note).toContain("COMMENTAIRE SETTER\nTrès motivé.");
    expect(note).toContain("ÉLIGIBILITÉ\n• Propriétaire");
  });

  test("sans note setter ni identité → en-tête + infos seulement", () => {
    const note = buildGhlProspectRemark({ sector: "Nord", scheduledAt: SLOT });
    expect(note.startsWith("RDV ECOI — Secteur Nord")).toBe(true);
    expect(note).not.toContain("COMMENTAIRE SETTER");
  });
});
