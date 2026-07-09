/**
 * Import ponctuel du suivi délivrabilité depuis la feuille Google Sheets
 * (suivi DP / raccordement / Consuel / mise en service tenu par le back-office).
 *
 * Usage (CLI, clé admin) :
 *   npx convex run deliverySheetImport:apply '{"rows":[...], "dryRun":true}'
 *
 * Matching : nom de la ligne (ex. "PAYET Bernard (16 panneaux)") → lead du
 * dossier (firstName/lastName), par inclusion de jetons normalisés (accents/
 * casse ignorés, parenthèses et civilités retirées). Ambiguïtés départagées
 * par le nombre de panneaux "(N panneaux)" ↔ clients.panneauQty quand
 * disponible ; sinon la ligne est rapportée, jamais devinée.
 *
 * Écriture : UPGRADE UNIQUEMENT — un substep passe à "fait" (avec date de la
 * feuille) seulement depuis a_faire/planifie/en_cours/en_attente ; un statut
 * fait/probleme/annule existant n'est jamais rétrogradé ni écrasé (les
 * problèmes sont rapportés). Les notes (retours clients, docs manquants,
 * Solteo, motif DP non validée) ne sont posées que si le champ est vide.
 * recomputePhase + recomputeClientStatus après chaque dossier modifié ;
 * aucune notification (import de masse).
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import {
  ensureDossier,
  recomputePhase,
  recomputeClientStatus,
} from "./model/ensureDossier";
import { ensureProjectForLead } from "./model/ensureProject";
import { WorkflowSubstepKey } from "./model/enums";

const rowValidator = v.object({
  name: v.string(),
  installe: v.optional(v.string()),
  ville: v.optional(v.string()),
  tel: v.optional(v.string()),
  dpStatut: v.optional(v.string()),
  dpDate: v.optional(v.union(v.string(), v.null())),
  dpValide: v.optional(v.string()),
  raccoStatut: v.optional(v.string()),
  raccoDate: v.optional(v.union(v.string(), v.null())),
  consuelStatut: v.optional(v.string()),
  consuelDate: v.optional(v.union(v.string(), v.null())),
  consuelRecu: v.optional(v.string()),
  etatDossier: v.optional(v.string()),
  solteo: v.optional(v.string()),
  retourClients: v.optional(v.string()),
  docsManquants: v.optional(v.string()),
});
type SheetRow = typeof rowValidator.type;

// ─── Normalisation nom → jetons ───────────────────────────────────────────────

const STOPWORDS = new Set([
  "M", "MR", "MME", "MLLE", "ET", "OU", "DE", "DU", "DES", "LA", "LE", "LES",
  "SCI", "IMMO", "EDF", "DEYE",
]);

function nameTokens(raw: string): string[] {
  const cleaned = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ") // "(16 panneaux)", "(2)", "(devis?)"…
    .replace(/[^A-Z]+/g, " ")
    .trim();
  return cleaned
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function panneauxFromName(raw: string): number | null {
  const m = raw.match(/\((\d+)\s*(?:panneaux|pv)\)/i);
  return m ? Number(m[1]) : null;
}

// ─── Interprétation des colonnes ──────────────────────────────────────────────

function fold(s: string | undefined | null): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const isDepose = (s?: string) => fold(s).startsWith("depose");
const isDpValidee = (s?: string) => {
  const t = fold(s);
  if (!/valid/.test(t)) return false;
  return !/refus|refaire|corriger|en cours|revoir|voir avec|pas de permis|non accord|a faire/.test(t);
};

// ─── Mutation principale ──────────────────────────────────────────────────────

export const apply = internalMutation({
  args: {
    rows: v.array(rowValidator),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun === true;

    // ── 1. Index des dossiers par lead ────────────────────────────────────────
    const clients = (await ctx.db.query("clients").collect()).filter(
      (c) => c.deletedAt === undefined,
    );
    const candidates: Array<{
      client: Doc<"clients">;
      tokens: string[];
      display: string;
    }> = [];
    for (const client of clients) {
      const lead = await ctx.db.get(client.leadId);
      if (!lead) continue;
      const display = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
      const tokens = nameTokens(display);
      if (tokens.length === 0) continue;
      candidates.push({ client, tokens, display });
    }

    // ── 2. Matching ligne → dossier ──────────────────────────────────────────
    const report = {
      rows: args.rows.length,
      matched: 0,
      updatedSubsteps: 0,
      datesFilled: 0,
      notesSet: 0,
      clientsTouched: 0,
      unmatched: [] as string[],
      ambiguous: [] as string[],
      duplicates: [] as string[],
      annule: [] as string[],
      conflicts: [] as string[], // substep en probleme/annule alors que la feuille dit fait
      missingSubsteps: [] as string[],
    };
    const usedClients = new Set<string>();

    for (const row of args.rows) {
      if (fold(row.installe) === "annuler") {
        report.annule.push(row.name);
        continue;
      }
      const rowTokens = nameTokens(row.name);
      if (rowTokens.length === 0) {
        report.unmatched.push(row.name);
        continue;
      }
      const rowSet = new Set(rowTokens);

      // Un candidat matche si tous ses jetons lead sont dans la ligne, ou
      // l'inverse (la feuille ajoute souvent prénoms/mentions en plus).
      let matches = candidates.filter(({ tokens }) => {
        const leadSet = new Set(tokens);
        const leadInRow = tokens.every((t) => rowSet.has(t));
        const rowInLead = rowTokens.every((t) => leadSet.has(t));
        return leadInRow || rowInLead;
      });

      // Départage multi-dossiers d'un même lead par "(N panneaux)".
      if (matches.length > 1) {
        const nb = panneauxFromName(row.name);
        if (nb !== null) {
          const byQty = matches.filter((m) => m.client.panneauQty === nb);
          if (byQty.length === 1) matches = byQty;
        }
      }
      // Départage : nom COMPLET identique (parenthèses comprises — cas des
      // multi-sites « PICARD … (tampon 409 chemin du petit) »).
      if (matches.length > 1) {
        const rowFull = fold(row.name).replace(/\s+/g, " ");
        const exactFull = matches.filter(
          (m) => fold(m.display).replace(/\s+/g, " ") === rowFull,
        );
        if (exactFull.length === 1) matches = exactFull;
      }
      // Départage : préférer le match exact (mêmes jetons des deux côtés).
      if (matches.length > 1) {
        const exact = matches.filter(
          ({ tokens }) =>
            tokens.length === rowTokens.length && tokens.every((t) => rowSet.has(t)),
        );
        if (exact.length === 1) matches = exact;
      }

      if (matches.length === 0) {
        report.unmatched.push(row.name);
        continue;
      }
      if (matches.length > 1) {
        report.ambiguous.push(
          `${row.name} → ${matches.map((m) => m.display).join(" / ")}`,
        );
        continue;
      }

      const { client, display } = matches[0];
      if (usedClients.has(client._id)) {
        report.duplicates.push(`${row.name} (dossier déjà mis à jour par une autre ligne : ${display})`);
        continue;
      }
      usedClients.add(client._id);
      report.matched++;

      // ── 3. Plan de mise à jour de la ligne ─────────────────────────────────
      // complete=true → viser le statut "fait" ; complete=false → note seule.
      const wanted: Array<{
        key: WorkflowSubstepKey;
        complete: boolean;
        date?: string | null;
        note?: string;
      }> = [];
      if (isDepose(row.dpStatut)) {
        wanted.push({ key: "dp_envoyee_mairie", complete: true, date: row.dpDate });
      }
      if (isDpValidee(row.dpValide)) {
        wanted.push({ key: "dp_validee", complete: true });
      } else if ((row.dpValide ?? "").trim()) {
        // DP non validée avec un motif → note sur le substep, statut inchangé.
        wanted.push({ key: "dp_validee", complete: false, note: `DP mairie : ${row.dpValide!.trim()}` });
      }
      if (isDepose(row.raccoStatut)) {
        wanted.push({ key: "racco_envoye", complete: true, date: row.raccoDate });
      }
      if (isDepose(row.consuelStatut)) {
        wanted.push({ key: "consuel_a_faire", complete: true, date: row.consuelDate });
      }
      if (fold(row.consuelRecu) === "recu") wanted.push({ key: "consuel_valide", complete: true });
      if (fold(row.installe) === "installe") {
        wanted.push(
          { key: "install_a_faire", complete: true },
          { key: "install_effectuee", complete: true },
        );
      }
      const mesFait = fold(row.etatDossier) === "mise en service realiser";
      const mesNoteParts = [
        (row.solteo ?? "").trim() && `Solteo : ${row.solteo!.trim()}`,
        (row.retourClients ?? "").trim() && `Retour client : ${row.retourClients!.trim()}`,
        (row.docsManquants ?? "").trim() && `Documents manquants : ${row.docsManquants!.trim()}`,
      ].filter(Boolean) as string[];
      if (mesFait || mesNoteParts.length > 0) {
        wanted.push({
          key: "enquete_satisfaction",
          complete: mesFait,
          note: mesNoteParts.join(" | ") || undefined,
        });
      }

      // ── 4. Application ─────────────────────────────────────────────────────
      const touchedSteps = new Set<Id<"workflowSteps">>();
      let clientTouched = false;
      for (const item of wanted) {
        const substep = await ctx.db
          .query("workflowSubsteps")
          .withIndex("by_client_key", (q) =>
            q.eq("clientId", client._id).eq("key", item.key),
          )
          .first();
        if (!substep) {
          report.missingSubsteps.push(`${row.name} : ${item.key}`);
          continue;
        }

        const patch: Record<string, unknown> = {};

        if (item.complete) {
          if (["a_faire", "planifie", "en_cours", "en_attente"].includes(substep.status)) {
            patch.status = "fait";
            if (item.date && !substep.dateRealisee) patch.dateRealisee = item.date;
          } else if (substep.status === "fait") {
            if (item.date && !substep.dateRealisee) {
              patch.dateRealisee = item.date;
              report.datesFilled++;
            }
          } else {
            // probleme / annule : jamais écrasé, mais signalé.
            report.conflicts.push(`${row.name} : ${item.key} est "${substep.status}" (feuille : fait)`);
          }
        }
        if (item.note && !substep.notes) {
          patch.notes = item.note;
          report.notesSet++;
        }

        if (Object.keys(patch).length === 0) continue;
        if (patch.status === "fait") report.updatedSubsteps++;
        if (!dryRun) {
          await ctx.db.patch(substep._id, patch);
          touchedSteps.add(substep.stepId);
        }
        clientTouched = true;
      }

      if (!dryRun && touchedSteps.size > 0) {
        for (const stepId of touchedSteps) await recomputePhase(ctx, stepId);
        await recomputeClientStatus(ctx, client._id);
      }
      if (clientTouched) report.clientsTouched++;
    }

    return { dryRun, ...report };
  },
});

// ─── ensureDossiers — crée les dossiers manquants pour les lignes de la feuille ─
// Pour chaque ligne sans dossier délivrabilité :
//  1. lead existant matché strictement (jetons uniques) → ensureDossier(lead)
//  2. aucun lead et createLeads=true → création d'un lead minimal (nom complet
//     de la feuille, ville/adresse/téléphone, source "manual", statut "signe")
//     puis ensureDossier.
// Idempotent (ensureDossier l'est ; deux lignes → même lead : la 2e est
// rapportée, un seul dossier sans projet par lead). Relancer apply ensuite
// pour poser statuts/dates/notes sur les nouveaux dossiers.
export const ensureDossiers = internalMutation({
  args: {
    rows: v.array(rowValidator),
    createLeads: v.optional(v.boolean()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun === true;

    // Leads existants (jetons) + leads ayant déjà un dossier actif.
    const allLeads = (await ctx.db.query("leads").collect()).filter(
      (l) => l.deletedAt === undefined,
    );
    const leadTokens = allLeads
      .map((l) => ({
        lead: l,
        display: [l.firstName, l.lastName].filter(Boolean).join(" "),
        tokens: nameTokens([l.firstName, l.lastName].filter(Boolean).join(" ")),
      }))
      .filter((e) => e.tokens.length > 0);
    const withDossier = new Set<string>();
    for (const c of await ctx.db.query("clients").collect()) {
      if (c.deletedAt === undefined) withDossier.add(c.leadId);
    }

    const report = {
      dryRun,
      rows: args.rows.length,
      alreadyHasDossier: 0,
      dossiersCreated: [] as string[],
      leadsCreated: [] as string[],
      ambiguousLead: [] as string[],
      noLead: [] as string[],
      sameLeadDuplicate: [] as string[],
      annule: [] as string[],
    };
    const usedLeads = new Set<string>();

    for (const row of args.rows) {
      if (fold(row.installe) === "annuler") {
        report.annule.push(row.name);
        continue;
      }
      const rowTokens = nameTokens(row.name);
      if (rowTokens.length === 0) continue;
      const rowSet = new Set(rowTokens);

      let matches = leadTokens.filter(({ tokens }) => {
        const leadSet = new Set(tokens);
        return tokens.every((t) => rowSet.has(t)) || rowTokens.every((t) => leadSet.has(t));
      });

      if (matches.length > 1) {
        // 1. La table leads contient beaucoup de doublons (même personne,
        //    plusieurs leads). Si l'un des candidats a déjà un dossier, le
        //    dossier de cette personne existe → rien à créer.
        if (matches.some((m) => withDossier.has(m.lead._id))) {
          report.alreadyHasDossier++;
          continue;
        }
        // 2. Préférer le match le plus SPÉCIFIQUE (plus de jetons communs
        //    avec la ligne) : « GRONDIN Marie Nadeige » bat « Marie Grondin ».
        const overlap = (m: (typeof matches)[number]) =>
          m.tokens.filter((t) => rowSet.has(t)).length;
        const maxOverlap = Math.max(...matches.map(overlap));
        matches = matches.filter((m) => overlap(m) === maxOverlap);
        // 3. Dédupe des doublons purs (mêmes jetons) : garder le « meilleur »
        //    lead — signé > téléphone renseigné > le plus récent.
        const setKey = (m: (typeof matches)[number]) => [...new Set(m.tokens)].sort().join("|");
        const groups = new Map<string, typeof matches>();
        for (const m of matches) {
          const k = setKey(m);
          groups.set(k, [...(groups.get(k) ?? []), m]);
        }
        const score = (m: (typeof matches)[number]) =>
          (m.lead.status === "signe" ? 4 : 0) +
          (m.lead.phone ? 2 : 0) +
          m.lead._creationTime / 1e15;
        matches = [...groups.values()].map(
          (g) => g.sort((a, b) => score(b) - score(a))[0],
        );
        // 4. Groupes distincts restants (ex. couple « DIDIER ou MARYLOU ») :
        //    préférer le nom en TÊTE de ligne (indice moyen des jetons le plus bas).
        if (matches.length > 1) {
          const avgIdx = (m: (typeof matches)[number]) => {
            const idxs = m.tokens.map((t) => rowTokens.indexOf(t)).filter((i) => i >= 0);
            return idxs.length ? idxs.reduce((a, b) => a + b, 0) / idxs.length : 99;
          };
          matches.sort((a, b) => avgIdx(a) - avgIdx(b));
          if (avgIdx(matches[0]) < avgIdx(matches[1])) matches = [matches[0]];
        }
      }

      if (matches.length > 1) {
        report.ambiguousLead.push(`${row.name} → ${matches.map((m) => m.display).join(" / ")}`);
        continue;
      }

      let leadId: Id<"leads"> | null = null;
      if (matches.length === 1) {
        // Sécurité création : exiger ≥ 2 jetons communs pour matcher un lead.
        if (matches[0].tokens.length < 2 && rowTokens.length >= 2) {
          report.ambiguousLead.push(`${row.name} → match trop faible : ${matches[0].display}`);
          continue;
        }
        leadId = matches[0].lead._id;
        if (withDossier.has(leadId)) {
          report.alreadyHasDossier++;
          continue;
        }
      } else if (args.createLeads === true) {
        // Garder les parenthèses : elles distinguent les multi-sites
        // (« PICARD JEAN DANIEL et SYLVIE (tampon 409 chemin du petit) »).
        const cleanName = row.name.replace(/\s+/g, " ").trim();
        if (!dryRun) {
          // Date métier = dépôt DP de la feuille (client historique), sinon now.
          const createdAt = row.dpDate ? Date.parse(`${row.dpDate}T00:00:00Z`) : Date.now();
          leadId = await ctx.db.insert("leads", {
            source: "manual",
            status: "signe",
            lastName: cleanName,
            createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
            ...(row.tel?.trim() ? { phone: row.tel.trim() } : {}),
            ...(row.ville?.trim() ? { city: row.ville.trim() } : {}),
          });
        }
        report.leadsCreated.push(cleanName);
      } else {
        report.noLead.push(row.name);
        continue;
      }

      if (leadId !== null && usedLeads.has(leadId)) {
        report.sameLeadDuplicate.push(row.name);
        continue;
      }
      if (leadId !== null) usedLeads.add(leadId);

      if (!dryRun && leadId !== null) {
        await ensureDossier(ctx, { leadId });
      }
      report.dossiersCreated.push(row.name);
    }
    return report;
  },
});

// ─── linkProjects — répare les dossiers créés sans projet ─────────────────────
// La fiche client navigue vers le workflow via le PROJET : un dossier
// délivrabilité sans projectId y est invisible (« Aucun projet »). Pour chaque
// dossier actif sans projet : crée/réutilise le projet du lead
// (ensureProjectForLead, statut signé, commercial = assignedToId du lead sinon
// fallback fourni) puis lie client.projectId. Idempotent.
export const linkProjects = internalMutation({
  args: {
    fallbackCommercialId: v.id("users"),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun === true;
    const clients = (await ctx.db.query("clients").collect()).filter(
      (c) => c.deletedAt === undefined && c.projectId === undefined,
    );
    let linked = 0;
    const skipped: string[] = [];
    for (const client of clients) {
      const lead = await ctx.db.get(client.leadId);
      if (!lead || lead.deletedAt !== undefined) {
        skipped.push(client._id);
        continue;
      }
      if (!dryRun) {
        const commercialId = lead.assignedToId ?? args.fallbackCommercialId;
        const projectId = await ensureProjectForLead(ctx, {
          leadId: client.leadId,
          commercialId,
        });
        await ctx.db.patch(client._id, { projectId });
      }
      linked++;
    }
    return { dryRun, dossiersSansProjet: clients.length, linked, skipped: skipped.length };
  },
});

// ─── Réparations de dates ─────────────────────────────────────────────────────
// 1. Leads sans createdAt (natifs Convex) : createdAt := _creationTime (leur
//    vraie date). Rend l'index by_createdAt total → tri métier fiable.
// 2. Leads "manual" créés par l'import : createdAt := date de dépôt DP de la
//    feuille (clients historiques — sinon ils flottent en tête comme du neuf).
export const backfillLeadDates = internalMutation({
  args: {
    rows: v.optional(v.array(rowValidator)),
  },
  handler: async (ctx, args) => {
    const leads = (await ctx.db.query("leads").collect());
    let fromCreationTime = 0;
    for (const lead of leads) {
      if (lead.createdAt === undefined) {
        await ctx.db.patch(lead._id, { createdAt: lead._creationTime });
        fromCreationTime++;
      }
    }
    let datedFromSheet = 0;
    if (args.rows) {
      const byName = new Map<string, number>();
      for (const row of args.rows) {
        if (!row.dpDate) continue;
        const ms = Date.parse(`${row.dpDate}T00:00:00Z`);
        if (!Number.isFinite(ms)) continue;
        byName.set(row.name.replace(/\s+/g, " ").trim(), ms);
      }
      for (const lead of leads) {
        if (lead.source !== "manual" || !lead.lastName) continue;
        const ms = byName.get(lead.lastName.replace(/\s+/g, " ").trim());
        if (ms !== undefined && lead.createdAt !== ms) {
          await ctx.db.patch(lead._id, { createdAt: ms });
          datedFromSheet++;
        }
      }
    }
    return { fromCreationTime, datedFromSheet };
  },
});
