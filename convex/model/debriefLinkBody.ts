/**
 * Normalisation du body JSON du POST public /debrief-link/<token> avant
 * submitViaLink. Parité NestJS : le front public envoie les montants en
 * string ("3703.50"), signedAt en date ISO ("2026-07-20") et null pour les
 * champs vides — les validateurs Convex (v.number(), v.optional()) refusent
 * tout ça. Whitelist stricte : les clés inconnues (et rdvId, forcé par le
 * token) sont ignorées.
 */

const STRING_KEYS = ["objection", "notes", "kits", "externalId"] as const;
const ENUM_KEYS = [
  "outcome", "nonSaleReason", "reflexionReason", "suiviReason",
  "financingType", "paymentSubMethod", "financingOrg",
] as const;
const NUMBER_KEYS = ["montantTotal", "acomptePercent", "acompteAmount"] as const;

function toNumber(key: string, value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`Champ ${key} invalide : nombre attendu.`);
}

function toTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new Error("Champ signedAt invalide : date attendue.");
}

export function normalizePublicDebriefBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of [...ENUM_KEYS, ...STRING_KEYS]) {
    const value = body[key];
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  for (const key of NUMBER_KEYS) {
    const value = body[key];
    if (value !== null && value !== undefined && value !== "") out[key] = toNumber(key, value);
  }
  if (body.signedAt !== null && body.signedAt !== undefined && body.signedAt !== "") {
    out.signedAt = toTimestamp(body.signedAt);
  }
  if (Array.isArray(body.acceptanceFactors)) {
    out.acceptanceFactors = body.acceptanceFactors.filter((f) => typeof f === "string");
  }
  const custom = body.customEcheancier;
  if (typeof custom === "boolean") out.customEcheancier = custom;
  else if (custom === "true") out.customEcheancier = true;
  else if (custom === "false") out.customEcheancier = false;
  return out;
}
