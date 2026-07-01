// ─── Échéancier d'acompte — templates dérivés du financingType ────────────
// Source de vérité (en code, pas en base) du découpage en tranches d'une vente
// signée, et du jalon (substep délivrabilité) qui rend chaque tranche
// « à encaisser ». Cf. acompte-echeances.ts pour la persistance côté finances.
//
// Portage verbatim de ECOI_backend/src/modules/payments/acompte-echeancier.ts
// Adaptations : montantTotal/acompteAmount en number (pas string), tranchePrevue
// retourne number | null (pas string). EcheanceJalon importé de ./enums.

import { EcheanceJalon } from "./enums";

// Jalon = clé d'un workflow_substeps qui, une fois « fait », rend la tranche due.
// 'signature' = jalon spécial : la vente est signée → tranche due immédiatement
// (pas un substep workflow ; traité comme toujours franchi côté buildLine).
// null = pas de jalon (tranche legacy 10x/12x ou acompte direct).
// Note: EcheanceJalon depuis enums.ts = union sans null ; on compose avec null ici.
export type EcheanceJalonOrNull = EcheanceJalon | null;

export type EcheanceTemplate = {
  ordre: number;
  label: string;
  jalonKey: EcheanceJalonOrNull;
  percent: number;
};

// Template « de travail » résolu pour un débrief précis : issu du catalogue
// (percent défini, montant calculé % × total) OU d'un fallback (acompte direct /
// mode non renseigné) qui porte alors un montant figé via `montantOverride`.
export type WorkTemplate = {
  ordre: number;
  label: string;
  jalonKey: EcheanceJalonOrNull;
  percent: number | null;
  // Si défini, remplace le calcul percent × montantTotal (acompte saisi,
  // ou solde total quand l'échéancier n'est pas connu).
  // Convex: number au lieu de string (NestJS).
  montantOverride?: number | null;
};

// Template par défaut : quand l'import ne connaît pas le mode de paiement,
// on garde la logique Solteo/transcription : 40% après VT, puis 20% DP,
// 20% planification pose, 20% pose/installation. Cela permet de faire ressortir
// les dossiers déjà avancés à 80% sans encaissement saisi.
const DEFAULT_IMPORTED_TEMPLATE: EcheanceTemplate[] = [
  { ordre: 1, label: 'VT validée', jalonKey: 'vt_validee', percent: 40 },
  { ordre: 2, label: 'DP envoyée', jalonKey: 'dp_envoyee_mairie', percent: 20 },
  { ordre: 3, label: 'Installation planifiée', jalonKey: 'install_a_faire', percent: 20 },
  { ordre: 4, label: 'Installation effectuée', jalonKey: 'install_effectuee', percent: 20 },
];

// Échéancier des dossiers IMPORTÉS (airtable_migration), calqué sur la sémantique
// des devis : 40% à la signature (dû d'emblée, vente signée), puis 20% à la
// validation technique, 20% à la réception du CNO (DP validée), 20% à la fin de
// pose (installation effectuée). Appliqué aux imports comptant / mode non
// renseigné — pas aux financements (solde 100% à l'install) ni au 10x/12x.
const IMPORTED_TEMPLATE: EcheanceTemplate[] = [
  { ordre: 1, label: 'Signature du devis', jalonKey: 'signature', percent: 40 },
  { ordre: 2, label: 'Validation technique', jalonKey: 'vt_validee', percent: 20 },
  { ordre: 3, label: 'Réception du CNO', jalonKey: 'dp_validee', percent: 20 },
  { ordre: 4, label: 'Fin de pose', jalonKey: 'install_effectuee', percent: 20 },
];

// Comptant : 40% (VT validée) + 20% DP + 20% planification pose + 20% pose.
// (SOFIDER/CMOI) : 100% solde déclenché à l'installation effectuée — le récépissé
// EDF (racco validé) est affiché comme confirmation côté finances. 10x/12x : non
// gérés (pas de template).
const COMPTANT_TEMPLATE: EcheanceTemplate[] = DEFAULT_IMPORTED_TEMPLATE;

const FINANCEMENT_TEMPLATE: EcheanceTemplate[] = [
  {
    ordre: 1,
    label: 'Solde (après install / récépissé EDF)',
    jalonKey: 'install_effectuee',
    percent: 100,
  },
];

const FINANCEMENT_TYPES = new Set([
  'financement',
  'financement_sans_apport',
  'apport_financement',
]);

/**
 * Template d'échéancier pour un financingType donné. Tableau vide si le type
 * n'est pas géré (10x/12x, inconnu) — l'appelant gère alors un fallback legacy
 * sur l'acompte direct s'il y en a un.
 */
export function echeancierTemplate(
  financingType: string | null | undefined,
): EcheanceTemplate[] {
  if (financingType === 'comptant') return COMPTANT_TEMPLATE;
  if (financingType && FINANCEMENT_TYPES.has(financingType)) {
    return FINANCEMENT_TEMPLATE;
  }
  return [];
}

