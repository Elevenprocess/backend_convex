/**
 * Garde secret des webhooks GHL. Fail-closed : secret serveur absent → refus
 * (parité assertSecret NestJS). Utilisé par les deux http actions.
 */
export function checkWebhookSecret(req: Request): { ok: boolean; error?: string } {
  const expected =
    process.env.ELEVENPROCESS_WEBHOOK_SECRET ?? process.env.GHL_WEBHOOK_SECRET;
  if (!expected) {
    return { ok: false, error: "ELEVENPROCESS_WEBHOOK_SECRET non configuré côté serveur" };
  }
  const url = new URL(req.url);
  const received =
    req.headers.get("x-elevenprocess-webhook-secret") ??
    url.searchParams.get("x-elevenprocess-webhook-secret");
  if (!received || received !== expected) {
    return { ok: false, error: "Signature webhook GHL invalide" };
  }
  return { ok: true };
}

export function importsDisabled(): boolean {
  return process.env.IMPORTS_DISABLED === "true";
}

export function clientIp(req: Request): string | undefined {
  const fwd = req.headers.get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}
