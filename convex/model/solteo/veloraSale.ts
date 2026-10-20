/**
 * ELE-179 étape Velora — décision pure : devis signé Soltéo → RDV Velora.
 * Soltéo fait foi pour la vente, mais on ne remplace JAMAIS une valeur
 * finale différente déjà présente : on la signale (écart).
 */
export type RdvLike = {
  status: string;
  result?: string;
  montantTotal?: number;
  signatureAt?: number;
  scheduledAt?: number;
};

export type VeloraSaleDecision = {
  patch: Record<string, unknown>;
  discrepancies: Array<{ kind: string; details: string }>;
};

const FINAL_OTHER_RESULTS = new Set(["perdu", "no_show", "reporte"]);

export function decideVeloraSale(rdv: RdvLike, sale: { ttc: number; signedAtMs?: number }): VeloraSaleDecision {
  const patch: Record<string, unknown> = {};
  const discrepancies: Array<{ kind: string; details: string }> = [];
  if (rdv.result === undefined || rdv.result === "reflexion") patch.result = "signe";
  else if (FINAL_OTHER_RESULTS.has(rdv.result)) {
    discrepancies.push({ kind: "rdv_result_diff", details: `Velora result=${rdv.result} vs Soltéo signé` });
  }
  if (rdv.montantTotal === undefined || rdv.montantTotal === 0) patch.montantTotal = sale.ttc;
  else if (Math.abs(rdv.montantTotal - sale.ttc) > 1) {
    discrepancies.push({ kind: "montant_velora_diff", details: `Velora ${rdv.montantTotal} vs TTC Soltéo ${sale.ttc}` });
  }
  if (rdv.signatureAt === undefined && sale.signedAtMs !== undefined) patch.signatureAt = sale.signedAtMs;
  if (rdv.status === "planifie") patch.status = "honore";
  else if (rdv.status === "no_show" || rdv.status === "annule") {
    discrepancies.push({ kind: "rdv_status_vs_vente", details: `RDV ${rdv.status} mais devis signé Soltéo` });
  }
  // Si le result est en conflit, on n'écrit rien sur ce RDV.
  if (discrepancies.some((d) => d.kind === "rdv_result_diff")) return { patch: {}, discrepancies };
  return { patch, discrepancies };
}

/** RDV cible : déjà signé, sinon le dernier tenu avant la signature, sinon le plus récent. */
export function pickSaleRdv<T extends RdvLike>(rdvs: T[], signedAtMs?: number): T | null {
  if (rdvs.length === 0) return null;
  const signed = rdvs.find((r) => r.result === "signe");
  if (signed) return signed;
  const sorted = [...rdvs].sort((a, b) => (b.scheduledAt ?? 0) - (a.scheduledAt ?? 0));
  if (signedAtMs !== undefined) {
    const before = sorted.find((r) => (r.scheduledAt ?? 0) <= signedAtMs);
    if (before) return before;
  }
  return sorted[0] ?? null;
}

/** Soltéo renvoie « 2026-10-19T08:21:01 » sans fuseau : heure de La Réunion (UTC+4). */
export function parseSolteoDate(s?: string | null): number | undefined {
  if (!s) return undefined;
  const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(s);
  const t = Date.parse(hasTz ? s : `${s}+04:00`);
  return Number.isFinite(t) ? t : undefined;
}
