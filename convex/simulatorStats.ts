/**
 * Tunnel du simulateur solaire (simulateur.electroconceptoi.com — app Lovable).
 * Le simulateur trace déjà ses events first-party dans Supabase
 * (`analytics_events` : page_view / step_change / cta_click / form_submit,
 * avec session_id et step_number). Ce module agrège ces events par jour
 * Réunion dans `simulatorDaily` (cohorte par jour d'arrivée de la session,
 * comme la cohorte leads du rapport ads) pour afficher dans la page Publicité
 * le tunnel clics → sessions → étapes → formulaire → prospects.
 *
 * Lecture Supabase via SIMULATOR_SUPABASE_SERVICE_KEY (la clé anon du SPA est
 * bloquée par RLS en lecture). Sans clé, la sync sort proprement en skipped.
 */

import { action, internalAction, internalMutation, query, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireRole } from "./model/access";
import { buildRange, reunionDayKey } from "./model/analyticsRange";

const DEFAULT_SUPABASE_URL = "https://kzlpwqtnwnsewgikkbdc.supabase.co";
const ADS_ROLES = ["admin", "commercial_lead"] as const;

function supabaseCreds(): { url: string; key: string } | null {
  const key = process.env.SIMULATOR_SUPABASE_SERVICE_KEY;
  if (!key) return null;
  return { url: process.env.SIMULATOR_SUPABASE_URL ?? DEFAULT_SUPABASE_URL, key };
}

interface RawEvent {
  session_id: string;
  event_type: string;
  step_number: number | null;
  created_at: string;
}

