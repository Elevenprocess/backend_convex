/**
 * ELE-179 — Client HTTP Soltéo (LECTURE SEULE). Auth X-API-KEY, base
 * https://app.solteo.fr/external-api. Aucune méthode d'écriture ici :
 * l'écriture des externalId (ELE-172) fera l'objet d'une tâche distincte.
 */
export function isSolteoConfigured(): boolean {
  return Boolean(process.env.SOLTEO_API_KEY);
}

export async function solteoGet(
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<unknown> {
  const key = process.env.SOLTEO_API_KEY;
  if (!key) throw new Error("SOLTEO_API_KEY manquant dans l'environnement Convex.");
  const base = process.env.SOLTEO_API_BASE_URL || "https://app.solteo.fr/external-api";
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, val] of Object.entries(query)) if (val !== undefined) url.searchParams.set(k, String(val));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "X-API-KEY": key, accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`Soltéo GET ${path} → HTTP ${res.status}`);
        if (res.status >= 500 && attempt < 2) { lastErr = err; continue; }
        throw err;
      }
      return text ? JSON.parse(text) : null;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) continue;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
