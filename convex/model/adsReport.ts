/**
 * Rapport ROAS publicitaire — partie PURE (portage ads-roas.service.ts NestJS).
 * mergeAdsRows fusionne les agrégats dépense (adSpendDaily) et leads/CA
 * (cohorte) pour un niveau de drill-down ; buildAdsSeries produit la série
 * quotidienne qui alimente les graphiques d'évolution de la page Ads.
 */

export type AdsLevel = "campaign" | "adset" | "ad";

export interface AdsReportRow {
  level: AdsLevel;
  campaignId: string | null;
  campaign: string | null;
  adsetId?: string | null;
  adset?: string | null;
  adId?: string | null;
  ad?: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number;
  rdvs: number;
  devisSignes: number;
  ca: number;
  roas: number;
  tauxSignature: number;
  unmatched: "spend_no_leads" | "leads_no_spend" | null;
}

export type AdsReportTotals = Omit<
  AdsReportRow,
  "level" | "campaignId" | "campaign" | "adsetId" | "adset" | "adId" | "ad" | "unmatched"
>;

export interface AdsSeriesPoint {
  date: string; // YYYY-MM-DD (jour Réunion)
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  devisSignes: number;
  ca: number;
}

export interface AdsReport {
  rows: AdsReportRow[];
  totals: AdsReportTotals;
  series: AdsSeriesPoint[];
}

/** Aggregat brut côté dépense (une ligne par groupe de niveau). */
export interface SpendAggRow {
  campaignId: string | null;
  campaign: string | null;
  adsetId?: string | null;
  adset?: string | null;
  adId?: string | null;
  ad?: string | null;
  spend: number;
  impressions: number;
  clicks: number;
}

/** Aggregat brut côté leads/CA (cohorte). */
export interface LeadAggRow {
  campaignId: string | null;
  campaign: string | null;
  adsetId?: string | null;
  adset?: string | null;
  adId?: string | null;
  ad?: string | null;
  leads: number;
  rdvs: number;
  devisSignes: number;
  ca: number;
}

/** Normalise un nom pour le fallback de match (lowercase / trim). */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function idColumnForLevel(level: AdsLevel): "campaignId" | "adsetId" | "adId" {
  if (level === "adset") return "adsetId";
  if (level === "ad") return "adId";
  return "campaignId";
}

function nameColumnForLevel(level: AdsLevel): "campaign" | "adset" | "ad" {
  if (level === "adset") return "adset";
  if (level === "ad") return "ad";
  return "campaign";
}

/**
 * Fusionne PUREMENT les agrégats dépense et leads/CA pour un niveau donné.
 * Clé de match : la colonne id du niveau (campaignId / adsetId / adId) quand
 * elle est présente des DEUX côtés ; sinon fallback sur normalizeName(nom).
 * Une campagne renommée côté Meta est ainsi absorbée par le match par id.
 */
