// Logique pure des promotions (Black Friday…) : tags GHL, dates Réunion,
// statut calculé, correspondance tag → promo, conflits, éligibilité des
// anciens leads. Aucune I/O : testé seul (promotions.test.ts).
import type { LeadStatus } from "./enums";

const REUNION_OFFSET_MS = 4 * 3_600_000; // UTC+4 fixe, pas d'heure d'été
const DAY_MS = 86_400_000;

export function normalizeTag(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Tags GHL : "a,b" (payload workflow) ou ["a","b"]. Dédoublonnés (forme normalisée), vides retirés. */
export function parseGhlTags(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string")
    : typeof raw === "string" ? raw.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const tag = part.trim();
    if (!tag) continue;
    const key = normalizeTag(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** "YYYY-MM-DD" (jour Réunion) → ms du minuit Réunion. */
export function reunionDayStartMs(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`Date invalide : ${day}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - REUNION_OFFSET_MS;
}

/** "YYYY-MM-DD" (jour Réunion) → ms de 23:59:59.999 Réunion. */
export function reunionDayEndMs(day: string): number {
  return reunionDayStartMs(day) + DAY_MS - 1;
}

export type PromotionLike = {
  _id: string;
  tagKey?: string;
  startAt: number;
  endAt: number;
  archived: boolean;
  officeCalendarId?: string;
  legacyStatuses?: LeadStatus[];
  legacyArrivedFrom?: number;
  legacyArrivedTo?: number;
};

export type PromotionStatus = "a_venir" | "en_cours" | "terminee";

export function promotionStatus(p: Pick<PromotionLike, "startAt" | "endAt" | "archived">, now: number): PromotionStatus {
  if (p.archived || now > p.endAt) return "terminee";
  if (now < p.startAt) return "a_venir";
  return "en_cours";
}

export function matchPromotion<P extends PromotionLike>(tags: string[], promos: P[], at: number): P | undefined {
  const keys = new Set(tags.map(normalizeTag));
  return promos
    .filter((p) => p.tagKey !== undefined && keys.has(p.tagKey) && promotionStatus(p, at) === "en_cours")
    .sort((a, b) => b.startAt - a.startAt)[0];
}

function overlap(a: { startAt: number; endAt: number }, b: { startAt: number; endAt: number }): boolean {
  return a.startAt <= b.endAt && b.startAt <= a.endAt;
}

/** Message d'erreur lisible, ou null si la promo candidate ne gêne aucune autre. */
export function promotionConflict(candidate: PromotionLike, others: PromotionLike[]): string | null {
  for (const other of others) {
    if (other._id === candidate._id || other.archived || !overlap(candidate, other)) continue;
    if (candidate.tagKey && other.tagKey === candidate.tagKey) {
      return "Une autre promotion utilise déjà ce tag sur ces dates.";
    }
    if (candidate.officeCalendarId && other.officeCalendarId) {
      return "Une autre promotion avec RDV au bureau est déjà prévue sur ces dates.";
    }
  }
  return null;
}

export type LegacyCandidate = {
  status: LeadStatus;
  arrivedAt: number;
  deletedAt?: number;
  promotionId?: string;
  hasUpcomingRdv: boolean;
};

export type LegacyRejectReason = "statut" | "periode" | "supprime" | "signe" | "deja_promo" | "rdv_a_venir";

export function legacyRejectReason(
  lead: LegacyCandidate,
  promo: Pick<PromotionLike, "legacyStatuses" | "legacyArrivedFrom" | "legacyArrivedTo">,
): LegacyRejectReason | null {
  if (!(promo.legacyStatuses ?? []).includes(lead.status)) return "statut";
  if (promo.legacyArrivedFrom !== undefined && lead.arrivedAt < promo.legacyArrivedFrom) return "periode";
  if (promo.legacyArrivedTo !== undefined && lead.arrivedAt > promo.legacyArrivedTo) return "periode";
  if (lead.deletedAt !== undefined) return "supprime";
  if (lead.status === "signe") return "signe";
  if (lead.promotionId !== undefined) return "deja_promo";
  if (lead.hasUpcomingRdv) return "rdv_a_venir";
  return null;
}

export function isLegacyEligible(
  lead: LegacyCandidate,
  promo: Pick<PromotionLike, "legacyStatuses" | "legacyArrivedFrom" | "legacyArrivedTo">,
): boolean {
  return legacyRejectReason(lead, promo) === null;
}

export type PromotionSlot = { day: string; hour: number; ticket?: string };
/**
 * Créneau d’arrivée envoyé par le site d’inscription de la promo sur le lien
 * webhook (creneau_jour "YYYY-MM-DD", creneau_heure 0-23, billet). null si
 * absent ou invalide : le webhook se comporte alors comme avant.
 */
export function parsePromotionSlot(p: Record<string, unknown>): PromotionSlot | null {
  const day = typeof p.creneau_jour === "string" ? p.creneau_jour.trim() : "";
  const rawHour = p.creneau_heure;
  const hour = typeof rawHour === "number" ? rawHour
    : typeof rawHour === "string" && rawHour.trim() !== "" ? Number(rawHour) : NaN;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const ticket = typeof p.billet === "string" && p.billet.trim() !== "" ? p.billet.trim().slice(0, 40) : undefined;
  return { day, hour, ...(ticket !== undefined ? { ticket } : {}) };
}
const SLOT_WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
/** "2026-11-27", 14, "BF-0012" → "vendredi 27, 14 h, billet BF-0012" */
export function formatPromotionSlot(day: string, hour: number, ticket?: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${SLOT_WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}, ${hour} h${ticket ? `, billet ${ticket}` : ""}`;
}
