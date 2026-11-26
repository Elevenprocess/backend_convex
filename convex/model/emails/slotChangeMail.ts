// Mail « Votre nouveau créneau » : envoyé quand un setter CHANGE le créneau
// bureau d'un prospect qui en avait déjà un (le billet garde son numéro, la
// page du billet affiche le nouveau créneau). Même présentation que le mail
// d'invitation du workflow GHL « Créneau réservé ».
import { ghlSlotTexts } from "../promotionSlots";
import { BF26_SLOT_CHANGE_HTML } from "./slotChangeMail.html";

const SITE = "https://invitation.electroconceptoi.com";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderSlotChangeMail(args: {
  firstName?: string | null; ticket: string; day: string; hour: number; ticketUrl?: string | null;
}): { subject: string; html: string } {
  const t = ghlSlotTexts(args.day, args.hour);
  const prenom = args.firstName?.trim() ? args.firstName.trim().split(/\s+/)[0] : "";
  const lien = args.ticketUrl && /^https:\/\//.test(args.ticketUrl) ? args.ticketUrl : SITE;
  const html = BF26_SLOT_CHANGE_HTML
    .replaceAll("Bonjour {{PRENOM}},", prenom ? `Bonjour ${esc(prenom)},` : "Bonjour,")
    .replaceAll("{{BILLET}}", esc(args.ticket))
    .replaceAll("{{JOUR}}", esc(t.jour))
    .replaceAll("{{TRANCHE}}", esc(t.heure))
    .replaceAll("{{DE}}", esc(t.heure))
    .replaceAll("{{LIEN}}", esc(lien));
  return { subject: `Votre nouveau créneau, ${t.creneau}`, html };
}
