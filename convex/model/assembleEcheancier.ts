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
  WorkTemplate,
} from "./acompteEcheancier";
import { templatesFromDevisEcheancier } from "./devisEcheancier";
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

// Provenance du plan de tranches :
//   custom   → échéancier personnalisé saisi back-office (setEcheancier)
//   devis    → échéancier du devis signé (conditions de règlement OCR)
//   standard → template en dur dérivé du financingType (fallback historique)
export type EcheancierSource = "custom" | "devis" | "standard";

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
  echeancierSource: EcheancierSource;
  // Numéro du devis signé qui fournit le plan (source === "devis"), sinon null.
  devisNumber: string | null;
  signedAt: number | null; // Unix ms (Convex) vs ISO string (NestJS)
  edfRecepisse: boolean;
  echeances: EcheanceLine[];
  totalEncaisse: number | null;
  resteAPayer: number | null;
};

// ─── Helper partagé lecture/écriture ─────────────────────────────────────────

/**
 * Un devis signé ne pilote l'échéancier que pour les ventes payées par le
 * client au fil des jalons : comptant ou mode non renseigné. Les financements
 * (solde organisme à l'install) et 10x/12x (suivi externe) gardent leur
 * logique propre — l'échéancier du devis y décrit ce que paie l'organisme ou
 * les mensualités client, pas les encaissements à suivre côté finances.
 */
export function devisEcheancierEligible(debrief: Doc<"debriefs">): boolean {
  return debrief.financingType === "comptant" || debrief.financingType == null;
}

/**
 * Sélectionne les templates de tranches à partir des données déjà chargées.
 * Source unique utilisée par la LECTURE (assembleEcheancier) ET l'ÉCRITURE
 * (recordEcheance), garantissant que l'ensemble des ordres valides est identique.
 *
 * Priorité : échéancier personnalisé (back-office) > échéancier du devis signé
 * (conditions de règlement) > template standard dérivé du financingType.
 *
 * @param debrief       Document debriefs
 * @param imported      true si source === "airtable_migration"
 * @param persistedRows lignes acompteEcheances existantes pour ce débrief
 * @param devisTemplates tranches issues du devis signé (templatesFromDevisEcheancier),
 *                       [] si pas de devis signé exploitable
 */
export function resolveTemplatesFromData(
  debrief: Doc<"debriefs">,
  imported: boolean,
  persistedRows: Array<{
    ordre: number;
    label?: string;
    percent?: number;
    montantPrevu?: number;
    jalonKey?: string;
  }>,
  devisTemplates: WorkTemplate[] = [],
): { templates: WorkTemplate[]; source: EcheancierSource } {
  const hasUsableCustomPlan = persistedRows.some(
    (r) => r.montantPrevu != null || r.percent != null || r.jalonKey != null,
  );
  const useCustomEcheancier = debrief.customEcheancier && hasUsableCustomPlan;

  if (useCustomEcheancier) {
    return {
      source: "custom",
      templates: customTemplatesFromRows(
        persistedRows.map((r) => ({
          ordre: r.ordre,
          label: r.label ?? null,
          percent: r.percent ?? null,
          montantPrevu: r.montantPrevu ?? null,
          jalonKey: r.jalonKey ?? null,
        })),
      ),
    };
  }

  if (devisTemplates.length > 0 && devisEcheancierEligible(debrief)) {
    return { source: "devis", templates: devisTemplates };
  }

  return {
    source: "standard",
    templates: resolveEcheancier({
      financingType: debrief.financingType ?? null,
      montantTotal: debrief.montantTotal ?? null,
      acompteAmount: debrief.acompteAmount ?? null,
      acomptePercent: debrief.acomptePercent ?? null,
      imported,
    }),
  };
}

/**
 * Devis signé qui fait foi pour l'échéancier d'un débrief : le plus spécifique
 * d'abord (même rdv), sinon même projet, sinon même lead. Parmi les candidats :
 * status "signe", non supprimé, échéancier extrait non vide ; le plus récemment
 * signé gagne.
 */
