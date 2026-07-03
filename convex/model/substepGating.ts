/**
 * Gating des sous-étapes délivrabilité.
 * Portage verbatim de substep-gating.ts (NestJS).
 */

import { catalogByKey, SLA_DAYS } from "./substepCatalog";
import type { DocumentType, WorkflowSubstepKey } from "./enums";

/**
 * Gating SOUPLE : une sous-étape est « déverrouillée » si tous ses prerequisites
 * sont `fait`. Sert à l'affichage (grisé / « en attente de … »), pas à bloquer.
 */
export function isSubstepUnlocked(
  key: WorkflowSubstepKey,
  allSubsteps: Array<{ key: WorkflowSubstepKey; status: string }>,
): boolean {
  const def = catalogByKey(key);
  if (!def || def.prerequisites.length === 0) return true;
  const statusByKey = new Map(allSubsteps.map((s) => [s.key, s.status]));
  return def.prerequisites.every((pre) => statusByKey.get(pre) === "fait");
}

/** Jauge « ~4 semaines » : date_realisee + 28j (ou null). Format YYYY-MM-DD. */
export function computeSlaDeadline(dateRealisee: string | null | undefined): string | null {
  if (!dateRealisee) return null;
  const d = new Date(`${dateRealisee}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + SLA_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * Badge « pièce manquante » (non bloquant) : true si la sous-étape attend au moins
 * un document dont aucun exemplaire (non supprimé) n'est rattaché.
 */
export function missingDocuments(
  key: WorkflowSubstepKey,
  attachedTypes: DocumentType[],
): boolean {
  const def = catalogByKey(key);
  if (!def || def.expectedDocs.length === 0) return false;
  const present = new Set(attachedTypes);
  return def.expectedDocs.some((t) => !present.has(t));
}

/**
 * Compte, pour un dossier, le nombre de sous-étapes dont au moins une pièce
 * attendue manque. Helper PUR (pas de DB), réutilisé par l'agrégat de liste
 * des clients (6d).
 */
export function countMissingDocs(
  substeps: { id: string; key: string }[],
  docTypesBySubstep: Map<string, DocumentType[]>,
): number {
  let count = 0;
  for (const s of substeps) {
    const attached = docTypesBySubstep.get(s.id) ?? [];
    if (missingDocuments(s.key as WorkflowSubstepKey, attached)) count += 1;
  }
  return count;
}
