/**
 * Lien magique débrief : token HMAC-SHA256 signé, sans état en base. Porte le
 * rdvId (Id Convex, string opaque — PAS un UUID) + une expiration (uint32 s,
 * 0 = permanent). Web Crypto (crypto.subtle) car le runtime Convex n'a ni
 * Buffer ni crypto Node. Async → utilisable uniquement en action/httpAction.
 *
 * Format : b64url(utf8(rdvId) ++ u32BE(expSec)) + "." + b64url(hmac[0..16]).
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function subtle(): SubtleCrypto {
  return (globalThis.crypto ?? crypto).subtle;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmac16(payload: Uint8Array, secret: string): Promise<Uint8Array> {
  const key = await subtle().importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await subtle().sign("HMAC", key, payload as BufferSource);
  return new Uint8Array(sig).subarray(0, 16);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signDebriefToken(
  rdvId: string,
  secret: string,
  opts: { ttlDays?: number; nowMs?: number } = {},
): Promise<string> {
  if (!secret) throw new Error("DEBRIEF_LINK_SECRET / BETTER_AUTH_SECRET manquant");
  if (!rdvId) throw new Error("rdvId invalide");
  const ttlDays = opts.ttlDays ?? 0;
  const nowMs = opts.nowMs ?? Date.now();
  const expSec = ttlDays > 0
    ? Math.min(Math.floor((nowMs + ttlDays * 86_400_000) / 1000), 0xffffffff)
    : 0;
  const idBytes = encoder.encode(rdvId);
  const payload = new Uint8Array(idBytes.length + 4);
  payload.set(idBytes, 0);
  new DataView(payload.buffer).setUint32(idBytes.length, expSec >>> 0, false);
  const sig = await hmac16(payload, secret);
  return `${b64urlEncode(payload)}.${b64urlEncode(sig)}`;
}

export async function verifyDebriefToken(
  token: string,
  secret: string,
  opts: { nowMs?: number } = {},
): Promise<{ rdvId: string; exp: number } | null> {
  if (!secret || !token) return null;
  // L'agent VPS écrit parfois le token avec une ponctuation finale (« token. »),
  // qui part telle quelle dans l'URL du bouton WhatsApp — on tolère ces suffixes
  // pour que les liens déjà envoyés restent valides.
  const parts = token.trim().replace(/[.\s]+$/, "").split(".");
  if (parts.length !== 2) return null;
  let payload: Uint8Array;
  let sig: Uint8Array;
  try {
    payload = b64urlDecode(parts[0]);
    sig = b64urlDecode(parts[1]);
  } catch {
    return null;
  }
  if (payload.length < 5) return null;
  const expected = await hmac16(payload, secret);
  if (!timingSafeEqual(sig, expected)) return null;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const expSec = dv.getUint32(payload.length - 4, false);
  const nowMs = opts.nowMs ?? Date.now();
  if (expSec !== 0 && expSec * 1000 < nowMs) return null;
  const rdvId = decoder.decode(payload.subarray(0, payload.length - 4));
  return { rdvId, exp: expSec === 0 ? 0 : expSec * 1000 };
}
