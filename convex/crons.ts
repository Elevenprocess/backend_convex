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

// Retour aux setters : les commerciaux déplacent des leads dans l'étape GHL
// « (BIS) Retour aux Setters 🔙 » ; le webhook opportunité GHL n'étant pas
// branché en pratique, on interroge GHL et on n'applique que les entrées
// récentes (fenêtre glissante, dédupliquées). No-op tant que
// GHL_SYNC_ENABLED !== "true".
crons.interval("ghl-retour-setters-sync", { minutes: 15 }, internal.ghlRetourSetters.syncScheduled, {});

// Synchro équipe GHL → comptes Velora (mapGhlCommercials, additif — la purge
// des partants reste manuelle) — 05:30 à La Réunion. No-op tant que
// GHL_SYNC_ENABLED !== "true".
crons.daily("ghl-staff-sync", { hourUTC: 1, minuteUTC: 30 }, internal.ghlCalendar.syncStaffScheduled, {});

// Relances d'acomptes dus (à encaisser / en retard) — 09:00 à La Réunion.
crons.daily("acompte-reminders", { hourUTC: 5, minuteUTC: 0 }, internal.acompteReminders.run, {});

// Dépense publicitaire Meta (API Graph directe, fallback Composio/Windsor) —
// 03:00 à La Réunion, fenêtre glissante 7 j. No-op propre sans aucune clé.
crons.daily("ad-spend-sync", { hourUTC: 23, minuteUTC: 0 }, internal.adSpend.syncScheduled, {});

// Tunnel simulateur : agrégats Supabase → simulatorDaily. Toutes les 30 min
// (fenêtre glissante 3 j) pour que le jour en cours reste juste sur la page
// Ads — en quotidien, « Aujourd'hui » affichait un tunnel quasi vide.
crons.interval("simulator-stats-sync", { minutes: 30 }, internal.simulatorStats.syncScheduled, {});

// Filet de sécurité des débriefs WhatsApp : relaie à l'agent Hermes les
// débriefs des dernières 24 h que le flux événementiel n'a pas envoyés
// (2 max par passage, espacés — jamais de rafale WhatsApp).
crons.interval("hermes-debrief-catchup", { minutes: 30 }, internal.hermesDebrief.relayOverdue, {});

export default crons;
