/**
 * Messages de notification (portage verbatim de notif-messages.ts +
 * vt-date-change-notify.ts, NestJS). Helpers PURS.
 */

export function formatFrDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  // isoDate est 'YYYY-MM-DD' (date-only) → format JJ/MM/AAAA sans dépendre du fuseau.
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

export function vtAssignedMessage(input: {
  leadName: string;
  city: string | null;
}): { title: string; body: string } {
  const body = [input.leadName, input.city].filter(Boolean).join(" — ");
  return { title: "Nouvelle VT attribuée", body };
}

export function vtDateChangedMessage(input: {
  leadName: string;
  date: string | null;
}): { title: string; body: string } {
  const fr = formatFrDate(input.date);
  const body = fr ? `${input.leadName} — VT le ${fr}` : `${input.leadName} — VT replanifiée`;
  return { title: "Date de VT mise à jour", body };
}

export function acompte40Message(input: {
  leadName: string;
}): { type: "acompte_a_encaisser"; title: string; body: string } {
  return {
    type: "acompte_a_encaisser",
    title: "Acompte à encaisser (40 %)",
    body: `VT validée pour ${input.leadName} — encaisser le 1er acompte (40 %).`,
  };
}

// Alerte immédiate au responsable commercial à chaque débrief créé.
// Portage de DebriefAlertsService.notifyDebriefCreated (WhatsApp NestJS →
// notification in-app Convex).
export function debriefCreatedMessage(input: {
  commercialName: string;
  outcome: string;
  montantTotal?: number;
}): { type: "debrief_created"; title: string; body: string } {
  const issue = input.outcome === "vente" ? "VENTE" : input.outcome === "non_vente" ? "non-vente" : input.outcome;
  const montant =
    input.outcome === "vente" && input.montantTotal !== undefined && input.montantTotal > 0
      ? ` — ${input.montantTotal.toLocaleString("fr-FR")} €`
      : "";
  return {
    type: "debrief_created",
    title: "Nouveau débrief",
    body: `${input.commercialName} a saisi un débrief (${issue})${montant}.`,
  };
}

// Alerte immédiate au commercial quand l'accueil signale une annulation de RDV
// (reçue par appel/WhatsApp sur le numéro central). Type préfixé `rdv_` pour
// que le front lui donne l'icône/le groupe RDV.
export function rdvCancelledMessage(input: {
  leadName: string;
  reason?: string;
}): { type: "rdv_annule"; title: string; body: string } {
  const motif = input.reason ? ` — ${input.reason}` : "";
  return {
    type: "rdv_annule",
    title: "RDV annulé",
    body: `${input.leadName} a annulé son RDV${motif}.`,
  };
}

// Alerte immédiate au commercial quand l'accueil signale un report de RDV. La
// nouvelle date/heure exacte est portée par le payload (formatée côté front,
// pour éviter tout décalage de fuseau côté serveur).
export function rdvRescheduledMessage(input: {
  leadName: string;
  reason?: string;
}): { type: "rdv_reporte"; title: string; body: string } {
  const motif = input.reason ? ` — ${input.reason}` : "";
  return {
    type: "rdv_reporte",
    title: "RDV reporté",
    body: `${input.leadName} a reporté son RDV${motif}.`,
  };
}

export function acompteSoldeMessage(input: {
  leadName: string;
}): { type: "acompte_a_encaisser"; title: string; body: string } {
  return {
    type: "acompte_a_encaisser",
    title: "Solde à encaisser",
    body: `Installation effectuée pour ${input.leadName} — encaisser le solde.`,
  };
}

/**
 * Décide si un changement de sous-étape déclenche une notif « date de VT
 * modifiée ». Vrai uniquement pour la sous-étape 'vt_planifie' quand une
 * nouvelle date (non undefined) diffère de l'ancienne.
 */
export function shouldNotifyVtDateChange(input: {
  key: string;
  beforeDate: string | null;
  nextDate: string | null | undefined;
}): boolean {
  if (input.key !== "vt_planifie") return false;
  if (input.nextDate === undefined) return false;
  return (input.nextDate ?? null) !== (input.beforeDate ?? null);
}
