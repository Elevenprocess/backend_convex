/**
 * Normalisation du payload "Contact Created" GHL (workflow → action Webhook).
 * GHL laisse composer le JSON librement → on accepte les alias camel/snake.
 * Portage de mapGhlPayloadToCreateLead (NestJS) sans zod : normalisation
 * défensive, seules les strings non vides sont retenues. Fonction PURE.
 *
 * IMPORTANT (cf. scan GHL réel) : contact.source est null ~63% du temps. Le
 * vrai canal vit dans attributionSource.medium (facebook/instagram/whatsapp/
 * form/Manual) et .sessionSource (Paid Social / Social media / CRM Workflows /
 * Organic Search / Direct traffic). Ce sont eux que le classifieur exploite.
 */

import type { AttributionSignals } from "../acquisitionChannel";

const pick = (...values: unknown[]): string | undefined => {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
};

const splitFullName = (
  full: string | undefined,
): { firstName?: string; lastName?: string } => {
  if (!full) return {};
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
};

export interface MappedGhlLead {
  externalId?: string;
  signals: AttributionSignals;
  data: {
    firstName?: string; lastName?: string; email?: string; phone?: string;
    addressLine?: string; city?: string; postalCode?: string;
    utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string;
    campaign?: string; adset?: string; ad?: string;
    canalAcquisition?: string; campaignId?: string; adsetId?: string; adId?: string;
    attributionMedium?: string; attributionSessionSource?: string;
  };
}

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function mapGhlLeadPayload(p: Record<string, unknown>): MappedGhlLead {
  const externalId = pick(p.contact_id, p.contactId, p.id);
  let firstName = pick(p.first_name, p.firstName);
  let lastName = pick(p.last_name, p.lastName);
  if (!firstName && !lastName) {
    const split = splitFullName(pick(p.full_name, p.name));
    firstName = split.firstName;
    lastName = split.lastName;
  }

  // L'attribution GHL réelle est IMBRIQUÉE : le payload standard des workflows
  // porte contact.attributionSource (et lastAttributionSource en historique),
  // pas des clés à plat. On fusionne les sources par fiabilité croissante —
  // contact.attributionSource écrase lastAttributionSource — et les clés à
  // plat (payload composé à la main) restent prioritaires via pick().
  const contact = obj(p.contact);
  const attr = {
    ...obj(p.lastAttributionSource),
    ...obj(contact.lastAttributionSource),
    ...obj(p.attributionSource),
    ...obj(contact.attributionSource),
  };
  // Les « Données personnalisées » d'une action Webhook GHL arrivent sous
  // customData, pas à la racine — c'est par là que le workflow [01.2] relaie
  // les UTM du simulateur (inboundWebhookRequest → customData).
  const custom = obj(p.customData);

  // Source brute pour le mapping admin « Sources à classer » : à défaut de
  // source contact, le NOM DU WORKFLOW créateur (ex. « [01.2] New Lead |
  // Simulateur ») — c'est lui qui identifie le tunnel d'entrée du lead.
  const workflow = obj(p.workflow);
  const canalAcquisition = pick(
    p.canal_acquisition, p.canalAcquisition, p.source, contact.source, workflow.name,
  );

  return {
    externalId,
    signals: {
      fbclid: pick(p.fbclid, custom.fbclid, attr.fbclid),
      gclid: pick(p.gclid, custom.gclid, attr.gclid),
      utmSource: pick(p.utm_source, p.utmSource, custom.utm_source, custom.utmSource, attr.utmSource, attr.utm_source),
      medium: pick(p.medium, attr.medium),
      sessionSource: pick(p.session_source, p.sessionSource, attr.sessionSource, attr.session_source),
      canalAcquisition,
    },
    data: {
      firstName, lastName,
      email: pick(p.email),
      phone: pick(p.phone),
      addressLine: pick(p.address1, p.address),
      city: pick(p.city),
      postalCode: pick(p.postal_code, p.postalCode),
      utmSource: pick(p.utm_source, p.utmSource, custom.utm_source, custom.utmSource, attr.utmSource, attr.utm_source),
      utmMedium: pick(p.utm_medium, p.utmMedium, custom.utm_medium, custom.utmMedium, attr.utmMedium, attr.utm_medium),
      utmCampaign: pick(p.utm_campaign, p.utmCampaign, custom.utm_campaign, custom.utmCampaign, attr.utmCampaign, attr.utm_campaign),
      // Nomenclature Meta convenue (2026-08-03) : utm_content = nom de la
      // créative — c'est la clé du rapport « Performance créative ».
      utmContent: pick(p.utm_content, p.utmContent, custom.utm_content, custom.utmContent, attr.utmContent, attr.utm_content),
      campaign: pick(p.campaign, custom.campaign, attr.campaign),
      adset: pick(p.adset, custom.adset),
      ad: pick(p.ad, custom.ad),
      canalAcquisition,
      campaignId: pick(p.campaign_id, p.campaignId, custom.campaign_id, custom.campaignId, attr.campaignId, attr.campaign_id),
      adsetId: pick(p.adset_id, p.adsetId, attr.adsetId, attr.adset_id),
      adId: pick(p.ad_id, p.adId, attr.adId, attr.ad_id),
      attributionMedium: pick(p.medium, attr.medium),
      attributionSessionSource: pick(p.session_source, p.sessionSource, attr.sessionSource, attr.session_source),
    },
  };
}