async function fetchEvents(fromMs: number, toMs: number): Promise<RawEvent[]> {
  const creds = supabaseCreds()!;
  const events: RawEvent[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const url =
      `${creds.url}/rest/v1/analytics_events` +
      `?select=session_id,event_type,step_number,created_at` +
      `&created_at=gte.${new Date(fromMs).toISOString()}` +
      `&created_at=lt.${new Date(toMs).toISOString()}` +
      `&order=created_at.asc&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { apikey: creds.key, Authorization: `Bearer ${creds.key}` },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    const page = (await res.json()) as RawEvent[];
    events.push(...page);
    if (page.length < pageSize) break;
  }
  return events;
}

interface DayAgg {
  date: string;
  sessions: number;
  stepSessions: number[];
  formSubmits: number;
  ctaClicks: number;
  events: number;
}

/** Cohorte par session : chaque session est rattachée au jour de son 1er event. */
function aggregateByDay(events: RawEvent[]): DayAgg[] {
  interface SessionAgg {
    firstMs: number;
    maxStep: number;
    submitted: boolean;
    ctaClicks: number;
    events: number;
  }
  const sessions = new Map<string, SessionAgg>();
  for (const e of events) {
    const ms = Date.parse(e.created_at);
    if (Number.isNaN(ms) || !e.session_id) continue;
    let s = sessions.get(e.session_id);
    if (!s) {
      s = { firstMs: ms, maxStep: 0, submitted: false, ctaClicks: 0, events: 0 };
      sessions.set(e.session_id, s);
    }
    s.firstMs = Math.min(s.firstMs, ms);
    s.events += 1;
    if (e.event_type === "step_change" && typeof e.step_number === "number") {
      s.maxStep = Math.max(s.maxStep, e.step_number);
    }
    if (e.event_type === "form_submit") s.submitted = true;
    if (e.event_type === "cta_click") s.ctaClicks += 1;
  }

  const days = new Map<string, DayAgg>();
  for (const s of sessions.values()) {
    const date = reunionDayKey(s.firstMs);
    let d = days.get(date);
    if (!d) {
      d = { date, sessions: 0, stepSessions: [], formSubmits: 0, ctaClicks: 0, events: 0 };
      days.set(date, d);
    }
    d.sessions += 1;
    d.events += s.events;
    d.ctaClicks += s.ctaClicks;
    if (s.submitted) d.formSubmits += 1;
    for (let i = 0; i < s.maxStep; i++) {
      d.stepSessions[i] = (d.stepSessions[i] ?? 0) + 1;
    }
  }
  for (const d of days.values()) {
    for (let i = 0; i < d.stepSessions.length; i++) d.stepSessions[i] = d.stepSessions[i] ?? 0;
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

const dayValidator = v.object({
  date: v.string(),
  sessions: v.number(),
  stepSessions: v.array(v.number()),
  formSubmits: v.number(),
  ctaClicks: v.number(),
  events: v.number(),
});

export const upsertDays = internalMutation({
  args: { days: v.array(dayValidator), now: v.number() },
  handler: async (ctx, args) => {
    for (const day of args.days) {
      const existing = await ctx.db
        .query("simulatorDaily")
        .withIndex("by_date", (q) => q.eq("date", day.date))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { ...day, updatedAt: args.now });
      } else {
        await ctx.db.insert("simulatorDaily", { ...day, updatedAt: args.now });
      }
    }
    return null;
  },
});

async function runSync(
  ctx: ActionCtx,
  fromMs: number,
  toMs: number,
): Promise<{ days: number; sessions: number; skipped: boolean }> {
  if (!supabaseCreds()) {
    console.warn("SIMULATOR_SUPABASE_SERVICE_KEY absente — sync simulateur sautée");
    return { days: 0, sessions: 0, skipped: true };
  }
  const events = await fetchEvents(fromMs, toMs);
  const days = aggregateByDay(events);
  for (let i = 0; i < days.length; i += 60) {
    await ctx.runMutation(internal.simulatorStats.upsertDays, {
      days: days.slice(i, i + 60),
      now: Date.now(),
    });
  }
  return { days: days.length, sessions: days.reduce((s, d) => s + d.sessions, 0), skipped: false };
}

/** Resync / backfill manuel (admin). Bornes ISO du DateRangePicker. */
export const sync = action({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adSpend.assertAdmin, {});
    const fromMs = Date.parse(args.from);
    const toMs = Date.parse(args.to) + 86_400_000; // borne haute inclusive
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) throw new Error("Dates invalides");
    return await runSync(ctx, fromMs, toMs);
  },
});

/** Cron quotidien : fenêtre glissante 3 jours (les sessions du jour bougent). */
export const syncScheduled = internalAction({
  args: {},
  handler: async (ctx) => {
    const to = Date.now();
    const r = await runSync(ctx, to - 3 * 86_400_000, to);
    console.log(`Sync simulateur : ${r.days} jours, ${r.sessions} sessions (skipped=${r.skipped})`);
    return null;
  },
});

/** Agrégat du tunnel pour la page Publicité (mêmes rôles que ads:report). */
export const funnel = query({
  args: {
    from: v.string(),
    to: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...ADS_ROLES]);
    const range = buildRange(args.from, args.to, 30, args.now ?? Date.parse(args.to));
    const fromDay = reunionDayKey(range.fromMs);
    const toDay = reunionDayKey(range.toMs);
    const docs = await ctx.db
      .query("simulatorDaily")
      .withIndex("by_date", (q) => q.gte("date", fromDay).lte("date", toDay))
      .collect();

    const totals = { sessions: 0, formSubmits: 0, ctaClicks: 0 };
    const stepSessions: number[] = [];
    for (const d of docs) {
      totals.sessions += d.sessions;
      totals.formSubmits += d.formSubmits;
      totals.ctaClicks += d.ctaClicks;
      d.stepSessions.forEach((n, i) => {
        stepSessions[i] = (stepSessions[i] ?? 0) + n;
      });
    }
    return {
      ...totals,
      stepSessions,
      hasData: docs.length > 0,
      series: docs
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((d) => ({ day: d.date, sessions: d.sessions, formSubmits: d.formSubmits })),
    };
  },
});