export function mergeAdsRows(
  spendRows: SpendAggRow[],
  leadRows: LeadAggRow[],
  level: AdsLevel,
): { rows: AdsReportRow[]; totals: AdsReportTotals } {
  const idCol = idColumnForLevel(level);
  const nameCol = nameColumnForLevel(level);

  const spendIds = new Set(
    spendRows.map((r) => r[idCol]).filter((v): v is string => !!v && v.trim() !== ""),
  );
  const leadIds = new Set(
    leadRows.map((r) => r[idCol]).filter((v): v is string => !!v && v.trim() !== ""),
  );

  const keyFor = (row: SpendAggRow | LeadAggRow): string => {
    const id = row[idCol];
    if (id && id.trim() !== "" && spendIds.has(id) && leadIds.has(id)) return `id:${id}`;
    return `name:${normalizeName(row[nameCol])}`;
  };

  const merged = new Map<string, { spend?: SpendAggRow; lead?: LeadAggRow }>();
  for (const s of spendRows) {
    const k = keyFor(s);
    merged.set(k, { ...merged.get(k), spend: s });
  }
  for (const l of leadRows) {
    const k = keyFor(l);
    merged.set(k, { ...merged.get(k), lead: l });
  }

  const rows: AdsReportRow[] = [];
  for (const { spend: s, lead: l } of merged.values()) {
    const spend = s?.spend ?? 0;
    const leadsCount = l?.leads ?? 0;
    const rdvs = l?.rdvs ?? 0;
    const devisSignes = l?.devisSignes ?? 0;
    const ca = l?.ca ?? 0;

    let unmatched: AdsReportRow["unmatched"] = null;
    if (spend > 0 && leadsCount === 0) unmatched = "spend_no_leads";
    else if (leadsCount > 0 && spend === 0) unmatched = "leads_no_spend";

    const row: AdsReportRow = {
      level,
      campaignId: s?.campaignId ?? l?.campaignId ?? null,
      campaign: s?.campaign ?? l?.campaign ?? null,
      spend,
      impressions: s?.impressions ?? 0,
      clicks: s?.clicks ?? 0,
      leads: leadsCount,
      cpl: leadsCount > 0 ? spend / leadsCount : 0,
      rdvs,
      devisSignes,
      ca,
      roas: spend > 0 ? ca / spend : 0,
      tauxSignature: leadsCount > 0 ? devisSignes / leadsCount : 0,
      unmatched,
    };
    if (level === "adset" || level === "ad") {
      row.adsetId = s?.adsetId ?? l?.adsetId ?? null;
      row.adset = s?.adset ?? l?.adset ?? null;
    }
    if (level === "ad") {
      row.adId = s?.adId ?? l?.adId ?? null;
      row.ad = s?.ad ?? l?.ad ?? null;
    }
    rows.push(row);
  }

  const totals: AdsReportTotals = rows.reduce<AdsReportTotals>(
    (acc, r) => {
      acc.spend += r.spend;
      acc.impressions += r.impressions;
      acc.clicks += r.clicks;
      acc.leads += r.leads;
      acc.rdvs += r.rdvs;
      acc.devisSignes += r.devisSignes;
      acc.ca += r.ca;
      return acc;
    },
    { spend: 0, impressions: 0, clicks: 0, leads: 0, cpl: 0, rdvs: 0, devisSignes: 0, ca: 0, roas: 0, tauxSignature: 0 },
  );
  totals.cpl = totals.leads > 0 ? totals.spend / totals.leads : 0;
  totals.roas = totals.spend > 0 ? totals.ca / totals.spend : 0;
  totals.tauxSignature = totals.leads > 0 ? totals.devisSignes / totals.leads : 0;

  return { rows, totals };
}

/** Entrée dépense pour la série : une ligne adSpendDaily datée. */
export interface DailySpendInput {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
}

/** Entrée lead pour la série : jour d'arrivée + CA signé rattaché (cohorte). */
export interface DailyLeadInput {
  day: string; // YYYY-MM-DD
  devisSignes: number;
  ca: number;
}

/**
 * Série quotidienne dépense × prospects × CA sur les jours fournis (bornes
 * incluses, jours sans données à zéro — les graphes ont besoin d'un axe continu).
 */
export function buildAdsSeries(
  days: string[],
  spendRows: DailySpendInput[],
  leadRows: DailyLeadInput[],
): AdsSeriesPoint[] {
  const byDay = new Map<string, AdsSeriesPoint>(
    days.map((d) => [d, { date: d, spend: 0, impressions: 0, clicks: 0, leads: 0, devisSignes: 0, ca: 0 }]),
  );
  for (const r of spendRows) {
    const p = byDay.get(r.date);
    if (!p) continue;
    p.spend += r.spend;
    p.impressions += r.impressions;
    p.clicks += r.clicks;
  }
  for (const l of leadRows) {
    const p = byDay.get(l.day);
    if (!p) continue;
    p.leads += 1;
    p.devisSignes += l.devisSignes;
    p.ca += l.ca;
  }
  return days.map((d) => byDay.get(d)!);
}