export async function findSignedDevisForDebrief(
  ctx: QueryCtx,
  debrief: Doc<"debriefs">,
): Promise<Doc<"devis"> | null> {
  const { rdvId, projectId, leadId } = debrief;
  const scopes: Array<() => Promise<Doc<"devis">[]>> = [];
  if (rdvId) {
    scopes.push(() =>
      ctx.db
        .query("devis")
        .withIndex("by_rdv", (q) => q.eq("rdvId", rdvId))
        .collect(),
    );
  }
  if (projectId) {
    scopes.push(() =>
      ctx.db
        .query("devis")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
  }
  if (leadId) {
    scopes.push(() =>
      ctx.db
        .query("devis")
        .withIndex("by_lead", (q) => q.eq("leadId", leadId))
        .collect(),
    );
  }

  for (const load of scopes) {
    const candidates = (await load()).filter(
      (d) =>
        d.deletedAt === undefined &&
        d.status === "signe" &&
        Array.isArray(d.echeancier) &&
        d.echeancier.length > 0,
    );
    if (candidates.length === 0) continue;
    candidates.sort(
      (a, b) =>
        (b.signedAt ?? b._creationTime) - (a.signedAt ?? a._creationTime),
    );
    return candidates[0];
  }
  return null;
}

/**
 * Résolution complète du plan de tranches pour un débrief : charge le devis
 * signé pertinent puis délègue à resolveTemplatesFromData. À utiliser partout
 * (lecture ET écriture) pour que l'ensemble des ordres valides soit identique.
 */
export async function resolveTemplatesForDebrief(
  ctx: QueryCtx,
  debrief: Doc<"debriefs">,
  imported: boolean,
  persistedRows: Array<{
    ordre: number;
    label?: string;
    percent?: number;
    montantPrevu?: number;
    jalonKey?: string;
  }>,
): Promise<{
  templates: WorkTemplate[];
  source: EcheancierSource;
  devis: Doc<"devis"> | null;
}> {
  // Inutile de charger le devis si son échéancier ne peut pas s'appliquer
  // (financement / 10x-12x) — resolveTemplatesFromData l'ignorerait de toute façon.
  const devis = devisEcheancierEligible(debrief)
    ? await findSignedDevisForDebrief(ctx, debrief)
    : null;
  const devisTemplates = devis
    ? templatesFromDevisEcheancier(devis.echeancier, debrief.montantTotal ?? null)
    : [];
  const { templates, source } = resolveTemplatesFromData(
    debrief,
    imported,
    persistedRows,
    devisTemplates,
  );
  return { templates, source, devis: source === "devis" ? devis : null };
}

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

  // ── 5b. Pont legacy acompteEncaissements ────────────────────────────────────
  // Compat legacy : l'ancienne page finances persistait l'acompte dans
  // `acompteEncaissements` (mono-acompte, une seule ligne par débrief).
  // La nouvelle page lit `acompteEcheances` (multi-tranches). Sans ce pont,
  // les anciens encaissements importés disparaissent de la page Finances.
  // Si aucune ligne moderne n'existe à l'ordre 1, on synthétise une entrée
  // compatible depuis le premier enregistrement legacy.
  // Cf. NestJS payments.service.ts queryAcomptes (~lignes 412-446) pour la
  // sémantique exacte : statut "attendu" → "a_encaisser", ordre figé à 1.
  //
  // NOTE: le pont `payments` (OCR historique, table `payments`) dépend de la
  // table `clients` (non encore portée en Convex) → hors-scope.
  // TODO(délivrabilité): câbler quand la table `clients` sera disponible.
  const legacyEncRow = await ctx.db
    .query("acompteEncaissements")
    .withIndex("by_debrief", (q) => q.eq("debriefId", debrief._id))
    .first();

  // ── 6. Choix du plan : custom > devis signé > template financingType ──────────
  // Délégué à resolveTemplatesForDebrief (partagé avec recordEcheance) pour
  // garantir que l'ensemble des ordres valides est identique en lecture et en
  // écriture.
  const {
    templates,
    source: echeancierSource,
    devis: sourceDevis,
  } = await resolveTemplatesForDebrief(ctx, debrief, imported, persistedRows);
  const useCustomEcheancier = echeancierSource === "custom";

  // 10x/12x sans acompte, ou aucun montant → rien à afficher.
  if (templates.length === 0) return null;

  // ── 7. Lookup map ordre → ligne persistée ────────────────────────────────────
  const encByOrdre = new Map<number, (typeof persistedRows)[number]>();
  for (const r of persistedRows) {
    encByOrdre.set(r.ordre, r);
  }

  // Injection pont legacy : si pas de ligne moderne à ordre=1, on insère la
  // ligne legacy synthétisée. La ligne moderne prend toujours le dessus (priority
  // map : si encByOrdre.has(1), on skip). Sémantique portée depuis NestJS
  // queryAcomptes : statut "attendu" → "a_encaisser", ordre figé à 1, pas de
  // jalonKey/percent/montantPrevu (conservés null pour ne pas perturber le plan).
  if (legacyEncRow !== null && !encByOrdre.has(1)) {
    const syntheticStatut =
      legacyEncRow.statut === "attendu" ? "a_encaisser" : legacyEncRow.statut;
    // Cast explicite : les champs _id/_creationTime/debriefId/leadId ne sont pas
    // utilisés par buildLine (lecture seule des champs statut/montant/dates/notes).
    const syntheticEnc = {
      ordre: 1,
      statut: syntheticStatut,
      montantReel: legacyEncRow.montantReel,
      dateEcheance: undefined,
      dateEncaissement: legacyEncRow.dateEncaissement,
      notes: legacyEncRow.notes,
      recordedById: legacyEncRow.recordedById,
      label: undefined,
      jalonKey: undefined,
      percent: undefined,
      montantPrevu: undefined,
    } as unknown as (typeof persistedRows)[number];
    encByOrdre.set(1, syntheticEnc);
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
    echeancierSource,
    devisNumber: sourceDevis?.devisNumber ?? null,
    signedAt: debrief.signedAt ?? null,
    edfRecepisse,
    echeances,
    totalEncaisse,
    resteAPayer,
  };
}
