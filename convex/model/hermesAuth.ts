/**
 * Garde de la surface agent Hermes : clé de service HERMES_API_KEY (env
 * Convex), fail-closed comme checkWebhookSecret — clé serveur absente → refus.
 * Partagée entre le reporting (hermes.ts) et l'envoi des débriefs
 * (hermesDebrief.ts).
 */
export function requireHermesKey(apiKey: string): void {
  const expected = process.env.HERMES_API_KEY;
  if (!expected) throw new Error("HERMES_API_KEY non configuré côté serveur");
  if (apiKey !== expected) throw new Error("Clé Hermes invalide");
}
