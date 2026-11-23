// Réservation d'une place dans le funnel d'inscription Black Friday (site
// invitation, base Convex d'Erwan) quand un setter donne un créneau bureau :
// même table de places que les prospects, pour ne jamais dépasser la capacité.
// Env Velora : FUNNEL_SITE_URL (https://<déploiement>.convex.site) + FUNNEL_SECRET.

export type FunnelReservation =
  | { ok: true; billet?: string }
  | { ok: false; erreur: "complet" | "creneau" | "telephone" | string }
  | { ok: "off" }; // funnel non configuré ou injoignable : on n'empêche pas le RDV

export function funnelConfigured(): boolean {
  return Boolean(process.env.FUNNEL_SITE_URL && process.env.FUNNEL_SECRET);
}

export async function reserveFunnelPlace(args: {
  leadId: string; telephone?: string | null; jour: string; heure: number; nom?: string;
}): Promise<FunnelReservation> {
  const base = process.env.FUNNEL_SITE_URL;
  const secret = process.env.FUNNEL_SECRET;
  if (!base || !secret) return { ok: "off" };
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/velora/reserver`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ cle: args.leadId, telephone: args.telephone ?? undefined, jour: args.jour, heure: args.heure, nom: args.nom }),
    });
    if (!res.ok) {
      console.warn(`[funnel] réservation HTTP ${res.status}`);
      return { ok: "off" };
    }
    return (await res.json()) as FunnelReservation;
  } catch (e) {
    console.warn("[funnel] injoignable", e);
    return { ok: "off" };
  }
}

export function funnelErrorMessage(erreur: string): string {
  return erreur === "complet"
    ? "Ce créneau est complet sur le site d'inscription (plus aucune place). Choisis une autre heure."
    : erreur === "creneau"
      ? "Ce créneau n'existe pas sur le site d'inscription. Choisis une autre heure."
      : `Le site d'inscription a refusé la place (${erreur}).`;
}
