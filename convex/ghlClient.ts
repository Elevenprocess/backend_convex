/**
 * Client HTTP GoHighLevel partagé (Tranche 8b, réutilisé 8c/8d).
 * GET = 2 tentatives (retry sur erreur réseau et réponse 5xx — GHL renvoie
 * parfois « Command timed out » en 5xx transitoire), timeout 15 s ;
 * mutation = 1 tentative, timeout 8 s — sauf 429 (rate limit) : GHL rejette
 * la requête AVANT de la traiter, donc rejouer un POST est sans risque de
 * doublon → jusqu'à 3 tentatives espacées pour toutes les méthodes.
 * Les erreurs remontées aux setters sont en français clair (ConvexError,
 * donc visibles même en prod) ; le détail technique part dans les logs.
 * Module simple — pas de fonctions Convex ici, uniquement importé par des actions.
 */

import { ConvexError } from "convex/values";

const RETRYABLE_FETCH_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND",
  "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT", "UND_ERR_REQ_RETRY",
]);

type ErrorWithCause = Error & { code?: string; cause?: { code?: string; name?: string; message?: string } };

export class GhlApiError extends ConvexError<string> {}

/** Message lisible pour les setters selon le statut HTTP GHL. */
export function friendlyGhlHttpMessage(status: number, detail?: string): string {
  if (status === 429) {
    return "Trop de demandes en même temps vers le CRM : patiente quelques secondes puis réessaie.";
  }
  if (status === 401 || status === 403) {
    return "Accès au CRM refusé (jeton expiré ou permissions). Préviens un administrateur.";
  }
  if (status >= 500) {
    return "Le CRM (GHL) est momentanément indisponible. Réessaie dans un instant.";
  }
  // 4xx métier (créneau plus dispo, donnée invalide…) : le détail GHL est utile.
  return `Le CRM a refusé la demande${detail ? ` : ${detail}` : ""}. Vérifie les infos saisies puis réessaie.`;
}

const FRIENDLY_NETWORK_MESSAGE =
  "Connexion au CRM impossible (réseau lent ou coupé). Vérifie ta connexion internet puis réessaie — si ça persiste, actualise la page.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

export function isRetryableHttpStatus(status: number): boolean {
  return status >= 500;
}

export function isRetryableFetchError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as ErrorWithCause;
  if (e.code && RETRYABLE_FETCH_CODES.has(e.code)) return true;
  if (e.cause?.code && RETRYABLE_FETCH_CODES.has(e.cause.code)) return true;
  if (e.name === "TimeoutError" || e.name === "AbortError") return true;
  if (e.cause?.name === "TimeoutError" || e.cause?.name === "AbortError") return true;
  return false;
}

function describeFetchError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const e = error as ErrorWithCause;
  const causeDetail = e.cause?.code || e.cause?.message || e.cause?.name;
  if (causeDetail) return `${e.message || "fetch failed"} — cause: ${causeDetail}`;
  return e.message || "fetch failed";
}

export function extractMessage(data: unknown): string | undefined {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return undefined;
  const obj = data as Record<string, unknown>;
  const s = (val: unknown) => (typeof val === "string" && val ? val : undefined);
  return s(obj.message) || s(obj.error) || s(obj.error_description);
}

function ghlToken(): string | undefined {
  return process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
}

export function ghlLocationId(): string | undefined {
  return process.env.GHL_LOCATION_ID;
}

export function isGhlConfigured(): boolean {
  return Boolean(ghlToken() && ghlLocationId());
}

export function requireGhlLocationId(): string {
  const locationId = ghlLocationId();
  if (!locationId) throw new Error("GHL_LOCATION_ID manquant dans l'environnement Convex.");
  return locationId;
}

export async function ghlRequest(
  path: string,
  opts: { method?: string; query?: Record<string, string | number | undefined>; body?: unknown } = {},
): Promise<unknown> {
  const token = ghlToken();
  if (!token) throw new Error("GHL_PRIVATE_INTEGRATION_TOKEN manquant dans l'environnement Convex.");
  const baseUrl = process.env.GHL_API_BASE_URL || "https://services.leadconnectorhq.com";
  const version = process.env.GHL_API_VERSION || "2021-07-28";
  const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const method = opts.method ?? "GET";
  const isMutation = method !== "GET";
  // 429 : GHL rejette avant traitement → rejouable sans doublon, même en POST.
  const maxRateLimitAttempts = 3;
  const maxAttempts = isMutation ? 1 : 2;
  const timeoutMs = isMutation ? 8_000 : 15_000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= Math.max(maxAttempts, maxRateLimitAttempts); attempt++) {
    try {
      const res = await fetch(url.toString(), {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Version: version,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      const data = text ? safeJson(text) : null;
      if (!res.ok) {
        const detail = extractMessage(data) || `${res.status} ${res.statusText}`;
        console.error(`GHL ${method} ${path} → ${res.status} (tentative ${attempt}) : ${detail}`);
        if (res.status === 429 && attempt < maxRateLimitAttempts) {
          lastError = new GhlApiError(friendlyGhlHttpMessage(429));
          await sleep(1_500 * attempt);
          continue;
        }
        const apiError = new GhlApiError(friendlyGhlHttpMessage(res.status, detail));
        if (attempt < maxAttempts && isRetryableHttpStatus(res.status)) {
          lastError = apiError;
          continue;
        }
        throw apiError;
      }
      return data;
    } catch (error) {
      if (error instanceof GhlApiError) throw error;
      lastError = error;
      console.error(`GHL ${method} ${path} injoignable (tentative ${attempt}) : ${describeFetchError(error)}`);
      if (attempt < maxAttempts && isRetryableFetchError(error)) continue;
      throw new GhlApiError(FRIENDLY_NETWORK_MESSAGE);
    }
  }
  throw lastError instanceof Error ? lastError : new GhlApiError(FRIENDLY_NETWORK_MESSAGE);
}
