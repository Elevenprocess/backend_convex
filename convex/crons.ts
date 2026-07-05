import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Synchro calendrier GHL → Velora. No-op tant que GHL_SYNC_ENABLED !== "true"
// (bascule) — le cron tourne mais sort immédiatement.
crons.interval("ghl-calendar-sync", { minutes: 15 }, internal.ghlCalendar.syncScheduled, {});

export default crons;
