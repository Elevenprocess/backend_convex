import { scryptAsync } from "@noble/hashes/scrypt.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Scrypt as LuciaScrypt } from "lucia";

// Hachage des mots de passe au FORMAT BETTER-AUTH (backend NestJS historique) :
// scrypt N=16384 r=16 p=1 dkLen=64, hash = `${saltHex(32)}:${keyHex(128)}`.
// Les 36 comptes migrés de Postgres gardent ainsi leur mot de passe tel quel,
// et les nouveaux comptes utilisent le même format (un seul chemin de vérif).
// Le fallback Lucia couvre d'éventuels hashs créés avant cette bascule.

const SCRYPT = { N: 16384, r: 16, p: 1, dkLen: 64, maxmem: 128 * 16384 * 16 * 2 };
const BETTER_AUTH_HASH = /^[0-9a-f]{32}:[0-9a-f]{128}$/;

async function scryptKey(password: string, saltHex: string): Promise<string> {
  const key = await scryptAsync(password.normalize("NFKC"), saltHex, SCRYPT);
  return bytesToHex(key);
}

export async function hashSecret(password: string): Promise<string> {
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  return `${salt}:${await scryptKey(password, salt)}`;
}

export async function verifySecret(password: string, hash: string): Promise<boolean> {
  if (BETTER_AUTH_HASH.test(hash)) {
    const [salt, key] = hash.split(":");
    return (await scryptKey(password, salt)) === key;
  }
  // Hash au format Lucia (défaut @convex-dev/auth) créé avant la bascule.
  return await new LuciaScrypt().verify(hash, password);
}
