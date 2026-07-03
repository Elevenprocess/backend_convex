// Pure, DB-free funnel & admin-stats arithmetic for the analytics module.
//
// SOURCE OF TRUTH: lead.status. The sales funnel is computed as NESTED cumulative
// sets, so it is MONOTONICALLY DECREASING by construction:
//   newLeads ≥ calls ≥ answered ≥ qualified ≥ rdv ≥ signed
//
// This file is the single owner of the status/result sets so the whole analytics
// pipeline shares one coherent definition. Historic bug: RDV_STATUSES was defined
// identical to QUALIFIED_STATUSES, which made "RDV pris" ≥ "Qualifiés" and inverted
// the funnel everywhere. They are now distinct — RDV_REACHED_STATUSES excludes the
// bare "qualifie" stage.

// ─── Lead status sets ─────────────────────────────────────────
export const QUALIFIED_STATUSES = new Set(['qualifie', 'rdv_pris', 'rdv_honore', 'signe']);
export const RDV_REACHED_STATUSES = new Set(['rdv_pris', 'rdv_honore', 'signe']); // "qualifie" EXCLU
export const SIGNED_STATUSES = new Set(['signe']);
export const NOT_QUALIFIED_STATUSES = new Set(['pas_qualifie', 'perdu']);
export const RELANCE_STATUSES = new Set(['relance', 'a_rappeler', 'pas_de_reponse']);
export const CALLBACK_STATUSES = new Set(['relance', 'a_rappeler']);
export const NO_ANSWER_STATUSES = new Set(['pas_de_reponse']);
export const CLASSIFIED_STATUSES = new Set(['qualifie', 'rdv_pris', 'rdv_honore', 'signe', 'perdu', 'relance', 'pas_qualifie', 'a_rappeler', 'pas_de_reponse']);

// ─── Call result sets ─────────────────────────────────────────
export const ANSWERED_RESULTS = new Set<string>(['joint', 'rdv_pris', 'refus']);
export const RELANCE_RESULTS = new Set<string>(['non_joint', 'rappel_planifie', 'injoignable', 'messagerie']);
export const CALLBACK_RESULTS = new Set<string>(['rappel_planifie']);
export const NO_ANSWER_RESULTS = new Set<string>(['non_joint', 'injoignable', 'messagerie']);

export interface FunnelLeadInput {
  id: string;
  status: string;
}
export interface FunnelCallInput {
  leadId: string | null;
  result: string;
}

export interface FunnelTotals {
  newLeads: number;
  calls: number;
  answered: number;
  responseRate: number;
  qualified: number;
  qualificationRate: number;
  notQualified: number;
  notQualifiedRate: number;
  noAnswer: number;
  relances: number;
  rdv: number;
  signed: number;
  globalConversionRate: number;
  lossesBeforeCall: number;
  lossesAfterNoAnswer: number;
  lossesAfterNotQualified: number;
}

export function pct(num: number, denom: number): number {
  if (denom <= 0) return 0;
  return Math.min(100, Math.round((num / denom) * 100));
}

/**
 * Compute the funnel totals from scoped rows. Every stage is intersected with the
 * scoped-lead id set and the sets are nested before counting, so the returned
 * funnel is guaranteed monotonically decreasing regardless of source inconsistencies
 * between call_logs, lead.status and rdv rows.
 */
export function computeFunnelTotals(args: {
  scopedLeads: FunnelLeadInput[];
  classifiedLeads: FunnelLeadInput[];
  scopedCalls: FunnelCallInput[];
  rdvLeadIds: Iterable<string>;
}): FunnelTotals {
  const { scopedLeads, classifiedLeads, scopedCalls } = args;
  const validIds = new Set(scopedLeads.map((l) => l.id));
  const rdvLeadIds = new Set([...args.rdvLeadIds].filter((id) => validIds.has(id)));

  const answeredIds = new Set<string>();
  const noAnswerIds = new Set<string>();
  const qualifiedIds = new Set<string>();
  const notQualifiedIds = new Set<string>();
  const rdvIds = new Set<string>();
  const signedIds = new Set<string>();

  const add = (set: Set<string>, id: string | null | undefined) => {
    if (id && validIds.has(id)) set.add(id);
  };

  // Call signals
  for (const call of scopedCalls) {
    if (ANSWERED_RESULTS.has(call.result) || CALLBACK_RESULTS.has(call.result)) add(answeredIds, call.leadId);
    if (NO_ANSWER_RESULTS.has(call.result)) add(noAnswerIds, call.leadId);
    if (call.result === 'refus') add(notQualifiedIds, call.leadId);
    // 'rdv_pris' (result d'appel) est étiqueté « Qualifié » dans l'UI et ne crée pas de
    // RDV réel → on ne le compte pas en rdv. Vrai RDV = statut rdv_pris/honoré/signé ou
    // une ligne rdv réelle (rdvLeadIds plus bas).
  }

  // Lead-status signals (the source of truth)
  for (const lead of classifiedLeads) {
    if (QUALIFIED_STATUSES.has(lead.status)) add(qualifiedIds, lead.id);
    if (RDV_REACHED_STATUSES.has(lead.status)) add(rdvIds, lead.id);
    if (SIGNED_STATUSES.has(lead.status)) add(signedIds, lead.id);
    if (NOT_QUALIFIED_STATUSES.has(lead.status)) { add(answeredIds, lead.id); add(notQualifiedIds, lead.id); }
    if (CALLBACK_STATUSES.has(lead.status)) add(answeredIds, lead.id);
    if (NO_ANSWER_STATUSES.has(lead.status)) add(noAnswerIds, lead.id);
  }

  // Actual RDV rows: a booked appointment reaches the rdv stage.
  for (const id of rdvLeadIds) rdvIds.add(id);

  // Enforce nesting: signed ⊆ rdv ⊆ qualified ⊆ answered. Each downstream stage is
  // folded into its parent so a later stage can never exceed an earlier one.
  for (const id of signedIds) rdvIds.add(id);
  for (const id of rdvIds) qualifiedIds.add(id);
  for (const id of qualifiedIds) answeredIds.add(id);

  // A lead that ever answered is not counted as "no answer".
  for (const id of answeredIds) noAnswerIds.delete(id);

  const newLeads = scopedLeads.length;
  const answered = answeredIds.size;
  const qualified = qualifiedIds.size;
  const rdv = rdvIds.size;
  const signed = signedIds.size;
  const notQualified = notQualifiedIds.size;
  const noAnswer = noAnswerIds.size;
  const contacted = answered + noAnswer;
  const relances = scopedCalls.filter((call) => RELANCE_RESULTS.has(call.result)).length;

  // calls is operational (logged calls, or classified leads for import-heavy data),
  // clamped into [answered, newLeads] so it keeps its place in the funnel.
  const rawCalls = Math.max(scopedCalls.length, classifiedLeads.length);
  const calls = Math.min(newLeads, Math.max(rawCalls, answered));

  return {
    newLeads,
    calls,
    answered,
    responseRate: pct(answered, contacted),
    qualified,
    qualificationRate: pct(qualified, answered),
    notQualified,
    notQualifiedRate: pct(notQualified, answered),
    noAnswer,
    relances,
    rdv,
    signed,
    globalConversionRate: pct(rdv, newLeads),
    lossesBeforeCall: Math.max(0, newLeads - calls),
    lossesAfterNoAnswer: noAnswer,
    lossesAfterNotQualified: notQualified,
  };
}
