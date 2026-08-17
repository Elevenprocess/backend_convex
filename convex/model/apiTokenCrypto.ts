/**
 * Génération / hachage des clés API agents. SHA-256 hex (identique à
 * crypto.subtle.digest("SHA-256")), calculé avec @noble/hashes pour marcher
 * dans les queries/mutations comme dans les httpActions.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const TOKEN_PREFIX = "vlr_";
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function hashToken(secret: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(secret)));
}

export function randomToken(): string {
  const bytes = new Uint8Array(40);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${TOKEN_PREFIX}${out}`;
}

export function tokenPrefix(secret: string): string {
  return secret.slice(0, 12);
}
