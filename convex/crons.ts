import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Synchro calendrier GHL → Velora. No-op tant que GHL_SYNC_ENABLED !== "true"
// (bascule) — le cron tourne mais sort immédiatement.
crons.interval("ghl-calendar-sync", { minutes: 15 }, internal.ghlCalendar.syncScheduled, {});

// Backfill du lien débrief dans le champ contact GHL. No-op tant que
// GHL_SYNC_ENABLED !== "true" (bascule).
crons.interval(
  "ghl-debrief-link-backfill", { minutes: 2 },
  internal.ghlDebriefLink.syncDebriefLinksScheduled, {},
);

// Relances d'acomptes dus (à encaisser / en retard) — 09:00 à La Réunion.
crons.daily("acompte-reminders", { hourUTC: 5, minuteUTC: 0 }, internal.acompteReminders.run, {});

// Filet de sécurité des débriefs WhatsApp : relaie à l'agent Hermes les
// débriefs des dernières 24 h que le flux événementiel n'a pas envoyés
// (2 max par passage, espacés — jamais de rafale WhatsApp).
crons.interval("hermes-debrief-catchup", { minutes: 30 }, internal.hermesDebrief.relayOverdue, {});

export default crons;