// Types de financement par échéances externes (organisme prêteur) : le suivi
// d'encaissement est porté par l'organisme, pas par finances. Pas de template.
const ECHEANCE_EXTERNE_TYPES = new Set(['paiement_10x', 'paiement_12x']);

/**
 * Échéancier de travail résolu pour UN débrief — source unique utilisée par la
 * lecture (vue finances) ET la validation d'écriture (recordEcheance), pour que
 * les deux partagent exactement le même ensemble de tranches valides.
 *
 * Règles :
 *  - comptant / financement → template catalogue (% × montantTotal).
 *  - 10x / 12x avec acompte direct → tranche unique « Acompte » (montant figé).
 *  - 10x / 12x sans acompte → [] (suivi porté par l'organisme, rien à afficher).
 *  - mode non renseigné (financingType null) mais montantTotal > 0 → même
 *    échéancier 40/20/20/20 que le comptant, pour que l'avancement Sheet/Solteo
 *    rende visibles les tranches dues (ex. dossier à 80%).
 *  - aucun montant ni acompte → [] (rien à suivre).
 *
 * Convex: montantTotal/acompteAmount en number | null (pas string).
 */
export function resolveEcheancier(input: {
  financingType: string | null | undefined;
  montantTotal: number | null;
  acompteAmount: number | null;
  acomptePercent: number | null;
  // Dossier issu de la migration (airtable_migration) : applique l'échéancier
  // « devis » (signature/VT/CNO/pose) au lieu du template comptant standard.
  imported?: boolean;
}): WorkTemplate[] {
  const montantPositif = input.montantTotal != null && input.montantTotal > 0;

  // Imports comptant / mode non renseigné → échéancier devis. Les financements
  // (solde 100% install) et 10x/12x gardent leur logique propre ci-dessous.
  if (
    input.imported &&
    montantPositif &&
    (input.financingType === 'comptant' || !input.financingType)
  ) {
    return IMPORTED_TEMPLATE;
  }

  const template = echeancierTemplate(input.financingType);
  if (template.length > 0) return template;

  const hasAcompte = input.acompteAmount != null && input.acompteAmount > 0;
  if (hasAcompte) {
    return [
      {
        ordre: 1,
        label: 'Acompte',
        jalonKey: null,
        percent: input.acomptePercent ?? null,
        montantOverride: input.acompteAmount,
      },
    ];
  }

  // 10x / 12x sans acompte : suivi externe → rien à afficher.
  if (input.financingType && ECHEANCE_EXTERNE_TYPES.has(input.financingType)) {
    return [];
  }

  // Mode de paiement non renseigné mais montant signé : on applique le découpage
  // 40/20/20/20 pour faire ressortir VT/DP/planif/install déjà franchies.
  const hasMontant = input.montantTotal != null && input.montantTotal > 0;
  if (!input.financingType && hasMontant) return DEFAULT_IMPORTED_TEMPLATE;

  return [];
}

/**
 * Normalise un jalonKey depuis une valeur saisie (alias courts ou valeurs complètes).
 * Retourne null pour tout alias inconnu.
 */
export function normalizeJalonKey(key: string | null): EcheanceJalonOrNull {
  switch (key) {
    case 'vt':
      return 'vt_validee';
    case 'dp':
      return 'dp_envoyee_mairie';
    case 'pose_planif':
      return 'install_a_faire';
    case 'pose':
      return 'install_effectuee';
    case 'signature':
    case 'vt_validee':
    case 'dp_envoyee_mairie':
    case 'dp_validee':
    case 'install_a_faire':
    case 'install_effectuee':
    case 'racco_validee':
      return key;
    default:
      return null;
  }
}

/**
 * Échéancier PERSONNALISÉ : construit les WorkTemplate depuis les lignes
 * persistées (back-office). Chaque ligne porte son libellé, son % et/ou son
 * montant figé, et un jalon optionnel. Triées par ordre.
 *
 * Convex: montantPrevu en number | null (pas string).
 */
export function customTemplatesFromRows(
  rows: Array<{
    ordre: number;
    label: string | null;
    percent: number | null;
    montantPrevu: number | null;
    jalonKey: string | null;
  }>,
): WorkTemplate[] {
  return [...rows]
    .sort((a, b) => a.ordre - b.ordre)
    .map((r) => ({
      ordre: r.ordre,
      label: r.label ?? `Tranche ${r.ordre}`,
      jalonKey: normalizeJalonKey(r.jalonKey),
      percent: r.percent,
      // Montant figé prioritaire ; sinon calcul % × montantTotal côté appelant.
      montantOverride: r.montantPrevu ?? undefined,
    }));
}

/** Jalon « récépissé EDF » affiché comme confirmation pour le solde financement. */
export const EDF_CONFIRMATION_JALON: EcheanceJalon = 'racco_validee';

/**
 * montantPrevu = montantTotal × percent / 100, arrondi 2 décimales.
 * null si pas de total.
 * Convex: retourne number | null (pas string comme en NestJS).
 */
export function tranchePrevue(
  montantTotal: number | null,
  percent: number,
): number | null {
  if (montantTotal == null) return null;
  return Math.round((montantTotal * percent) / 100 * 100) / 100;
}
