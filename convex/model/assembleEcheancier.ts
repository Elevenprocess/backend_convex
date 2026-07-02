// ─── assembleEcheancier — tranche 5 Finances ─────────────────────────────────
// Portage de `payments.service.queryAcomptes` (NestJS) pour UN débrief.
// Appelée depuis les queries getAcompte / listAcomptes (lecture seule).
// Ne jamais écrire dans cette fonction (ctx.db.insert/patch interdits).

import { QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import {
  resolveEcheancier,
  customTemplatesFromRows,
  tranchePrevue,
  EDF_CONFIRMATION_JALON,
} from "./acompteEcheancier";
import { isJalonReached, clientStatusGlobal } from "./delivrabiliteSeam";
import { AcompteStatut, EcheanceJalon } from "./enums";

// ─── Types de réponse (Convex : montants en number, pas string) ───────────────

export type EcheanceLine = {
  ordre: number;
  label: string;
  jalonKey: string | null;
  jalonAtteint: boolean;
  percent: number | null;
  montantPrevu: number | null;
  statut: AcompteStatut;
  montantReel: number | null;
  dateEcheance: string | null;
  dateEncaissement: string | null;
  notes: string | null;
  recordedById: string | null;
  updatedAt: null; // acompteEcheances n'a pas de updatedAt en Convex
};

export type AcompteResponse = {
  debriefId: Id<"debriefs">;
  leadId: Id<"leads"> | null;
  projectId: Id<"projects"> | null;
  projectName: string | null;
  clientName: string | null;
  commercialName: string | null;
  montantTotal: number | null;
  financingType: string | null;
  paymentSubMethod: string | null;
  financingOrg: string | null;
  acomptePercent: number | null;
  acompteAmount: number | null;
  customEcheancier: boolean;
  signedAt: number | null; // Unix ms (Convex) vs ISO string (NestJS)
  edfRecepisse: boolean;
  echeances: EcheanceLine[];
  totalEncaisse: number | null;
  resteAPayer: number | null;
};

// ─── Fonction principale ──────────────────────────────────────────────────────

/**
 * Assemble l'échéancier complet (lignes + statuts dérivés + totaux) pour UN
 * débrief vente. Retourne null si aucun template applicable (ex : 10x/12x sans
 * acompte — suivi externe).
 *
 * @param ctx   QueryCtx Convex (lecture seule, ne pas écrire ici)
 * @param debrief Document debriefs déjà chargé par l'appelant
 * @param opts.today Date du jour YYYY-MM-DD (comparaison lexicographique pour retard)
 */
export async function assembleEcheancier(
  ctx: QueryCtx,
  debrief: Doc<"debriefs">,
  opts: { today: string },
): Promise<AcompteResponse | null> {
  const { today } = opts;

  // ── 1. Lead → flag imported + clientName ────────────────────────────────────
  const lead = debrief.leadId ? await ctx.db.get(debrief.leadId) : null;
  const imported = lead?.source === "airtable_migration";
  const clientName =
    lead
      ? [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || null
      : null;

  // ── 2. Commercial → name ─────────────────────────────────────────────────────
  const commercial = await ctx.db.get(debrief.commercialId);
  const commercialName = commercial?.name ?? null;

  // ── 3. Project → name ────────────────────────────────────────────────────────
  const project = debrief.projectId ? await ctx.db.get(debrief.projectId) : null;
  const projectName = project?.name ?? null;

  // ── 4. Annulation dossier (seam) ─────────────────────────────────────────────
  const statusGlobal = await clientStatusGlobal(ctx, {
    projectId: debrief.projectId,
    leadId: debrief.leadId,
  });
  const cancelled = statusGlobal === "annule";

  // ── 5. Lignes persistées par ordre ───────────────────────────────────────────
  const persistedRows = await ctx.db
    .query("acompteEcheances")
    .withIndex("by_debrief_ordre", (q) => q.eq("debriefId", debrief._id))
    .collect();

  // ── 6. Choix du plan : custom ou template déduit du financingType ─────────────
  const hasUsableCustomPlan = persistedRows.some(
    (r) => r.montantPrevu != null || r.percent != null || r.jalonKey != null,
  );
  const useCustomEcheancier = debrief.customEcheancier && hasUsableCustomPlan;

  const templates = useCustomEcheancier
    ? customTemplatesFromRows(
        persistedRows.map((r) => ({
          ordre: r.ordre,
          label: r.label ?? null,
          percent: r.percent ?? null,
          montantPrevu: r.montantPrevu ?? null,
          jalonKey: r.jalonKey ?? null,
        })),
      )
    : resolveEcheancier({
        financingType: debrief.financingType ?? null,
        montantTotal: debrief.montantTotal ?? null,
        acompteAmount: debrief.acompteAmount ?? null,
        acomptePercent: debrief.acomptePercent ?? null,
        imported,
      });

  // 10x/12x sans acompte, ou aucun montant → rien à afficher.
  if (templates.length === 0) return null;

  // ── 7. Lookup map ordre → ligne persistée ────────────────────────────────────
  const encByOrdre = new Map<number, (typeof persistedRows)[number]>();
  for (const r of persistedRows) {
    encByOrdre.set(r.ordre, r);
  }
  const templateOrdres = new Set(templates.map((t) => t.ordre));

  // ── 8. Builder d'une ligne d'échéancier ─────────────────────────────────────
  const buildLine = async (
    ordre: number,
    label: string,
    jalonKey: string | null,
    percent: number | null,
    montantPrevu: number | null,
    enc: (typeof persistedRows)[number] | undefined,
    readonly?: boolean,
  ): Promise<EcheanceLine> => {
    // Jalon franchi ? 'signature' = toujours vrai (vente signée).
    const jalonAtteint =
      jalonKey === "signature"
        ? true
        : jalonKey != null
          ? await isJalonReached(ctx, {
              projectId: debrief.projectId,
              leadId: debrief.leadId,
              jalonKey: jalonKey as EcheanceJalon,
            })
          : false;

    // Priorité statut (comme queryAcomptes) :
    //   1. dossier annulé → annule
    //   2. ligne persistée → son statut
    //   3. orphelin read-only → en_attente
    //   4. jalon atteint → a_encaisser
    //   5. sinon → en_attente
    let base: AcompteStatut;
    if (cancelled) {
      base = "annule";
    } else if (enc) {
      base = enc.statut as AcompteStatut;
    } else if (readonly) {
      base = "en_attente";
    } else if (jalonAtteint) {
      base = "a_encaisser";
    } else {
      base = "en_attente";
    }

    // Retard : ligne due mais non encaissée, dateEcheance dépassée.
    // Comparaison lexicographique YYYY-MM-DD (chronologique).
    const dateEcheance = enc?.dateEcheance ?? null;
    const statut: AcompteStatut =
      (base === "a_encaisser" || base === "en_attente") &&
      dateEcheance != null &&
      dateEcheance < today
        ? "en_retard"
        : base;

    return {
      ordre,
      label,
      jalonKey,
      jalonAtteint,
      percent,
      montantPrevu,
      statut,
      montantReel: enc?.montantReel ?? null,
      dateEcheance,
      dateEncaissement: enc?.dateEncaissement ?? null,
      notes: enc?.notes ?? null,
      recordedById: enc?.recordedById ?? null,
      updatedAt: null,
    };
  };

  // ── 9. Construire les lignes template ────────────────────────────────────────
  let plannedBefore = 0;
  const echeances: EcheanceLine[] = [];
  for (let idx = 0; idx < templates.length; idx++) {
    const tpl = templates[idx];
    const enc = encByOrdre.get(tpl.ordre);

    let montantPrevu: number | null = null;
    if (tpl.montantOverride !== undefined && tpl.montantOverride !== null) {
      montantPrevu = tpl.montantOverride;
    } else if (tpl.percent != null) {
      if (idx === templates.length - 1 && debrief.montantTotal != null) {
        // Dernière tranche : solde exact pour éviter les écarts d'arrondi 40/20/20/20.
        montantPrevu = Math.max(0, debrief.montantTotal - plannedBefore);
      } else {
        montantPrevu = tranchePrevue(debrief.montantTotal ?? null, tpl.percent);
      }
    }
    plannedBefore += montantPrevu ?? 0;

    echeances.push(
      await buildLine(
        tpl.ordre,
        tpl.label,
        tpl.jalonKey,
        tpl.percent ?? null,
        montantPrevu,
        enc,
      ),
    );
  }

  // ── 10. Orphan guard ─────────────────────────────────────────────────────────
  // Lignes persistées dont l'ordre n'est plus dans le template : on les affiche
  // en lecture seule pour ne jamais cacher un encaissement réel.
  if (!useCustomEcheancier) {
    for (const orphanEnc of persistedRows) {
      if (templateOrdres.has(orphanEnc.ordre)) continue;
      const label = orphanEnc.label ?? "Encaissement (ancien échéancier)";
      echeances.push(
        await buildLine(
          orphanEnc.ordre,
          label,
          orphanEnc.jalonKey ?? null,
          orphanEnc.percent ?? null,
          orphanEnc.montantPrevu ?? null,
          orphanEnc,
          true, // read-only orphelin
        ),
      );
    }
    // Tri : tranches template d'abord (déjà dans l'ordre du template),
    // puis orphelins par ordre croissant.
    echeances.sort((a, b) => {
      const aTemplate = templateOrdres.has(a.ordre);
      const bTemplate = templateOrdres.has(b.ordre);
      if (aTemplate && !bTemplate) return -1;
      if (!aTemplate && bTemplate) return 1;
      return a.ordre - b.ordre;
    });
  }

  // ── 11. Totaux ───────────────────────────────────────────────────────────────
  let totalEncaisseNum = 0;
  let hasEncaisse = false;
  for (const e of echeances) {
    if (e.statut === "encaisse" && e.montantReel != null) {
      totalEncaisseNum += e.montantReel;
      hasEncaisse = true;
    }
  }
  const totalEncaisse = hasEncaisse ? totalEncaisseNum : null;

  let resteAPayer: number | null;
  if (debrief.montantTotal != null) {
    resteAPayer = debrief.montantTotal - totalEncaisseNum;
  } else {
    let sum = 0;
    for (const e of echeances) {
      if (e.statut !== "encaisse" && e.statut !== "annule" && e.montantPrevu != null) {
        sum += e.montantPrevu;
      }
    }
    resteAPayer = sum > 0 ? sum : null;
  }

  // ── 12. Récépissé EDF (racco_validee = confirmation financement récupérable) ──
  const edfRecepisse = await isJalonReached(ctx, {
    projectId: debrief.projectId,
    leadId: debrief.leadId,
    jalonKey: EDF_CONFIRMATION_JALON,
  });

  return {
    debriefId: debrief._id,
    leadId: debrief.leadId ?? null,
    projectId: debrief.projectId ?? null,
    projectName,
    clientName,
    commercialName,
    montantTotal: debrief.montantTotal ?? null,
    financingType: debrief.financingType ?? null,
    paymentSubMethod: debrief.paymentSubMethod ?? null,
    financingOrg: debrief.financingOrg ?? null,
    acomptePercent: debrief.acomptePercent ?? null,
    acompteAmount: debrief.acompteAmount ?? null,
    customEcheancier: debrief.customEcheancier,
    signedAt: debrief.signedAt ?? null,
    edfRecepisse,
    echeances,
    totalEncaisse,
    resteAPayer,
  };
}
