// ─── payments — queries + mutations finances tranche 5 ────────────────────────
// Expose l'échéancier finances via getAcompte et listAcomptes.
// Mutation updateFinancing : patch partiel des champs finance d'un débrief vente.
// L'échéancier est dérivé à la lecture (assembleEcheancier) : changer
// financingType/montantTotal/etc. recalcule les tranches au prochain getAcompte.
// S'appuie sur assembleEcheancier (Task 5) pour assembler un débrief.

import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRole, requireUser } from "./model/access";
import {
  financingTypeValidator,
  paymentSubMethodValidator,
  financingOrgValidator,
  acompteStatutValidator,
} from "./model/enums";
import {
  assembleEcheancier,
  AcompteResponse,
  resolveTemplatesFromData,
} from "./model/assembleEcheancier";

// Rôles autorisés pour les queries finances.
const FINANCES_ROLES = [
  "admin",
  "finances",
  "delivrabilite",
  "responsable_technique",
  "back_office",
] as const;

// ─── listAcomptes ─────────────────────────────────────────────────────────────
// Retourne l'échéancier de tous les débriefs vente éligibles :
//   - outcome === "vente"
//   - non supprimés (deletedAt absent)
//   - montantTotal > 0 OU acompteAmount > 0
export const listAcomptes = query({
  args: { today: v.string() },
  handler: async (ctx, args): Promise<AcompteResponse[]> => {
    await requireRole(ctx, [...FINANCES_ROLES]);

    const debriefs = await ctx.db
      .query("debriefs")
      .withIndex("by_outcome", (q) => q.eq("outcome", "vente"))
      .collect();

    const results: AcompteResponse[] = [];
    for (const debrief of debriefs) {
      // Exclure les soft-deleted
      if (debrief.deletedAt !== undefined) continue;

      // Exclure sans montant significatif
      const hasMontant =
        (debrief.montantTotal != null && debrief.montantTotal > 0) ||
        (debrief.acompteAmount != null && debrief.acompteAmount > 0);
      if (!hasMontant) continue;

      const assembled = await assembleEcheancier(ctx, debrief, {
        today: args.today,
      });
      if (assembled !== null) {
        results.push(assembled);
      }
    }
    return results;
  },
});

// ─── getAcompte ───────────────────────────────────────────────────────────────
// Assemble l'échéancier pour UN débrief donné.
// Lève une erreur si le débrief est introuvable ou soft-deleted.
export const getAcompte = query({
  args: {
    debriefId: v.id("debriefs"),
    today: v.string(),
  },
  handler: async (ctx, args): Promise<AcompteResponse | null> => {
    await requireRole(ctx, [...FINANCES_ROLES]);

    const debrief = await ctx.db.get(args.debriefId);
    if (!debrief || debrief.deletedAt !== undefined) {
      throw new Error("Débrief introuvable");
    }

    return await assembleEcheancier(ctx, debrief, { today: args.today });
  },
});

// ─── updateFinancing ──────────────────────────────────────────────────────────
// Patch partiel des champs finance d'un débrief vente.
// L'échéancier étant dérivé à la LECTURE (assembleEcheancier), modifier
// financingType/montantTotal recalcule les tranches au prochain getAcompte —
// aucune réécriture des acompte_echeances n'est nécessaire.
//
// Décision null vs absent : les champs Convex (schema debrief) sont
// v.optional(v.number()/validator), non nullable. On ne supporte donc pas null
// dans ce patch — un champ absent du payload = « ne pas toucher ».
// Cohérent avec la sémantique Convex (pas de null en base pour ces colonnes).
export const updateFinancing = mutation({
  args: {
    debriefId: v.id("debriefs"),
    montantTotal: v.optional(v.number()),
    financingType: v.optional(financingTypeValidator),
    paymentSubMethod: v.optional(paymentSubMethodValidator),
    financingOrg: v.optional(financingOrgValidator),
    acomptePercent: v.optional(v.number()),
    acompteAmount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...FINANCES_ROLES]);

    // Construire le patch sans écraser les champs absents (undefined non inclus).
    const patch: Record<string, unknown> = {};
    if (args.montantTotal !== undefined) patch.montantTotal = args.montantTotal;
    if (args.financingType !== undefined) patch.financingType = args.financingType;
    if (args.paymentSubMethod !== undefined) patch.paymentSubMethod = args.paymentSubMethod;
    if (args.financingOrg !== undefined) patch.financingOrg = args.financingOrg;
    if (args.acomptePercent !== undefined) patch.acomptePercent = args.acomptePercent;
    if (args.acompteAmount !== undefined) patch.acompteAmount = args.acompteAmount;

    if (Object.keys(patch).length === 0) {
      throw new Error("Au moins un champ à mettre à jour est requis");
    }

    const debrief = await ctx.db.get(args.debriefId);
    if (!debrief || debrief.deletedAt !== undefined) {
      throw new Error("Débrief introuvable");
    }

    await ctx.db.patch(args.debriefId, patch as any);
    return null;
  },
});

