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
    utmSource?: string; utmMedium?: string; utmCampaign?: string;
    campaign?: string; adset?: string; ad?: string;
    canalAcquisition?: string; campaignId?: string; adsetId?: string; adId?: string;
    attributionMedium?: string; attributionSessionSource?: string;
  };
}

export function mapGhlLeadPayload(p: Record<string, unknown>): MappedGhlLead {
  const externalId = pick(p.contact_id, p.contactId, p.id);
  let firstName = pick(p.first_name, p.firstName);
  let lastName = pick(p.last_name, p.lastName);
  if (!firstName && !lastName) {
    const split = splitFullName(pick(p.full_name, p.name));
    firstName = split.firstName;
    lastName = split.lastName;
  }
  const canalAcquisition = pick(p.canal_acquisition, p.canalAcquisition, p.source);

  return {
    externalId,
    signals: {
      fbclid: pick(p.fbclid),
      gclid: pick(p.gclid),
      utmSource: pick(p.utm_source, p.utmSource),
      medium: pick(p.medium),
      sessionSource: pick(p.session_source, p.sessionSource),
      canalAcquisition,
    },
    data: {
      firstName, lastName,
      email: pick(p.email),
      phone: pick(p.phone),
      addressLine: pick(p.address1, p.address),
      city: pick(p.city),
      postalCode: pick(p.postal_code, p.postalCode),
      utmSource: pick(p.utm_source, p.utmSource),
      utmMedium: pick(p.utm_medium, p.utmMedium),
      utmCampaign: pick(p.utm_campaign, p.utmCampaign),
      campaign: pick(p.campaign),
      adset: pick(p.adset),
      ad: pick(p.ad),
      canalAcquisition,
      campaignId: pick(p.campaign_id, p.campaignId),
      adsetId: pick(p.adset_id, p.adsetId),
      adId: pick(p.ad_id, p.adId),
      attributionMedium: pick(p.medium),
      attributionSessionSource: pick(p.session_source, p.sessionSource),
    },
  };
}
