// Population « page client » (scope=clients) — port fidèle du legacy NestJS
// (ghl-stage-mapper.ts) : chemin positif RDV planifié → devis. Exclut
// volontairement No-Show, RDV Annulé, RDV Pas Qualifié et Relance Long Terme.
import { Doc } from "../_generated/dataModel";

// Stages GHL « chemin positif » à partir du RDV planifié.
const CLIENT_VISIBLE_STAGES = [
  "5. RDV Planifié 📅",
  "8. RDV Reprogrammé 🔁",
  "10. Devis En Attente 📝",
  "10.5 Devis En Cours De Signature ✍️",
  "11. Devis Signé ✍️",
  "12. Devis Perdu 💔",
] as const;

// Statuts internes correspondant aux stages ci-dessus (superset du pré-filtre :
// No-Show partage 'perdu', d'où le post-filtre par stage exact).
export const CLIENT_VISIBLE_STATUSES = [
  "rdv_pris",
  "rdv_honore",
  "signature_en_cours",
  "signe",
  "perdu",
] as const;

// Trim + NFC + compression des espaces : tolère "  5. RDV  Planifié 📅 ".
function normalize(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim();
}

const CLIENT_VISIBLE_NORMALIZED: ReadonlySet<string> = new Set(CLIENT_VISIBLE_STAGES.map(normalize));

export function isClientVisibleStage(stageName?: string | null): boolean {
  return !!stageName && CLIENT_VISIBLE_NORMALIZED.has(normalize(stageName));
}

// Post-filtre autoritaire, appliqué après enrichissement (latestRdvAt/hasDevis) :
//   - stage exact si présent (gère No-Show qui partage le statut de stages visibles) ;
//   - sinon filet de secours : lead manuel au statut visible, ou lead sans stage
//     mais avec un RDV ou un devis (leads GHL dont le statut n'a pas suivi).
export function isClientVisibleLead(
  lead: Pick<Doc<"leads">, "ghlStageName" | "source" | "status">,
  enriched: { latestRdvAt?: string | number | null; hasDevis?: boolean },
): boolean {
  if (isClientVisibleStage(lead.ghlStageName)) return true;
  const noStage = !lead.ghlStageName?.trim();
  if (!noStage) return false;
  if (lead.source === "manual" && (CLIENT_VISIBLE_STATUSES as readonly string[]).includes(lead.status)) return true;
  return Boolean(enriched.latestRdvAt) || enriched.hasDevis === true;
}