// ─── setEcheancier ───────────────────────────────────────────────────────────
// Remplace l'intégralité de l'échéancier par un plan PERSONNALISÉ.
// Position dans le tableau = ordre (1-based). customEcheancier → true.
// PRÉSERVATION : si le DTO d'une tranche ne fournit PAS statut/montantReel/
// dateEncaissement, les valeurs encaissées existantes sont conservées.
// Les lignes d'ordre > tranches.length sont supprimées.
export const setEcheancier = mutation({
  args: {
    debriefId: v.id("debriefs"),
    tranches: v.array(
      v.object({
        label: v.optional(v.string()),
        percent: v.optional(v.number()),
        montantPrevu: v.optional(v.number()),
        jalonKey: v.optional(v.string()),
        dateEcheance: v.optional(v.string()),
        statut: v.optional(acompteStatutValidator),
        montantReel: v.optional(v.number()),
        dateEncaissement: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...FINANCES_ROLES]);

    // ── 1. Charger le débrief ──────────────────────────────────────────────
    const debrief = await ctx.db.get(args.debriefId);
    if (!debrief || debrief.deletedAt !== undefined) {
      throw new Error("Débrief introuvable");
    }

    // Validation : 1-20 tranches
    if (args.tranches.length < 1 || args.tranches.length > 20) {
      throw new Error("L'échéancier doit contenir entre 1 et 20 tranches");
    }

    // ── 2. Charger les lignes existantes (pour préservation encaissements) ─
    const existingRows = await ctx.db
      .query("acompteEcheances")
      .withIndex("by_debrief_ordre", (q) => q.eq("debriefId", args.debriefId))
      .collect();

    // ── 3. Upsert chaque tranche (position dans tableau = ordre 1..N) ──────
    for (let i = 0; i < args.tranches.length; i++) {
      const ordre = i + 1;
      const t = args.tranches[i];
      const existing = existingRows.find((r) => r.ordre === ordre);

      // Champs du plan (toujours mis à jour)
      const planPatch: Record<string, unknown> = {};
      if (t.label !== undefined) planPatch.label = t.label;
      else planPatch.label = undefined;
      if (t.percent !== undefined) planPatch.percent = t.percent;
      if (t.montantPrevu !== undefined) planPatch.montantPrevu = t.montantPrevu;
      if (t.jalonKey !== undefined) planPatch.jalonKey = t.jalonKey;
      if (t.dateEcheance !== undefined) planPatch.dateEcheance = t.dateEcheance;

      // Champs d'encaissement : fournis dans le DTO → on écrase ; absents → préserver
      const hasPaidInfo = t.statut !== undefined;

      if (existing) {
        const patch: Record<string, unknown> = { ...planPatch };
        if (hasPaidInfo) {
          patch.statut = t.statut;
          // Effacer ou mettre à jour montantReel / dateEncaissement
          patch.montantReel = t.montantReel;
          patch.dateEncaissement = t.dateEncaissement;
        }
        // Si hasPaidInfo=false, on ne touche pas statut/montantReel/dateEncaissement
        await ctx.db.patch(existing._id, patch as any);
      } else {
        await ctx.db.insert("acompteEcheances", {
          debriefId: args.debriefId,
          leadId: debrief.leadId,
          ordre,
          statut: t.statut ?? "en_attente",
          ...(t.label !== undefined && { label: t.label }),
          ...(t.percent !== undefined && { percent: t.percent }),
          ...(t.montantPrevu !== undefined && { montantPrevu: t.montantPrevu }),
          ...(t.jalonKey !== undefined && { jalonKey: t.jalonKey as any }),
          ...(t.dateEcheance !== undefined && { dateEcheance: t.dateEcheance }),
          ...(t.montantReel !== undefined && { montantReel: t.montantReel }),
          ...(t.dateEncaissement !== undefined && { dateEncaissement: t.dateEncaissement }),
        });
      }
    }

    // ── 4. Supprimer les lignes d'ordre > tranches.length ─────────────────
    const toDelete = existingRows.filter((r) => r.ordre > args.tranches.length);
    for (const row of toDelete) {
      await ctx.db.delete(row._id);
    }

    // ── 5. Passer le débrief en customEcheancier=true ──────────────────────
    await ctx.db.patch(args.debriefId, { customEcheancier: true });

    return null;
  },
});

// ─── ensureImportedProjectDebriefs ───────────────────────────────────────────
// NO-OP — la table `clients` (délivrabilité) n'est pas encore portée en Convex.
// TODO(délivrabilité): câbler la vraie matérialisation depuis projects + clients
// quand la tranche délivrabilité arrive. Cf. NestJS payments.service.ts
// ensureImportedProjectDebriefs (~ligne 267) : INSERT INTO debriefs depuis la
// jointure projects × clients × devis, idempotent (WHERE NOT EXISTS debrief vente).
export const ensureImportedProjectDebriefs = internalMutation({
  args: {},
  handler: async (_ctx, _args): Promise<{ created: number }> => {
    // Boucle vide : aucune table `clients` portée → aucune vente importée
    // à matérialiser. Retourne 0 créations sans rien écrire.
    return { created: 0 };
  },
});

// ─── resetEcheancier ─────────────────────────────────────────────────────────
// Revient à l'échéancier STANDARD. Les lignes persistées restent (encaissements
// préservés) mais sont ignorées à la lecture tant que customEcheancier=false.
export const resetEcheancier = mutation({
  args: {
    debriefId: v.id("debriefs"),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...FINANCES_ROLES]);

    // Charger et vérifier le débrief
    const debrief = await ctx.db.get(args.debriefId);
    if (!debrief || debrief.deletedAt !== undefined) {
      throw new Error("Débrief introuvable");
    }

    await ctx.db.patch(args.debriefId, { customEcheancier: false });
    return null;
  },
});

