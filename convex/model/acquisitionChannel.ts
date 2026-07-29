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
 *  4. lookup table de mapping admin (source brute ou nom de workflow normalisé)
 *  5. Organic : sessionSource Organic Search · medium form · medium Manual / sessionSource CRM
 *  6. Direct  : sessionSource Direct traffic
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

  // 4. Mapping admin sur la source brute (contact.source ou nom du workflow
  //    créateur) : une décision EXPLICITE de l'admin (page Ads → Sources à
  //    classer) outrank les heuristiques faibles ci-dessous — c'est ce qui
  //    permet de rattacher les leads du workflow Simulateur au canal Meta
  //    alors que GHL les tague Manual/CRM Workflows.
  const raw = normalizeSource(s.canalAcquisition);
  const mapped = raw ? sourceMap.get(raw) : undefined;
  if (mapped !== undefined) return mapped as AdChannel;

  // 5. Organique : recherche organique, formulaire site, ou création CRM
  //    (medium Manual / CRM Workflows) non mappée par l'admin.
  if (session === "organic search" || medium === "form") return "organic";
  if (medium === "manual" || session === "crm workflows" || session === "crm ui") return "organic";

  // 6. Direct
  if (session === "direct traffic") return "direct";

  return "other";
}
