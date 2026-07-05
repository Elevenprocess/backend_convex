/**
 * Classifieur du canal d'acquisition d'un lead. Portage verbatim de
 * `ECOI_backend/src/modules/leads/acquisition-channel.classifier.ts`
 * (Tranche 8a) — le type de retour est l'`AdChannel` Convex existant et les
 * signaux sont undefined-based (jamais null côté Convex).
 *
 * Fonction PURE : `sourceMap` est passé par l'appelant (clé = rawSource normalisé).
 */

import type { AdChannel } from "./enums";

export interface AttributionSignals {
  fbclid?: string;
  gclid?: string;
  utmSource?: string;
  /** GHL contact.attributionSource.medium : facebook | instagram | whatsapp | form | Manual */
  medium?: string;
  /** GHL contact.attributionSource.sessionSource : Paid Social | Social media | CRM Workflows | Organic Search | Direct traffic */
  sessionSource?: string;
  canalAcquisition?: string;
}

const META_UTM = new Set(["fb", "ig", "facebook", "instagram", "meta"]);
const GOOGLE_UTM = new Set(["google", "adwords", "google_ads"]);
// Signaux GHL réels (cf. scan de 600 contacts) : le canal vit dans
// attributionSource.medium / .sessionSource, pas dans contact.source (null ~63%).
const META_MEDIUM = new Set(["facebook", "instagram"]);
const META_SESSION = new Set(["paid social", "social media"]); // social media = Meta organique (décision métier)

export function normalizeSource(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

const present = (v: string | undefined): boolean =>
  typeof v === "string" && v.trim().length > 0;

/**
 * Détermine le canal normalisé d'un lead. Ordre de priorité (du plus fiable
 * au plus faible), basé sur les signaux GHL réels :
 *  1. Meta   : medium fb/ig · fbclid · utm meta · sessionSource Paid Social/Social media
 *  2. Referral : medium whatsapp
 *  3. Google : gclid · utm google
 *  4. Organic : sessionSource Organic Search · medium form · medium Manual / sessionSource CRM (simulateur)
 *  5. Direct  : sessionSource Direct traffic
 *  6. lookup table de mapping (source GHL brute normalisée)
 *  7. other
 */
export function deriveAcquisitionChannel(
  s: AttributionSignals,
  sourceMap: Map<string, string>,
): AdChannel {
  const utm = normalizeSource(s.utmSource);
  const medium = normalizeSource(s.medium);
  const session = normalizeSource(s.sessionSource);

  // 1. Meta
  if (META_MEDIUM.has(medium)) return "meta";
  if (present(s.fbclid) || META_UTM.has(utm)) return "meta";
  if (META_SESSION.has(session)) return "meta";

  // 2. WhatsApp → referral (décision métier)
  if (medium === "whatsapp") return "referral";

  // 3. Google
  if (present(s.gclid) || GOOGLE_UTM.has(utm)) return "google";

  // 4. Organique : recherche organique, formulaire site, ou simulateur/CRM
  //    (ECOI SaaS = simulateur créé via CRM Workflows / medium Manual → organic).
  if (session === "organic search" || medium === "form") return "organic";
  if (medium === "manual" || session === "crm workflows" || session === "crm ui") return "organic";

  // 5. Direct
  if (session === "direct traffic") return "direct";

  // 6. Fallback : table de mapping sur la source brute (contact.source)
  const raw = normalizeSource(s.canalAcquisition);
  const mapped = raw ? sourceMap.get(raw) : undefined;
  return (mapped as AdChannel) ?? "other";
}