// ─── recordEcheance ──────────────────────────────────────────────────────────
// Enregistre (upsert) UNE tranche d'acompte identifiée par (debriefId, ordre).
// Rôles : admin + finances UNIQUEMENT (pas les autres rôles finances comme
// delivrabilite, responsable_technique, back_office).
export const recordEcheance = mutation({
  args: {
    debriefId: v.id("debriefs"),
    ordre: v.number(),
    statut: acompteStatutValidator,
    montantReel: v.optional(v.number()),
    dateEncaissement: v.optional(v.string()),
    dateEcheance: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // ── 1. Contrôle d'accès : admin + finances seulement ───────────────────
    const user = await requireRole(ctx, ["admin", "finances"]);

    // ── 2. Charger le débrief ──────────────────────────────────────────────
    const debrief = await ctx.db.get(args.debriefId);
    if (!debrief || debrief.deletedAt !== undefined) {
      throw new Error("Débrief introuvable");
    }

    // ── 3. Validation statut encaisse ──────────────────────────────────────
    if (args.statut === "encaisse") {
      if (args.montantReel === undefined || args.montantReel === null) {
        throw new Error("montantReel requis pour le statut encaisse");
      }
      if (!args.dateEncaissement) {
        throw new Error("dateEncaissement requis pour le statut encaisse");
      }
    }

    // ── 4. Résoudre le template pour valider l'ordre ───────────────────────
    const lead = debrief.leadId ? await ctx.db.get(debrief.leadId) : null;
    const imported = lead?.source === "airtable_migration";

    const persistedRows = await ctx.db
      .query("acompteEcheances")
      .withIndex("by_debrief_ordre", (q) => q.eq("debriefId", debrief._id))
      .collect();

    const templates = resolveTemplatesFromData(debrief, imported, persistedRows);
    const validOrdres = new Set(templates.map((t) => t.ordre));

    if (!validOrdres.has(args.ordre)) {
      throw new Error(
        `Ordre ${args.ordre} invalide pour ce débrief (template : [${[...validOrdres].join(", ")}])`,
      );
    }

    // ── 5. Upsert via index by_debrief_ordre ──────────────────────────────
    const existing = persistedRows.find((r) => r.ordre === args.ordre);

    const patch: Record<string, unknown> = {
      statut: args.statut,
      recordedById: user._id,
    };
    if (args.montantReel !== undefined) patch.montantReel = args.montantReel;
    if (args.dateEncaissement !== undefined) patch.dateEncaissement = args.dateEncaissement;
    if (args.dateEcheance !== undefined) patch.dateEcheance = args.dateEcheance;
    if (args.notes !== undefined) patch.notes = args.notes;

    if (existing) {
      await ctx.db.patch(existing._id, patch as any);
    } else {
      await ctx.db.insert("acompteEcheances", {
        debriefId: args.debriefId,
        leadId: debrief.leadId,
        ordre: args.ordre,
        statut: args.statut,
        recordedById: user._id,
        ...(args.montantReel !== undefined && { montantReel: args.montantReel }),
        ...(args.dateEncaissement !== undefined && { dateEncaissement: args.dateEncaissement }),
        ...(args.dateEcheance !== undefined && { dateEcheance: args.dateEcheance }),
        ...(args.notes !== undefined && { notes: args.notes }),
      });
    }

    return null;
  },
});
