# Promotions (onglet Promotion + RDV au bureau) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'admin crée une promotion datée (ex. Black Friday). Les leads taggés dans GHL et les anciens leads ciblés par statut y sont rattachés et regroupés dans un onglet Promotion. Pendant la promo, la qualification propose un RDV au bureau sur le calendrier GHL de la promo.

**Architecture:**
- Nouvelle table Convex `promotions`. Le rattachement est enregistré sur le lead (`promotionId`, `promotionSource`). La logique pure (tags, dates, conflits, éligibilité) vit dans `convex/model/promotions.ts`. Les écritures vivent dans `convex/model/promotionAttach.ts` et `convex/promotions.ts`.
- Côté front, la liste des leads est déjà entièrement chargée dans le navigateur (drain partagé, plafond 5000). L'exclusion des onglets habituels et l'onglet Promotion sont donc calculés côté client à partir des promos `en_cours`, avec un helper pur testé.
- Le RDV bureau réutilise `ghlAppointments:createAppointment` avec le calendrier bureau et `locationType: "agence"`.

**Tech Stack:** Convex (queries/mutations/actions, convex-test + vitest), React 18 + Vite + Tailwind (vitest + Testing Library), API GHL (LeadConnector).

**Spec:** `docs/superpowers/specs/2026-11-20-promotions-design.md`

## Global Constraints

- Backend Convex : dossier `convex/`. Front : `frontend/src/` dans le même repo `~/backend_convex`, branche `main`. Ne **jamais** éditer `~/ECOI_frontend`, qui est obsolète.
- Dates de promo saisies et stockées en **heure de la Réunion, UTC+4 fixe**. Début = minuit du jour choisi, fin = 23:59:59.999 du jour choisi.
- Un lead = au plus une promo. Un rattachement n'est **jamais effacé automatiquement**.
- Statuts de promo calculés : `a_venir` (now < startAt), `en_cours` (startAt ≤ now ≤ endAt et non archivée), `terminee` (now > endAt ou archivée).
- Pas de chevauchement de dates entre deux promos non archivées avec le même `tagKey`. Au plus une promo avec `officeCalendarId` sur une même période.
- RDV bureau : `locationType: "agence"`. Calendrier Black Friday : `SyL9dfmEXNYeigIOvd9R`.
- Route webhook : `POST /webhooks/ghl/tags`, header `x-elevenprocess-webhook-secret`, corps `{ "contact_id": "...", "tags": "a,b" }`.
- Les lookups par id GHL passent **toujours** par `findLeadByGhlContact` (`externalId` puis `ghlContactId`).
- **Tests : jamais sur de vrais contacts GHL.** La vérification manuelle utilise un contact de test et le tag `zz-test-promo`.
- **Déploiement :** commits sur `main` en local, puis push GitHub. `npx convex deploy` et la mise en ligne du front se font **seulement avec le feu vert explicite de Mario**.
- Textes visibles en français simple. Commentaires de code en français, comme dans le reste du repo.
- Fin de chaque message de commit : `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Adaptations par rapport à la spec

1. **Exclusion côté client.** Le setter et l'admin travaillent sur la liste complète déjà chargée par `useSharedLeads`. L'exclusion des leads de promo en cours se fait donc dans le navigateur, avec `lib/promotions.ts`, et non par un filtre serveur dans `leads:listEnriched`.
2. **Pas de query `promotions.leads`.** Pour la même raison, le tableau des leads d'une promo est filtré côté client.
3. **Rattachement par tag pour les webhooks d'opportunité.** Il se fait dans un appel séparé et best-effort, juste après `applyGhlStageChange`, plutôt qu'à l'intérieur de cette mutation déjà très chargée. Pour `contact.created`, il reste dans la même transaction.

## Review Focus

- **Lead taggé hors période.** Un tag reçu avant `startAt` ou après `endAt` ne rattache rien, et un tag reçu au tout dernier instant de la journée de fin est accepté. Tests dans la Task 1 (bornes) et la Task 3 (webhook hors période).
- **Rattachement en masse relancé deux fois.** « Rattacher ces leads » ou « Rattraper les tags » cliqué deux fois ne crée aucun doublon et renvoie `attached: 0` au second passage. Tests dans les Tasks 4 et 5.
- **Ancien lead avec un RDV déjà planifié.** Il n'est pas aspiré dans la promo et reste dans son onglet. Test dans la Task 5.
- **Calendrier bureau détourné.** Un appel `createAppointment` en `agence` avec un calendrier qui n'est pas celui d'une promo en cours est refusé côté serveur. Test dans la Task 6.
- **Promo archivée en cours de route.** Ses leads réapparaissent tout de suite dans les onglets habituels, et le choix « RDV au bureau » disparaît. Tests dans les Tasks 7 et 10.

---

## File Structure

**Backend (créés)**
- `convex/model/promotions.ts` : logique pure (tags, dates Réunion, statut, correspondance, conflits, éligibilité des anciens leads).
- `convex/model/promotions.test.ts`
- `convex/model/promotionAttach.ts` : écriture du rattachement par tag sur un lead (`MutationCtx`).
- `convex/promotions.ts` : API (CRUD, `active`, `previewLegacy`, `attachLegacy`, `backfill`, `stats`, `applyLeadTags`, `officeCalendarForBooking`).
- `convex/promotions.test.ts`, `convex/promotions_attach.test.ts`, `convex/promotions_legacy.test.ts`, `convex/promotions_stats.test.ts`, `convex/http_ghl_tags.test.ts`, `convex/promotions_office.test.ts`

**Backend (modifiés)**
- `convex/schema.ts` : table `promotions`, champs sur `leads` et `rdv`.
- `convex/model/ghl/leadWebhook.ts` : `tags` dans `MappedGhlLead`.
- `convex/webhooks.ts` : `createLeadFromWebhook` accepte `tags`.
- `convex/http.ts` : passage des tags (contact et opportunité) + route `/webhooks/ghl/tags`.
- `convex/ghlAppointments.ts` : garde du calendrier bureau, `promotionId` sur le RDV, titre GHL.
- `convex/ghlCalendar.ts` : la synchro lit aussi les calendriers bureau des promos et crée les RDV en `agence`.

**Front (créés)**
- `frontend/src/lib/promotions.ts` : types + helpers purs (exclusion, filtre, libellés de dates).
- `frontend/src/lib/promotions.test.ts`
- `frontend/src/lib/promotionsApi.ts` : références Convex + hooks.
- `frontend/src/components/promotions/PromotionBanner.tsx` : bandeau setter.
- `frontend/src/components/promotions/PromotionForm.tsx` : fenêtre de création et de modification (admin).
- `frontend/src/components/promotions/PromotionsAdmin.tsx` : onglet admin.
- `frontend/src/components/promotions/PromotionsAdmin.test.tsx`
- `frontend/src/components/RdvLocationBadge.tsx`
- `frontend/src/components/SplitPanel.bureau.test.tsx`

**Front (modifiés)**
- `frontend/src/lib/types.ts`, `frontend/src/lib/convexApi.ts`, `frontend/src/lib/convexMappers.ts` : champs promo sur le lead.
- `frontend/src/pages/leads/LeadsList.tsx` : onglet Promotion (setter et admin), exclusion, badge.
- `frontend/src/components/SplitPanel.tsx` : deux qualifications + mode bureau + badge.
- `frontend/src/pages/rdv/RdvDetail.tsx`, `frontend/src/pages/rdv/RdvCalendar.tsx` : libellé et badge Bureau.

---

### Task 1: Logique pure des promotions

**Files:**
- Create: `convex/model/promotions.ts`
- Test: `convex/model/promotions.test.ts`

**Interfaces:**
- Produces :
  - `normalizeTag(s: string): string`
  - `parseGhlTags(raw: unknown): string[]`
  - `reunionDayStartMs(day: string): number`
  - `reunionDayEndMs(day: string): number`
  - `type PromotionLike`
  - `type PromotionStatus = "a_venir" | "en_cours" | "terminee"`
  - `promotionStatus(p, now): PromotionStatus`
  - `matchPromotion<P extends PromotionLike>(tags: string[], promos: P[], at: number): P | undefined`
  - `promotionConflict(candidate, others): string | null`
  - `type LegacyCandidate`
  - `legacyRejectReason(lead, promo, now): LegacyRejectReason | null`
  - `isLegacyEligible(lead, promo, now): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// convex/model/promotions.test.ts
import { describe, expect, it } from "vitest";
import {
  isLegacyEligible, legacyRejectReason, matchPromotion, normalizeTag, parseGhlTags,
  promotionConflict, promotionStatus, reunionDayEndMs, reunionDayStartMs,
  type PromotionLike,
} from "./promotions";

const promo = (over: Partial<PromotionLike> = {}): PromotionLike => ({
  _id: "p1",
  tagKey: "black friday",
  startAt: reunionDayStartMs("2026-11-23"),
  endAt: reunionDayEndMs("2026-11-29"),
  archived: false,
  ...over,
});

describe("normalizeTag / parseGhlTags", () => {
  it("ignore casse, accents et espaces multiples", () => {
    expect(normalizeTag("  Black   FRIDAY ")).toBe("black friday");
    expect(normalizeTag("Présentiel")).toBe("presentiel");
  });
  it("accepte une chaîne à virgules ou un tableau, dédoublonne, retire les vides", () => {
    expect(parseGhlTags("simulateur, présentiel,,Simulateur")).toEqual(["simulateur", "présentiel"]);
    expect(parseGhlTags(["a", " ", "b", 3])).toEqual(["a", "b"]);
    expect(parseGhlTags(undefined)).toEqual([]);
    expect(parseGhlTags(null)).toEqual([]);
  });
});

describe("dates Réunion", () => {
  it("minuit Réunion = 20:00 UTC la veille", () => {
    expect(new Date(reunionDayStartMs("2026-11-23")).toISOString()).toBe("2026-11-22T20:00:00.000Z");
    expect(new Date(reunionDayEndMs("2026-11-29")).toISOString()).toBe("2026-11-29T19:59:59.999Z");
  });
  it("refuse un format invalide", () => {
    expect(() => reunionDayStartMs("23/11/2026")).toThrow("Date invalide");
  });
});

describe("promotionStatus", () => {
  const p = promo();
  it("bornes incluses", () => {
    expect(promotionStatus(p, p.startAt - 1)).toBe("a_venir");
    expect(promotionStatus(p, p.startAt)).toBe("en_cours");
    expect(promotionStatus(p, p.endAt)).toBe("en_cours");
    expect(promotionStatus(p, p.endAt + 1)).toBe("terminee");
  });
  it("archivée = terminée", () => {
    expect(promotionStatus({ ...p, archived: true }, p.startAt + 1)).toBe("terminee");
  });
});

describe("matchPromotion", () => {
  const p = promo();
  it("trouve la promo par tag normalisé pendant la période", () => {
    expect(matchPromotion(["Simulateur", "BLACK Friday"], [p], p.startAt + 1000)?._id).toBe("p1");
  });
  it("rien hors période ni si archivée ni sans tag", () => {
    expect(matchPromotion(["black friday"], [p], p.startAt - 1)).toBeUndefined();
    expect(matchPromotion(["black friday"], [p], p.endAt + 1)).toBeUndefined();
    expect(matchPromotion(["black friday"], [{ ...p, archived: true }], p.startAt + 1)).toBeUndefined();
    expect(matchPromotion(["black friday"], [{ ...p, tagKey: undefined }], p.startAt + 1)).toBeUndefined();
  });
  it("prend la promo commencée le plus tard si plusieurs", () => {
    const p2 = { ...p, _id: "p2", startAt: p.startAt + 10 };
    expect(matchPromotion(["black friday"], [p, p2], p.startAt + 100)?._id).toBe("p2");
  });
});

describe("promotionConflict", () => {
  const a = promo();
  it("même tag sur période qui chevauche = conflit", () => {
    expect(promotionConflict({ ...a, _id: "new" }, [a])).toMatch(/tag/);
  });
  it("même tag sans chevauchement = ok ; archivée ignorée ; soi-même ignoré", () => {
    const later = { ...a, _id: "new", startAt: a.endAt + 1, endAt: a.endAt + 1000 };
    expect(promotionConflict(later, [a])).toBeNull();
    expect(promotionConflict({ ...a, _id: "new" }, [{ ...a, archived: true }])).toBeNull();
    expect(promotionConflict(a, [a])).toBeNull();
  });
  it("deux calendriers bureau sur la même période = conflit", () => {
    const b = { ...a, _id: "new", tagKey: "autre", officeCalendarId: "cal2" };
    expect(promotionConflict(b, [{ ...a, officeCalendarId: "cal1" }])).toMatch(/bureau/);
  });
});

describe("éligibilité des anciens leads", () => {
  const p = promo({ legacyStatuses: ["perdu", "relance"], legacyArrivedFrom: 1000, legacyArrivedTo: 5000 });
  const base = { status: "perdu" as const, arrivedAt: 2000, hasUpcomingRdv: false };
  it("éligible", () => {
    expect(legacyRejectReason(base, p)).toBeNull();
    expect(isLegacyEligible(base, p)).toBe(true);
  });
  it("raisons de rejet", () => {
    expect(legacyRejectReason({ ...base, status: "nouveau" }, p)).toBe("statut");
    expect(legacyRejectReason({ ...base, arrivedAt: 500 }, p)).toBe("periode");
    expect(legacyRejectReason({ ...base, arrivedAt: 6000 }, p)).toBe("periode");
    expect(legacyRejectReason({ ...base, deletedAt: 1 }, p)).toBe("supprime");
    expect(legacyRejectReason({ ...base, promotionId: "x" }, p)).toBe("deja_promo");
    expect(legacyRejectReason({ ...base, hasUpcomingRdv: true }, p)).toBe("rdv_a_venir");
    expect(legacyRejectReason({ ...base, status: "signe" }, { ...p, legacyStatuses: ["signe"] })).toBe("signe");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/backend_convex && npx vitest run convex/model/promotions.test.ts`
Expected: FAIL, « Failed to resolve import "./promotions" ».

- [ ] **Step 3: Write minimal implementation**

```ts
// convex/model/promotions.ts
// Logique pure des promotions (Black Friday…) : tags GHL, dates Réunion,
// statut calculé, correspondance tag → promo, conflits, éligibilité des
// anciens leads. Aucune I/O : testé seul (promotions.test.ts).
import type { LeadStatus } from "./enums";

const REUNION_OFFSET_MS = 4 * 3_600_000; // UTC+4 fixe, pas d'heure d'été
const DAY_MS = 86_400_000;

export function normalizeTag(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Tags GHL : "a,b" (payload workflow) ou ["a","b"]. Dédoublonnés (forme normalisée), vides retirés. */
export function parseGhlTags(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string")
    : typeof raw === "string" ? raw.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const tag = part.trim();
    if (!tag) continue;
    const key = normalizeTag(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** "YYYY-MM-DD" (jour Réunion) → ms du minuit Réunion. */
export function reunionDayStartMs(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`Date invalide : ${day}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - REUNION_OFFSET_MS;
}

/** "YYYY-MM-DD" (jour Réunion) → ms de 23:59:59.999 Réunion. */
export function reunionDayEndMs(day: string): number {
  return reunionDayStartMs(day) + DAY_MS - 1;
}

export type PromotionLike = {
  _id: string;
  tagKey?: string;
  startAt: number;
  endAt: number;
  archived: boolean;
  officeCalendarId?: string;
  legacyStatuses?: LeadStatus[];
  legacyArrivedFrom?: number;
  legacyArrivedTo?: number;
};

export type PromotionStatus = "a_venir" | "en_cours" | "terminee";

export function promotionStatus(p: Pick<PromotionLike, "startAt" | "endAt" | "archived">, now: number): PromotionStatus {
  if (p.archived || now > p.endAt) return "terminee";
  if (now < p.startAt) return "a_venir";
  return "en_cours";
}

export function matchPromotion<P extends PromotionLike>(tags: string[], promos: P[], at: number): P | undefined {
  const keys = new Set(tags.map(normalizeTag));
  return promos
    .filter((p) => p.tagKey !== undefined && keys.has(p.tagKey) && promotionStatus(p, at) === "en_cours")
    .sort((a, b) => b.startAt - a.startAt)[0];
}

function overlap(a: { startAt: number; endAt: number }, b: { startAt: number; endAt: number }): boolean {
  return a.startAt <= b.endAt && b.startAt <= a.endAt;
}

/** Message d'erreur lisible, ou null si la promo candidate ne gêne aucune autre. */
export function promotionConflict(candidate: PromotionLike, others: PromotionLike[]): string | null {
  for (const other of others) {
    if (other._id === candidate._id || other.archived || !overlap(candidate, other)) continue;
    if (candidate.tagKey && other.tagKey === candidate.tagKey) {
      return "Une autre promotion utilise déjà ce tag sur ces dates.";
    }
    if (candidate.officeCalendarId && other.officeCalendarId) {
      return "Une autre promotion avec RDV au bureau est déjà prévue sur ces dates.";
    }
  }
  return null;
}

export type LegacyCandidate = {
  status: LeadStatus;
  arrivedAt: number;
  deletedAt?: number;
  promotionId?: string;
  hasUpcomingRdv: boolean;
};

export type LegacyRejectReason = "statut" | "periode" | "supprime" | "signe" | "deja_promo" | "rdv_a_venir";

export function legacyRejectReason(
  lead: LegacyCandidate,
  promo: Pick<PromotionLike, "legacyStatuses" | "legacyArrivedFrom" | "legacyArrivedTo">,
): LegacyRejectReason | null {
  if (!(promo.legacyStatuses ?? []).includes(lead.status)) return "statut";
  if (promo.legacyArrivedFrom !== undefined && lead.arrivedAt < promo.legacyArrivedFrom) return "periode";
  if (promo.legacyArrivedTo !== undefined && lead.arrivedAt > promo.legacyArrivedTo) return "periode";
  if (lead.deletedAt !== undefined) return "supprime";
  if (lead.status === "signe") return "signe";
  if (lead.promotionId !== undefined) return "deja_promo";
  if (lead.hasUpcomingRdv) return "rdv_a_venir";
  return null;
}

export function isLegacyEligible(
  lead: LegacyCandidate,
  promo: Pick<PromotionLike, "legacyStatuses" | "legacyArrivedFrom" | "legacyArrivedTo">,
): boolean {
  return legacyRejectReason(lead, promo) === null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/backend_convex && npx vitest run convex/model/promotions.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
cd ~/backend_convex
git add convex/model/promotions.ts convex/model/promotions.test.ts
git commit -m "feat(promotions): logique pure (tags, dates Réunion, conflits, éligibilité)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schéma + API de gestion des promotions

**Files:**
- Modify: `convex/schema.ts` (table `leads` l.75-197, table `rdv` l.458-507, nouvelle table après `acquisitionSourceMap`)
- Create: `convex/promotions.ts`
- Test: `convex/promotions.test.ts`

**Interfaces:**
- Consumes : Task 1 (`normalizeTag`, `reunionDayStartMs`, `reunionDayEndMs`, `promotionStatus`, `promotionConflict`).
- Produces :
  - `api.promotions.create(args: PromotionInput): Id<"promotions">`
  - `api.promotions.update({ id, ...PromotionInput }): null`
  - `api.promotions.archive({ id }): null`
  - `api.promotions.list({ now }): PromotionRow[]`, où `PromotionRow = Doc<"promotions"> & { status: PromotionStatus }`
  - `api.promotions.active({ now }): ActivePromotion[]`, où `ActivePromotion = { _id, name, startAt, endAt, offer?, pitch?, officeCalendarId?, officeAddress? }`
  - `PromotionInput = { name: string; tag?: string; startDay: string; endDay: string; offer?: string; pitch?: string; officeCalendarId?: string; officeAddress?: string; legacyStatuses?: LeadStatus[]; legacyArrivedFromDay?: string; legacyArrivedToDay?: string }`
  - Schéma :
    - `promotions` : index `by_endAt`, `by_tagKey` ;
    - `leads` : `ghlTags`, `promotionId`, `promotionJoinedAt`, `promotionSource`, index `by_promotion` ;
    - `rdv` : `promotionId`, index `by_promotion`.

- [ ] **Step 1: Write the failing test**

```ts
// convex/promotions.test.ts
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { reunionDayStartMs } from "./model/promotions";

const BASE = {
  name: "Black Friday 2026",
  tag: "Black Friday",
  startDay: "2026-11-23",
  endDay: "2026-11-29",
  offer: "-15 % sur les kits",
};

describe("promotions CRUD", () => {
  it("l'admin crée une promo : tagKey normalisé, dates Réunion", async () => {
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    const id = await asUser(t, admin).mutation(api.promotions.create, BASE);
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).toMatchObject({ tag: "Black Friday", tagKey: "black friday", archived: false, createdBy: admin });
    expect(row?.startAt).toBe(reunionDayStartMs("2026-11-23"));
  });

  it("refus : nom vide, fin avant début, ni tag ni statut", async () => {
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    const as = asUser(t, admin);
    await expect(as.mutation(api.promotions.create, { ...BASE, name: " " })).rejects.toThrow(/nom/i);
    await expect(as.mutation(api.promotions.create, { ...BASE, startDay: "2026-11-30" })).rejects.toThrow(/fin/i);
    await expect(as.mutation(api.promotions.create, { ...BASE, tag: undefined })).rejects.toThrow(/tag ou au moins un statut/i);
  });

  it("refus : même tag sur dates qui se chevauchent, et deux calendriers bureau", async () => {
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    const as = asUser(t, admin);
    await as.mutation(api.promotions.create, { ...BASE, officeCalendarId: "cal1" });
    await expect(as.mutation(api.promotions.create, { ...BASE, name: "Bis" })).rejects.toThrow(/tag/);
    await expect(
      as.mutation(api.promotions.create, { ...BASE, name: "Ter", tag: "autre", officeCalendarId: "cal2" }),
    ).rejects.toThrow(/bureau/);
  });

  it("un setter ne peut pas créer", async () => {
    const t = makeT();
    const setter = await insertUser(t, { role: "setter" });
    await expect(asUser(t, setter).mutation(api.promotions.create, BASE)).rejects.toThrow(/Accès refusé/);
  });

  it("active : seulement les promos en cours, visibles par un setter ; archivée exclue", async () => {
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    const setter = await insertUser(t, { role: "setter", email: "s@ecoi.fr" });
    const id = await asUser(t, admin).mutation(api.promotions.create, BASE);
    const during = reunionDayStartMs("2026-11-25");
    expect(await asUser(t, setter).query(api.promotions.active, { now: during })).toHaveLength(1);
    expect(await asUser(t, setter).query(api.promotions.active, { now: reunionDayStartMs("2026-12-05") })).toHaveLength(0);
    await asUser(t, admin).mutation(api.promotions.archive, { id });
    expect(await asUser(t, setter).query(api.promotions.active, { now: during })).toHaveLength(0);
  });

  it("list : statut calculé, admin seulement", async () => {
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    await asUser(t, admin).mutation(api.promotions.create, BASE);
    const rows = await asUser(t, admin).query(api.promotions.list, { now: reunionDayStartMs("2026-11-01") });
    expect(rows[0].status).toBe("a_venir");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/backend_convex && npx vitest run convex/promotions.test.ts`
Expected: FAIL, `api.promotions` undefined.

- [ ] **Step 3: Schéma**

Dans `convex/schema.ts`, table `leads`, juste après `resubmittedAt: v.optional(v.number()),` :

```ts
    // Promotions (Black Friday…) : derniers tags GHL reçus + rattachement à
    // une promo (jamais effacé automatiquement). promotionSource distingue les
    // nouveaux leads taggés (tag) des anciens ciblés par statut (statut).
    ghlTags: v.optional(v.array(v.string())),
    promotionId: v.optional(v.id("promotions")),
    promotionJoinedAt: v.optional(v.number()),
    promotionSource: v.optional(v.union(v.literal("tag"), v.literal("statut"))),
```

Ajouter à la fin des index de `leads` (après `.index("by_status_createdAt", ["status", "createdAt"])`, avant la virgule) :

```ts
    .index("by_promotion", ["promotionId"])
```

Table `rdv`, après `createdAt: v.optional(v.number()),` :

```ts
    // Promo pendant laquelle ce RDV a été pris (RDV bureau d'un lead hors promo inclus).
    promotionId: v.optional(v.id("promotions")),
```

et ajouter `.index("by_promotion", ["promotionId"])` après `.index("by_ghlEventId", ["ghlEventId"])`.

Nouvelle table, juste après la définition `acquisitionSourceMap: defineTable({...})...,` :

```ts
  // Promotions commerciales datées (ex. Black Friday). Dates en ms, calées
  // sur les jours Réunion (model/promotions.ts). Statut calculé, jamais stocké.
  promotions: defineTable({
    name: v.string(),
    tag: v.optional(v.string()),
    tagKey: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    offer: v.optional(v.string()),
    pitch: v.optional(v.string()),
    officeCalendarId: v.optional(v.string()),
    officeAddress: v.optional(v.string()),
    legacyStatuses: v.optional(v.array(leadStatusValidator)),
    legacyArrivedFrom: v.optional(v.number()),
    legacyArrivedTo: v.optional(v.number()),
    archived: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_endAt", ["endAt"])
    .index("by_tagKey", ["tagKey"]),
```

- [ ] **Step 4: API**

```ts
// convex/promotions.ts
// API des promotions (onglet Promotion de la page Leads). Gestion admin,
// lecture « en cours » pour tous. Le rattachement des leads est dans
// model/promotionAttach.ts (tags) et attachLegacy ci-dessous (statuts).
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireRole, requireUser } from "./model/access";
import { logActivity } from "./model/activity";
import { leadStatusValidator } from "./model/enums";
import {
  normalizeTag, promotionConflict, promotionStatus, reunionDayEndMs, reunionDayStartMs,
  type PromotionLike, type PromotionStatus,
} from "./model/promotions";

const promotionInput = {
  name: v.string(),
  tag: v.optional(v.string()),
  startDay: v.string(),
  endDay: v.string(),
  offer: v.optional(v.string()),
  pitch: v.optional(v.string()),
  officeCalendarId: v.optional(v.string()),
  officeAddress: v.optional(v.string()),
  legacyStatuses: v.optional(v.array(leadStatusValidator)),
  legacyArrivedFromDay: v.optional(v.string()),
  legacyArrivedToDay: v.optional(v.string()),
};

type PromotionInputArgs = {
  name: string; tag?: string; startDay: string; endDay: string; offer?: string; pitch?: string;
  officeCalendarId?: string; officeAddress?: string; legacyStatuses?: Doc<"leads">["status"][];
  legacyArrivedFromDay?: string; legacyArrivedToDay?: string;
};

const clean = (s: string | undefined) => {
  const t = (s ?? "").trim();
  return t === "" ? undefined : t;
};

/** Valide et convertit la saisie admin en champs de table (sans createdBy/createdAt/archived). */
function toFields(args: PromotionInputArgs) {
  const name = clean(args.name);
  if (!name) throw new Error("Le nom de la promotion est obligatoire.");
  const startAt = reunionDayStartMs(args.startDay);
  const endAt = reunionDayEndMs(args.endDay);
  if (endAt <= startAt) throw new Error("La date de fin doit être après la date de début.");
  const tag = clean(args.tag);
  const legacyStatuses = args.legacyStatuses && args.legacyStatuses.length > 0 ? args.legacyStatuses : undefined;
  if (!tag && !legacyStatuses) {
    throw new Error("Indique un tag ou au moins un statut d'anciens leads.");
  }
  return {
    name,
    tag,
    tagKey: tag ? normalizeTag(tag) : undefined,
    startAt,
    endAt,
    offer: clean(args.offer),
    pitch: clean(args.pitch),
    officeCalendarId: clean(args.officeCalendarId),
    officeAddress: clean(args.officeAddress),
    legacyStatuses,
    legacyArrivedFrom: args.legacyArrivedFromDay ? reunionDayStartMs(args.legacyArrivedFromDay) : undefined,
    legacyArrivedTo: args.legacyArrivedToDay ? reunionDayEndMs(args.legacyArrivedToDay) : undefined,
  };
}

function asLike(p: Pick<Doc<"promotions">, "tagKey" | "startAt" | "endAt" | "archived" | "officeCalendarId">, id: string): PromotionLike {
  return { _id: id, tagKey: p.tagKey, startAt: p.startAt, endAt: p.endAt, archived: p.archived, officeCalendarId: p.officeCalendarId };
}

export const create = mutation({
  args: promotionInput,
  handler: async (ctx, args): Promise<Id<"promotions">> => {
    const user = await requireRole(ctx, ["admin"]);
    const fields = toFields(args);
    const others = await ctx.db.query("promotions").collect();
    const conflict = promotionConflict(
      asLike({ ...fields, archived: false }, "__new__"),
      others.map((o) => asLike(o, o._id)),
    );
    if (conflict) throw new Error(conflict);
    const id = await ctx.db.insert("promotions", { ...fields, archived: false, createdBy: user._id, createdAt: Date.now() });
    await logActivity(ctx, {
      action: "promotion.created", entityType: "promotion", entityId: id, subject: fields.name,
      summary: `a créé la promotion « ${fields.name} »`,
      details: { tag: fields.tag ?? null, startAt: fields.startAt, endAt: fields.endAt },
    });
    return id;
  },
});

export const update = mutation({
  args: { id: v.id("promotions"), ...promotionInput },
  handler: async (ctx, { id, ...args }) => {
    await requireRole(ctx, ["admin"]);
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Promotion introuvable.");
    const fields = toFields(args);
    const others = await ctx.db.query("promotions").collect();
    const conflict = promotionConflict(asLike({ ...fields, archived: existing.archived }, id), others.map((o) => asLike(o, o._id)));
    if (conflict) throw new Error(conflict);
    // replace : les champs vidés dans le formulaire doivent disparaître.
    await ctx.db.replace(id, { ...fields, archived: existing.archived, createdBy: existing.createdBy, createdAt: existing.createdAt });
    await logActivity(ctx, {
      action: "promotion.updated", entityType: "promotion", entityId: id, subject: fields.name,
      summary: `a modifié la promotion « ${fields.name} »`,
    });
    return null;
  },
});

export const archive = mutation({
  args: { id: v.id("promotions") },
  handler: async (ctx, { id }) => {
    await requireRole(ctx, ["admin"]);
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Promotion introuvable.");
    await ctx.db.patch(id, { archived: true });
    await logActivity(ctx, {
      action: "promotion.archived", entityType: "promotion", entityId: id, subject: existing.name,
      summary: `a archivé la promotion « ${existing.name} »`,
    });
    return null;
  },
});

export type PromotionRow = Doc<"promotions"> & { status: PromotionStatus };

export const list = query({
  args: { now: v.number() },
  handler: async (ctx, { now }): Promise<PromotionRow[]> => {
    await requireRole(ctx, ["admin"]);
    const rows = await ctx.db.query("promotions").collect();
    return rows
      .map((p) => ({ ...p, status: promotionStatus(p, now) }))
      .sort((a, b) => b.startAt - a.startAt);
  },
});

/** Promos en cours (bandeau setter, onglet Promotion, choix RDV bureau). */
export const active = query({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("promotions").withIndex("by_endAt", (q) => q.gte("endAt", now)).collect();
    return rows
      .filter((p) => promotionStatus(p, now) === "en_cours")
      .map((p) => ({
        _id: p._id, name: p.name, startAt: p.startAt, endAt: p.endAt,
        offer: p.offer, pitch: p.pitch, officeCalendarId: p.officeCalendarId, officeAddress: p.officeAddress,
      }));
  },
});
```

- [ ] **Step 5: Regenerate types and run tests**

Run: `cd ~/backend_convex && npx convex codegen && npx vitest run convex/promotions.test.ts convex/model/promotions.test.ts`
Expected: PASS. Si `convex codegen` réclame un déploiement, utiliser `npx convex dev --once --typecheck=disable` sur le déploiement dev **uniquement si Mario l'autorise**. Sinon, s'appuyer sur `convex-test`, qui lit `schema.ts` directement : le test passe sans codegen, mais `tsc` exigera le codegen avant le commit.

- [ ] **Step 6: Typecheck and commit**

Run: `cd ~/backend_convex && npx tsc --noEmit -p convex`
Expected: aucune erreur.

```bash
cd ~/backend_convex
git add convex/schema.ts convex/promotions.ts convex/promotions.test.ts convex/_generated
git commit -m "feat(promotions): table promotions + champs lead/rdv + API admin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Rattachement par tag GHL (contact créé, opportunité, route /webhooks/ghl/tags)

**Files:**
- Create: `convex/model/promotionAttach.ts`
- Modify: `convex/promotions.ts` (ajout de `applyLeadTags`)
- Modify: `convex/model/ghl/leadWebhook.ts:31-42` (interface) et `:82-100` (retour)
- Modify: `convex/webhooks.ts:346-405` (`createLeadFromWebhook`)
- Modify: `convex/http.ts` (route contact l.33-82, route opportunité l.145-158, nouvelle route)
- Test: `convex/promotions_attach.test.ts`, `convex/http_ghl_tags.test.ts`

**Interfaces:**
- Consumes : Task 1 (`matchPromotion`, `parseGhlTags`), Task 2 (schéma), `findLeadByGhlContact(ctx, contactId)` de `convex/webhooks.ts:27`, `logSystemActivity` de `convex/model/activity.ts`.
- Produces :
  - `applyTagsToLead(ctx: MutationCtx, leadId: Id<"leads">, tags: string[], at: number): Promise<{ attached: boolean; promotionId?: Id<"promotions"> }>`
  - `internal.promotions.applyLeadTags({ leadId, tags, at }): { attached: boolean }`
  - `internal.promotions.applyContactTags({ contactId, tags, at }): { matched: boolean; attached: boolean }`
  - `MappedGhlLead.tags: string[]`

- [ ] **Step 1: Write the failing tests**

```ts
// convex/promotions_attach.test.ts
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { insertUser } from "./test.helpers";
import { normalizeTag, reunionDayEndMs, reunionDayStartMs } from "./model/promotions";

async function seedPromo(t: ReturnType<typeof makeT>) {
  const admin = await insertUser(t, { role: "admin" });
  return await t.run((ctx) => ctx.db.insert("promotions", {
    name: "Black Friday", tag: "Black Friday", tagKey: normalizeTag("Black Friday"),
    startAt: reunionDayStartMs("2026-11-23"), endAt: reunionDayEndMs("2026-11-29"),
    archived: false, createdBy: admin, createdAt: 0,
  }));
}
const DURING = reunionDayStartMs("2026-11-24");

describe("rattachement par tag", () => {
  it("createLeadFromWebhook avec le tag pendant la promo → rattaché (source tag) + ghlTags", async () => {
    const t = makeT();
    const promoId = await seedPromo(t);
    const { leadId } = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      externalId: "c1", data: { firstName: "A" }, signals: {}, tags: ["simulateur", "black friday"], now: DURING,
    });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead).toMatchObject({ promotionId: promoId, promotionSource: "tag", ghlTags: ["simulateur", "black friday"] });
  });

  it("hors période → tags stockés mais pas de rattachement", async () => {
    const t = makeT();
    await seedPromo(t);
    const { leadId } = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      externalId: "c2", data: {}, signals: {}, tags: ["Black Friday"], now: reunionDayStartMs("2026-12-02"),
    });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.promotionId).toBeUndefined();
    expect(lead?.ghlTags).toEqual(["Black Friday"]);
  });

  it("ancien lead taggé pendant la promo → rattaché ; rejouer = idempotent ; jamais retiré", async () => {
    const t = makeT();
    const promoId = await seedPromo(t);
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "perdu", externalId: "old", createdAt: 1 }));
    const first = await t.mutation(internal.promotions.applyLeadTags, { leadId, tags: ["black friday"], at: DURING });
    const again = await t.mutation(internal.promotions.applyLeadTags, { leadId, tags: ["black friday"], at: DURING });
    await t.mutation(internal.promotions.applyLeadTags, { leadId, tags: ["autre"], at: DURING });
    expect(first.attached).toBe(true);
    expect(again.attached).toBe(false);
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.promotionId).toBe(promoId);
    expect(lead?.ghlTags).toEqual(["autre"]);
  });

  it("applyContactTags : lead introuvable → matched false", async () => {
    const t = makeT();
    await seedPromo(t);
    const r = await t.mutation(internal.promotions.applyContactTags, { contactId: "nope", tags: ["black friday"], at: DURING });
    expect(r).toEqual({ matched: false, attached: false });
  });
});
```

```ts
// convex/http_ghl_tags.test.ts
import { describe, expect, it } from "vitest";
import { makeT } from "./test.kit";
import { insertUser } from "./test.helpers";
import { normalizeTag } from "./model/promotions";

const SECRET = "hook-secret";

async function post(t: ReturnType<typeof makeT>, body: unknown, secret = SECRET) {
  return await t.fetch("/webhooks/ghl/tags", {
    method: "POST",
    headers: { "content-type": "application/json", "x-elevenprocess-webhook-secret": secret },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /webhooks/ghl/tags", () => {
  it("403 sans bon secret, 400 sans contact_id ou JSON invalide", async () => {
    process.env.ELEVENPROCESS_WEBHOOK_SECRET = SECRET;
    const t = makeT();
    expect((await post(t, { contact_id: "c" }, "faux")).status).toBe(403);
    expect((await post(t, { tags: "x" })).status).toBe(400);
    expect((await post(t, "{pas du json")).status).toBe(400);
  });

  it("rattache le lead existant à la promo en cours et trace l'événement", async () => {
    process.env.ELEVENPROCESS_WEBHOOK_SECRET = SECRET;
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    const now = Date.now();
    const promoId = await t.run((ctx) => ctx.db.insert("promotions", {
      name: "BF", tag: "zz-test-promo", tagKey: normalizeTag("zz-test-promo"),
      startAt: now - 3_600_000, endAt: now + 3_600_000, archived: false, createdBy: admin, createdAt: now,
    }));
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", ghlContactId: "ghl-1", createdAt: now }));
    const res = await post(t, { contact_id: "ghl-1", tags: "simulateur,zz-test-promo" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, matched: true, attached: true });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.promotionId).toBe(promoId);
    const events = await t.run((ctx) => ctx.db.query("webhookEvents").collect());
    expect(events.find((e) => e.eventType === "contact.tags")?.status).toBe("processed");
  });

  it("contact inconnu → 200 matched false", async () => {
    process.env.ELEVENPROCESS_WEBHOOK_SECRET = SECRET;
    const t = makeT();
    const res = await post(t, { contact_id: "inconnu", tags: "x" });
    expect(await res.json()).toMatchObject({ ok: true, matched: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/backend_convex && npx vitest run convex/promotions_attach.test.ts convex/http_ghl_tags.test.ts`
Expected: FAIL, échec de validation des arguments (`tags` / `now` inconnus) et 404 sur la route.

- [ ] **Step 3: Helper d'écriture**

```ts
// convex/model/promotionAttach.ts
// Rattachement d'un lead à une promo par ses tags GHL. Appelé dans la même
// transaction que la création du lead (webhooks.createLeadFromWebhook) et
// par les mutations promotions.applyLeadTags / applyContactTags.
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { leadLabel, logSystemActivity } from "./activity";
import { matchPromotion, normalizeTag } from "./promotions";

function sameTags(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((tag, i) => normalizeTag(tag) === normalizeTag(b[i]));
}

/**
 * Écrit ghlTags (si fourni et différent) puis rattache le lead à la promo en
 * cours qui porte l'un de ses tags, s'il n'en a pas déjà une. Ne retire
 * jamais un rattachement. tags vide = rien à faire (payload sans tags).
 */
export async function applyTagsToLead(
  ctx: MutationCtx,
  leadId: Id<"leads">,
  tags: string[],
  at: number,
): Promise<{ attached: boolean; promotionId?: Id<"promotions"> }> {
  if (tags.length === 0) return { attached: false };
  const lead = await ctx.db.get(leadId);
  if (!lead || lead.deletedAt !== undefined) return { attached: false };

  const patch: Record<string, unknown> = {};
  if (!sameTags(lead.ghlTags, tags)) patch.ghlTags = tags;

  let promotionId: Id<"promotions"> | undefined;
  if (lead.promotionId === undefined) {
    const candidates = await ctx.db.query("promotions").withIndex("by_endAt", (q) => q.gte("endAt", at)).collect();
    const match = matchPromotion(tags, candidates, at);
    if (match) {
      promotionId = match._id;
      patch.promotionId = match._id;
      patch.promotionJoinedAt = at;
      patch.promotionSource = "tag";
    }
  }
  if (Object.keys(patch).length > 0) await ctx.db.patch(leadId, patch);
  if (promotionId) {
    const promo = await ctx.db.get(promotionId);
    await logSystemActivity(ctx, {
      source: "GHL", action: "lead.promotion.joined", entityType: "lead", entityId: leadId, leadId,
      subject: leadLabel(lead),
      summary: `${leadLabel(lead)} rattaché à la promotion « ${promo?.name ?? "?"} » (tag GHL)`,
      details: { promotionId, tags },
    });
  }
  return promotionId ? { attached: true, promotionId } : { attached: false };
}
```

- [ ] **Step 4: Mutations internes**

Ajouter à `convex/promotions.ts` (imports compris) :

```ts
import { internalMutation } from "./_generated/server";
import { applyTagsToLead } from "./model/promotionAttach";
import { findLeadByGhlContact } from "./webhooks";

export const applyLeadTags = internalMutation({
  args: { leadId: v.id("leads"), tags: v.array(v.string()), at: v.number() },
  handler: async (ctx, args) => {
    const r = await applyTagsToLead(ctx, args.leadId, args.tags, args.at);
    return { attached: r.attached };
  },
});

/** Route /webhooks/ghl/tags : résout le contact (deux familles d'ids) puis rattache. */
export const applyContactTags = internalMutation({
  args: { contactId: v.string(), tags: v.array(v.string()), at: v.number() },
  handler: async (ctx, args) => {
    const lead = await findLeadByGhlContact(ctx, args.contactId);
    if (!lead || lead.deletedAt !== undefined) return { matched: false, attached: false };
    const r = await applyTagsToLead(ctx, lead._id, args.tags, args.at);
    return { matched: true, attached: r.attached };
  },
});
```

Fusionner `internalMutation` dans l'import existant `import { mutation, query } from "./_generated/server";`.

- [ ] **Step 5: Tags dans le mapping du webhook contact**

`convex/model/ghl/leadWebhook.ts` :
- ajouter `tags: string[];` dans `interface MappedGhlLead`, après `externalId?: string;` ;
- ajouter `import { parseGhlTags } from "../promotions";` en tête ;
- dans le `return {` de `mapGhlLeadPayload`, après `externalId,`, ajouter :

```ts
    // Tags du contact : à plat (workflow GHL) ou sous contact.tags.
    tags: parseGhlTags(p.tags ?? contact.tags),
```

- [ ] **Step 6: createLeadFromWebhook**

`convex/webhooks.ts` :
- importer `import { applyTagsToLead } from "./model/promotionAttach";` ;
- dans `createLeadFromWebhook`, `args`, ajouter après `signals: v.object({...}),` :

```ts
    tags: v.optional(v.array(v.string())),
    // Horloge injectable (tests) ; défaut Date.now().
    now: v.optional(v.number()),
```

- au début du handler : `const now = args.now ?? Date.now();` ;
- dans la branche `if (existing) {`, juste avant `return { leadId: existing._id, duplicate: true };` :

```ts
        await applyTagsToLead(ctx, existing._id, args.tags ?? [], now);
```

- dans la branche création, juste avant `return { leadId, duplicate: false };` :

```ts
    await applyTagsToLead(ctx, leadId, args.tags ?? [], now);
```

- remplacer `createdAt: Date.now(),` par `createdAt: now,` dans l'insert, et `resubmittedAt: Date.now(),` par `resubmittedAt: now,`.

- [ ] **Step 7: http.ts (passage des tags + nouvelle route)**

Route `/webhooks/elevenprocess` : dans l'appel `createLeadFromWebhook`, ajouter `tags: mapped.tags,` après `signals: mapped.signals,`.

Route `/webhooks/ghl/opportunity` : juste après `await ctx.runMutation(internal.webhooks.markProcessed, { eventId });`, qui suit `applyGhlStageChange`, ajouter :

```ts
      // Promotions : tags du contact portés par le webhook d'opportunité
      // (best-effort, ne fait jamais échouer le webhook).
      const opportunityTags = parseGhlTags(
        payload.tags ?? (payload.contact as Record<string, unknown> | undefined)?.tags,
      );
      if (opportunityTags.length > 0) {
        try {
          await ctx.runMutation(internal.promotions.applyLeadTags, {
            leadId: result.leadId, tags: opportunityTags, at: Date.now(),
          });
        } catch (err) {
          console.warn(`applyLeadTags failed (eventId=${eventId}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
```

Vérifier que `result.leadId` est bien de type `Id<"leads">` (retour de `applyGhlStageChange`, déjà utilisé par `syncProjectFromLead`).

Import en tête : `import { parseGhlTags } from "./model/promotions";`.

Nouvelle route, à placer juste avant `http.route({ path: "/webhooks/ghl/debrief-link"` :

```ts
/**
 * Webhook GHL « tag posé » (workflow Black Friday : action Webhook placée
 * APRÈS « Ajouter le tag »). Corps { contact_id, tags }. Rattache le lead à
 * la promo en cours qui porte ce tag. Contact inconnu → 200 matched:false
 * (il sera traité à son contact.created).
 */
http.route({
  path: "/webhooks/ghl/tags",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = checkWebhookSecret(req);
    if (!secret.ok) return json({ message: secret.error }, 403);
    let payload: Record<string, unknown>;
    try {
      payload = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ message: "Body JSON invalide" }, 400);
    }
    const contactId = extractId(payload, ["contact_id", "contactId"], ["contact"]);
    if (!contactId) return json({ message: "contact_id requis" }, 400);
    const tags = parseGhlTags(payload.tags ?? (payload.contact as Record<string, unknown> | undefined)?.tags);

    const eventId = await ctx.runMutation(internal.webhooks.recordEvent, {
      provider: "ghl",
      eventType: "contact.tags",
      payload: JSON.stringify(payload),
      ...(clientIp(req) !== undefined ? { ipAddress: clientIp(req) } : {}),
    });
    try {
      const r = await ctx.runMutation(internal.promotions.applyContactTags, { contactId, tags, at: Date.now() });
      await ctx.runMutation(internal.webhooks.markProcessed, { eventId });
      return json({ ok: true, eventId, ...r });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      await ctx.runMutation(internal.webhooks.markFailed, { eventId, error: message });
      return json({ message }, 500);
    }
  }),
});
```

`extractId` est défini plus bas dans le fichier (déclaration `function`, donc hissée) : on peut l'utiliser ici.

- [ ] **Step 8: Run tests (nouveaux + existants touchés)**

Run: `cd ~/backend_convex && npx convex codegen && npx vitest run convex/promotions_attach.test.ts convex/http_ghl_tags.test.ts convex/http_ghl_leads.test.ts convex/http_ghl_opportunity.test.ts convex/webhooks_record.test.ts`
Expected: PASS. Les tests existants ne doivent pas changer de comportement : `tags` et `now` sont optionnels.

- [ ] **Step 9: Commit**

```bash
cd ~/backend_convex
git add convex/model/promotionAttach.ts convex/promotions.ts convex/model/ghl/leadWebhook.ts convex/webhooks.ts convex/http.ts convex/promotions_attach.test.ts convex/http_ghl_tags.test.ts convex/_generated
git commit -m "feat(promotions): rattachement par tag GHL + route /webhooks/ghl/tags

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Rattrapage des tags depuis les webhooks stockés

**Files:**
- Modify: `convex/promotions.ts`
- Test: `convex/promotions_attach.test.ts` (ajout d'un `describe`)

**Interfaces:**
- Consumes : `applyTagsToLead` (Task 3), `findLeadByGhlContact`, `parseGhlTags`.
- Produces :
  - `internal.promotions.backfillBatch({ promotionId, after, batch }): { scanned; attached; cursor; done }`
  - `api.promotions.backfill({ promotionId }): { scanned: number; attached: number }` (action admin)

- [ ] **Step 1: Write the failing test**

Ajouter à `convex/promotions_attach.test.ts` :

```ts
describe("backfill des tags", () => {
  it("rejoue les webhooks reçus pendant la promo, idempotent", async () => {
    const t = makeT();
    const promoId = await seedPromo(t);
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", externalId: "c9", createdAt: 1 }));
    await t.run((ctx) => ctx.db.insert("webhookEvents", {
      provider: "ghl", eventType: "contact.created", status: "processed",
      payload: JSON.stringify({ contact_id: "c9", tags: "simulateur,black friday" }),
    }));
    // Horodatage des events = _creationTime (now réel en test) : on simule
    // une promo englobant maintenant.
    await t.run((ctx) => ctx.db.patch(promoId, { startAt: 0, endAt: Date.now() + 3_600_000 }));
    const first = await t.mutation(internal.promotions.backfillBatch, { promotionId: promoId, after: 0, batch: 50 });
    const second = await t.mutation(internal.promotions.backfillBatch, { promotionId: promoId, after: 0, batch: 50 });
    expect(first).toMatchObject({ scanned: 1, attached: 1, done: true });
    expect(second.attached).toBe(0);
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.promotionId).toBe(promoId);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/backend_convex && npx vitest run convex/promotions_attach.test.ts -t backfill`
Expected: FAIL, `backfillBatch` undefined.

- [ ] **Step 3: Implementation**

Ajouter à `convex/promotions.ts` (fusionner `action` et `internal` dans les imports) :

```ts
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { parseGhlTags } from "./model/promotions";

function contactIdFromPayload(p: Record<string, unknown>): string | undefined {
  const contact = (p.contact ?? {}) as Record<string, unknown>;
  for (const value of [p.contact_id, p.contactId, contact.id, p.id]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export const backfillBatch = internalMutation({
  args: { promotionId: v.id("promotions"), after: v.number(), batch: v.number() },
  handler: async (ctx, args) => {
    const promo = await ctx.db.get(args.promotionId);
    if (!promo) throw new Error("Promotion introuvable.");
    const from = Math.max(args.after, promo.startAt - 1);
    const events = await ctx.db
      .query("webhookEvents")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", from).lte("_creationTime", promo.endAt))
      .order("asc")
      .take(args.batch);
    let attached = 0;
    let cursor = from;
    for (const ev of events) {
      cursor = ev._creationTime;
      if (ev.provider !== "ghl") continue;
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(ev.payload) as Record<string, unknown>; } catch { continue; }
      const tags = parseGhlTags(payload.tags ?? (payload.contact as Record<string, unknown> | undefined)?.tags);
      const contactId = contactIdFromPayload(payload);
      if (tags.length === 0 || !contactId) continue;
      const lead = await findLeadByGhlContact(ctx, contactId);
      if (!lead || lead.deletedAt !== undefined) continue;
      const r = await applyTagsToLead(ctx, lead._id, tags, ev._creationTime);
      if (r.attached) attached++;
    }
    return { scanned: events.length, attached, cursor, done: events.length < args.batch };
  },
});

export const backfill = action({
  args: { promotionId: v.id("promotions") },
  handler: async (ctx, args): Promise<{ scanned: number; attached: number }> => {
    await ctx.runQuery(internal.promotions.assertAdmin, {});
    let after = 0, scanned = 0, attached = 0;
    for (;;) {
      const r: { scanned: number; attached: number; cursor: number; done: boolean } =
        await ctx.runMutation(internal.promotions.backfillBatch, { promotionId: args.promotionId, after, batch: 100 });
      scanned += r.scanned;
      attached += r.attached;
      if (r.done) break;
      after = r.cursor;
    }
    return { scanned, attached };
  },
});

export const assertAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, ["admin"]);
    return { userId: user._id };
  },
});
```

(`internalQuery` à ajouter à l'import `./_generated/server`.)

- [ ] **Step 4: Run tests**

Run: `cd ~/backend_convex && npx convex codegen && npx vitest run convex/promotions_attach.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/backend_convex
git add convex/promotions.ts convex/promotions_attach.test.ts convex/_generated
git commit -m "feat(promotions): rattrapage des tags depuis les webhooks stockés

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Anciens leads par statut (aperçu + rattachement)

**Files:**
- Modify: `convex/promotions.ts`
- Test: `convex/promotions_legacy.test.ts`

**Interfaces:**
- Consumes : Task 1 (`legacyRejectReason`, `promotionStatus`), `OPEN_RDV_STATUSES` de `convex/rdv.ts:18`.
- Produces :
  - `api.promotions.previewLegacy({ promotionId, now }): { eligible: number; byStatus: Record<string, number>; skipped: number }`
  - `api.promotions.attachLegacy({ promotionId }): { scanned: number; attached: number; skipped: number }`
  - `internal.promotions.attachLegacyBatch({ promotionId, status, cursor, now }): { scanned; attached; skipped; cursor; done }`

- [ ] **Step 1: Write the failing test**

```ts
// convex/promotions_legacy.test.ts
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

describe("anciens leads par statut", () => {
  it("aperçu puis rattachement : statuts ciblés, exclusions, statut inchangé, idempotent", async () => {
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    const now = Date.now();
    const promoId = await t.run((ctx) => ctx.db.insert("promotions", {
      name: "BF", startAt: now - 3_600_000, endAt: now + 7 * 86_400_000,
      legacyStatuses: ["perdu", "relance"], archived: false, createdBy: admin, createdAt: now,
    }));
    const ids = await t.run(async (ctx) => {
      const ok1 = await ctx.db.insert("leads", { source: "ghl", status: "perdu", createdAt: 10 });
      const ok2 = await ctx.db.insert("leads", { source: "ghl", status: "relance", createdAt: 20 });
      const horsStatut = await ctx.db.insert("leads", { source: "ghl", status: "nouveau", createdAt: 30 });
      const supprime = await ctx.db.insert("leads", { source: "ghl", status: "perdu", createdAt: 40, deletedAt: 1 });
      const avecRdv = await ctx.db.insert("leads", { source: "ghl", status: "perdu", createdAt: 50 });
      await ctx.db.insert("rdv", { leadId: avecRdv, scheduledAt: now + 86_400_000, locationType: "domicile", status: "planifie" });
      const rdvPasse = await ctx.db.insert("leads", { source: "ghl", status: "relance", createdAt: 60 });
      await ctx.db.insert("rdv", { leadId: rdvPasse, scheduledAt: now - 86_400_000, locationType: "domicile", status: "planifie" });
      return { ok1, ok2, horsStatut, supprime, avecRdv, rdvPasse };
    });
    const as = asUser(t, admin);
    const preview = await as.query(api.promotions.previewLegacy, { promotionId: promoId, now });
    expect(preview).toEqual({ eligible: 3, byStatus: { perdu: 1, relance: 2 }, skipped: 2 });

    const first = await as.action(api.promotions.attachLegacy, { promotionId: promoId });
    expect(first).toMatchObject({ attached: 3 });
    const second = await as.action(api.promotions.attachLegacy, { promotionId: promoId });
    expect(second.attached).toBe(0);

    const ok1 = await t.run((ctx) => ctx.db.get(ids.ok1));
    expect(ok1).toMatchObject({ promotionId: promoId, promotionSource: "statut", status: "perdu" });
    expect((await t.run((ctx) => ctx.db.get(ids.avecRdv)))?.promotionId).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(ids.horsStatut)))?.promotionId).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(ids.rdvPasse)))?.promotionId).toBe(promoId);
  });

  it("refusé sur une promo terminée et pour un setter", async () => {
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    const setter = await insertUser(t, { role: "setter", email: "s@x.fr" });
    const promoId = await t.run((ctx) => ctx.db.insert("promotions", {
      name: "Vieille", startAt: 0, endAt: 1000, legacyStatuses: ["perdu"], archived: false, createdBy: admin, createdAt: 0,
    }));
    await expect(asUser(t, admin).action(api.promotions.attachLegacy, { promotionId: promoId })).rejects.toThrow(/terminée/);
    await expect(asUser(t, setter).action(api.promotions.attachLegacy, { promotionId: promoId })).rejects.toThrow(/Accès refusé/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/backend_convex && npx vitest run convex/promotions_legacy.test.ts`
Expected: FAIL, `previewLegacy` undefined.

- [ ] **Step 3: Implementation**

Ajouter à `convex/promotions.ts` :

```ts
import type { QueryCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { OPEN_RDV_STATUSES } from "./rdv";
import { legacyRejectReason } from "./model/promotions";

async function hasUpcomingRdv(ctx: QueryCtx, leadId: Id<"leads">, now: number): Promise<boolean> {
  const rows = await ctx.db.query("rdv").withIndex("by_lead", (q) => q.eq("leadId", leadId)).collect();
  return rows.some(
    (r) => r.deletedAt === undefined
      && (OPEN_RDV_STATUSES as readonly string[]).includes(r.status)
      && (r.scheduledAt ?? 0) > now,
  );
}

async function legacyReason(ctx: QueryCtx, lead: Doc<"leads">, promo: Doc<"promotions">, now: number) {
  return legacyRejectReason({
    status: lead.status,
    arrivedAt: lead.createdAt ?? lead._creationTime,
    deletedAt: lead.deletedAt,
    promotionId: lead.promotionId,
    hasUpcomingRdv: await hasUpcomingRdv(ctx, lead._id, now),
  }, promo);
}

export const previewLegacy = query({
  args: { promotionId: v.id("promotions"), now: v.number() },
  handler: async (ctx, { promotionId, now }) => {
    await requireRole(ctx, ["admin"]);
    const promo = await ctx.db.get(promotionId);
    if (!promo) throw new Error("Promotion introuvable.");
    const byStatus: Record<string, number> = {};
    let eligible = 0, skipped = 0;
    for (const status of promo.legacyStatuses ?? []) {
      const leads = await ctx.db.query("leads").withIndex("by_status_createdAt", (q) => q.eq("status", status)).collect();
      for (const lead of leads) {
        const reason = await legacyReason(ctx, lead, promo, now);
        if (reason === null) { eligible++; byStatus[status] = (byStatus[status] ?? 0) + 1; }
        else if (reason !== "statut" && reason !== "periode") skipped++;
      }
    }
    return { eligible, byStatus, skipped };
  },
});

export const attachLegacyBatch = internalMutation({
  args: {
    promotionId: v.id("promotions"),
    status: leadStatusValidator,
    cursor: v.union(v.string(), v.null()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const promo = await ctx.db.get(args.promotionId);
    if (!promo) throw new Error("Promotion introuvable.");
    const page = await ctx.db
      .query("leads")
      .withIndex("by_status_createdAt", (q) => q.eq("status", args.status))
      .paginate({ numItems: 200, cursor: args.cursor });
    let attached = 0, skipped = 0;
    for (const lead of page.page) {
      const reason = await legacyReason(ctx, lead, promo, args.now);
      if (reason === null) {
        await ctx.db.patch(lead._id, { promotionId: promo._id, promotionJoinedAt: args.now, promotionSource: "statut" });
        attached++;
      } else if (reason !== "statut" && reason !== "periode") {
        skipped++;
      }
    }
    if (attached > 0) {
      await logActivity(ctx, {
        fallbackSource: "Promotions",
        action: "promotion.legacy_attached", entityType: "promotion", entityId: promo._id, subject: promo.name,
        summary: `a rattaché ${attached} ancien(s) lead(s) « ${args.status} » à la promotion « ${promo.name} »`,
      });
    }
    return { scanned: page.page.length, attached, skipped, cursor: page.continueCursor, done: page.isDone };
  },
});

export const attachLegacy = action({
  args: { promotionId: v.id("promotions") },
  handler: async (ctx, { promotionId }): Promise<{ scanned: number; attached: number; skipped: number }> => {
    await ctx.runQuery(internal.promotions.assertAdmin, {});
    const now = Date.now();
    const promo = await ctx.runQuery(internal.promotions.getInternal, { id: promotionId });
    if (!promo) throw new Error("Promotion introuvable.");
    if (promotionStatus(promo, now) === "terminee") throw new Error("Promotion terminée : rattachement impossible.");
    let scanned = 0, attached = 0, skipped = 0;
    for (const status of promo.legacyStatuses ?? []) {
      let cursor: string | null = null;
      for (;;) {
        const r: { scanned: number; attached: number; skipped: number; cursor: string; done: boolean } =
          await ctx.runMutation(internal.promotions.attachLegacyBatch, { promotionId, status, cursor, now });
        scanned += r.scanned; attached += r.attached; skipped += r.skipped;
        if (r.done) break;
        cursor = r.cursor;
      }
    }
    return { scanned, attached, skipped };
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("promotions") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});
```

Note : `paginationOptsValidator` n'est pas utilisé, ne pas l'importer. Dans `legacyReason`, `ctx` est un `QueryCtx`. Un `MutationCtx` est accepté là où un `QueryCtx` est attendu (sous-type), donc `attachLegacyBatch` peut l'appeler.

- [ ] **Step 4: Run tests**

Run: `cd ~/backend_convex && npx convex codegen && npx vitest run convex/promotions_legacy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/backend_convex
git add convex/promotions.ts convex/promotions_legacy.test.ts convex/_generated
git commit -m "feat(promotions): anciens leads par statut (aperçu + rattachement)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: RDV au bureau (backend : création + synchro)

**Files:**
- Modify: `convex/promotions.ts` (ajout de `officeCalendarForBooking`, `officeCalendars`)
- Modify: `convex/ghlAppointments.ts:152-232` (`finalizeAppointment`), `:240-260` (`createAppointment`), titre de l'appointment
- Modify: `convex/ghlCalendar.ts:329-355` (`loadEventsImpl`), `:236-246` (insert de `persistGhlEvents`)
- Test: `convex/promotions_office.test.ts`

**Interfaces:**
- Consumes : Task 2 (schéma, `promotionStatus`).
- Produces :
  - `internal.promotions.officeCalendarForBooking({ calendarId, now }): { promotionId: Id<"promotions">; officeAddress?: string } | null`
  - `internal.promotions.officeCalendars({ now }): { calendarId: string; promotionId: Id<"promotions"> }[]`, où `now` est utilisé pour une fenêtre [now − 3 j ; ∞)
  - `finalizeAppointment` accepte `promotionId?: Id<"promotions">` et le pose sur le RDV créé.
  - `createAppointment({ locationType: "agence", calendarId, sector: "Bureau", … })` : refus si `calendarId` n'est pas le calendrier bureau d'une promo en cours.

- [ ] **Step 1: Write the failing test**

```ts
// convex/promotions_office.test.ts
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function seed(t: ReturnType<typeof makeT>, now: number) {
  const admin = await insertUser(t, { role: "admin" });
  return await t.run((ctx) => ctx.db.insert("promotions", {
    name: "BF", tag: "bf", tagKey: "bf", startAt: now - 3_600_000, endAt: now + 3_600_000,
    officeCalendarId: "CAL_BUREAU", officeAddress: "45 rue ruisseaux des noirs, Saint-Denis",
    archived: false, createdBy: admin, createdAt: now,
  }));
}

describe("RDV bureau", () => {
  it("officeCalendarForBooking : promo en cours seulement", async () => {
    const t = makeT();
    const now = Date.now();
    const promoId = await seed(t, now);
    expect(await t.query(internal.promotions.officeCalendarForBooking, { calendarId: "CAL_BUREAU", now }))
      .toMatchObject({ promotionId: promoId });
    expect(await t.query(internal.promotions.officeCalendarForBooking, { calendarId: "AUTRE", now })).toBeNull();
    expect(await t.query(internal.promotions.officeCalendarForBooking, { calendarId: "CAL_BUREAU", now: now + 7_200_000 })).toBeNull();
  });

  it("finalizeAppointment pose agence + promotionId sur le RDV", async () => {
    const t = makeT();
    const now = Date.now();
    const promoId = await seed(t, now);
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", createdAt: now }));
    const { rdvId } = await t.mutation(internal.ghlAppointments.finalizeAppointment, {
      leadId, contactId: "ghl-x", appointmentId: "appt-1", scheduledAt: now + 86_400_000,
      locationType: "agence", promotionId: promoId,
    });
    const rdv = await t.run((ctx) => ctx.db.get(rdvId));
    expect(rdv).toMatchObject({ locationType: "agence", promotionId: promoId });
  });

  it("createAppointment en agence avec un calendrier non autorisé est refusé avant tout appel GHL", async () => {
    process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "x";
    process.env.GHL_LOCATION_ID = "loc";
    const t = makeT();
    const now = Date.now();
    await seed(t, now);
    const setter = await insertUser(t, { role: "setter", email: "s@x.fr" });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", createdAt: now }));
    await expect(asUser(t, setter).action(api.ghlAppointments.createAppointment, {
      leadId, sector: "Bureau", calendarId: "CAL_PIRATE", scheduledAt: now + 86_400_000, locationType: "agence",
    })).rejects.toThrow(/calendrier bureau/i);
    delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
    delete process.env.GHL_LOCATION_ID;
  });
});
```

Vérifier dans `convex/ghlClient.ts` le nom exact de la variable lue par `isGhlConfigured()` (`GHL_PRIVATE_INTEGRATION_TOKEN` ou `GHL_API_KEY`). Le test de `http_ghl_debrief` supprime les deux. Adapter le test si nécessaire.

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/backend_convex && npx vitest run convex/promotions_office.test.ts`
Expected: FAIL, `officeCalendarForBooking` undefined.

- [ ] **Step 3: Queries internes**

Ajouter à `convex/promotions.ts` :

```ts
export const officeCalendarForBooking = internalQuery({
  args: { calendarId: v.string(), now: v.number() },
  handler: async (ctx, { calendarId, now }) => {
    const rows = await ctx.db.query("promotions").withIndex("by_endAt", (q) => q.gte("endAt", now)).collect();
    const promo = rows.find((p) => p.officeCalendarId === calendarId && promotionStatus(p, now) === "en_cours");
    return promo ? { promotionId: promo._id, officeAddress: promo.officeAddress } : null;
  },
});

/** Calendriers bureau à synchroniser (promos pas finies depuis plus de 3 jours). */
export const officeCalendars = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const rows = await ctx.db.query("promotions").withIndex("by_endAt", (q) => q.gte("endAt", now - 3 * 86_400_000)).collect();
    return rows
      .filter((p) => !p.archived && p.officeCalendarId)
      .map((p) => ({ calendarId: p.officeCalendarId as string, promotionId: p._id }));
  },
});
```

- [ ] **Step 4: ghlAppointments.ts**

Dans `finalizeAppointment.args`, ajouter `promotionId: v.optional(v.id("promotions")),`. Dans l'`insert("rdv", {...})`, ajouter `...(args.promotionId ? { promotionId: args.promotionId } : {}),`. Dans le `patch(open._id, {...})`, ajouter `...(args.locationType ? { locationType: args.locationType } : {}), ...(args.promotionId ? { promotionId: args.promotionId } : {}),`.

Dans `createAppointment.handler`, juste après `if (!isGhlConfigured()) throw ...`, remplacer le calcul de `calendarId` par :

```ts
    // RDV au bureau : uniquement sur le calendrier bureau d'une promo en cours
    // (jamais un calendrier arbitraire envoyé par le navigateur).
    let office: { promotionId: Id<"promotions">; officeAddress?: string } | null = null;
    if (args.locationType === "agence") {
      if (!args.calendarId) throw new Error("Calendrier bureau manquant.");
      office = await ctx.runQuery(internal.promotions.officeCalendarForBooking, { calendarId: args.calendarId, now: Date.now() });
      if (!office) throw new Error("Ce calendrier bureau n'est rattaché à aucune promotion en cours.");
    }
    const calendarId =
      args.calendarId || calendarIdForSector(parseSectorCalendars(process.env.GHL_SECTOR_CALENDARS), args.sector);
```

Ajouter `Id` à l'import `import { Doc } from "./_generated/dataModel";`, qui devient `import { Doc, Id } from "./_generated/dataModel";`.

Dans le titre de l'appointment GHL, remplacer `` title: `RDV ECOI ${args.sector}${name ...` `` par :

```ts
        title: `${office ? "RDV BUREAU ECOI" : `RDV ECOI ${args.sector}`}${name ? ` — ${name}` : ""}${reachInfo ? ` — ${reachInfo}` : ""}`,
        ...(office?.officeAddress ? { address: office.officeAddress } : {}),
```

Dans l'appel `finalizeAppointment` (étape 5), ajouter :

```ts
      ...(office ? { promotionId: office.promotionId } : {}),
```

Le test vérifie que le refus arrive **avant** tout appel GHL : le bloc `office` doit rester placé avant `requireGhlLocationId()` et avant l'upsert du contact.

- [ ] **Step 5: Synchro calendrier (ghlCalendar.ts)**

Dans `loadEventsImpl`, remplacer `const calendars = calendarsForEvents(sectorsFromEnv(), dto);` par :

```ts
  const sectorCalendars = calendarsForEvents(sectorsFromEnv(), dto);
  // Calendriers bureau des promotions : synchronisés aussi (commercial attribué
  // par GHL parmi les membres du calendrier), sauf requête ciblée.
  const officeCalendars = dto.calendarId || dto.sector
    ? []
    : (await ctx.runQuery(internal.promotions.officeCalendars, { now: Date.now() }))
        .map((c) => ({ sector: "Bureau", calendarId: c.calendarId, label: "Bureau" }));
  const calendars = [...sectorCalendars, ...officeCalendars.filter((o) => !sectorCalendars.some((s) => s.calendarId === o.calendarId))];
```

Dans `persistGhlEvents`, insert d'un nouveau RDV : remplacer `locationType: "domicile",` par `locationType: event.sector === "Bureau" ? "agence" : "domicile",`.

Ajouter `import { internal } from "./_generated/api";` s'il n'y est pas déjà (il y est : `internal.ghlCalendar.viewerInfo` est utilisé).

- [ ] **Step 6: Run tests (nouveaux + synchro existante)**

Run: `cd ~/backend_convex && npx convex codegen && npx vitest run convex/promotions_office.test.ts convex/ghlcalendar_sync.test.ts convex/ghlAppointments*.test.ts`
Expected: PASS. Si `ghlcalendar_sync.test.ts` stubbe `ghlRequest`, l'appel `officeCalendars` renvoie `[]` sans promo en base : aucun changement de comportement.

- [ ] **Step 7: Commit**

```bash
cd ~/backend_convex
git add convex/promotions.ts convex/ghlAppointments.ts convex/ghlCalendar.ts convex/promotions_office.test.ts convex/_generated
git commit -m "feat(promotions): RDV au bureau (calendrier promo, agence, synchro)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Chiffres d'une promotion

**Files:**
- Modify: `convex/promotions.ts`
- Test: `convex/promotions_stats.test.ts`

**Interfaces:**
- Consumes : schéma (index `leads.by_promotion`, `rdv.by_promotion`, `callLogs` par lead).
- Produces :
  - `api.promotions.stats({ promotionId }): PromotionStats`
  - `PromotionStats = { nouveaux: StatBlock; anciens: StatBlock; rdvBureauHorsPromo: number }`
  - `StatBlock = { leads: number; joints: number; rdvDomicile: number; rdvBureau: number; qualifies: number; signes: number }`

Définitions alignées sur l'existant :
- **joint** = au moins un `callLogs` avec `result === "joint"` ;
- **qualifié** = statut dans `qualifie`, `rdv_pris`, `rdv_honore`, `signature_en_cours`, `signe` ;
- **signé** = statut `signe` ;
- **RDV** = RDV non supprimé, comptés par `locationType`.

Vérifier le nom de l'index `callLogs` par lead dans `convex/schema.ts:433` (`by_lead` attendu) avant d'écrire le code.

- [ ] **Step 1: Write the failing test**

```ts
// convex/promotions_stats.test.ts
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

describe("promotions.stats", () => {
  it("sépare nouveaux/anciens et domicile/bureau", async () => {
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    const setter = await insertUser(t, { role: "setter", email: "s@x.fr" });
    const promoId = await t.run((ctx) => ctx.db.insert("promotions", {
      name: "BF", tag: "bf", tagKey: "bf", startAt: 0, endAt: Date.now() + 1e9, archived: false, createdBy: admin, createdAt: 0,
    }));
    await t.run(async (ctx) => {
      const n1 = await ctx.db.insert("leads", { source: "ghl", status: "signe", promotionId: promoId, promotionSource: "tag" });
      await ctx.db.insert("leads", { source: "ghl", status: "nouveau", promotionId: promoId, promotionSource: "tag" });
      const a1 = await ctx.db.insert("leads", { source: "ghl", status: "qualifie", promotionId: promoId, promotionSource: "statut" });
      const hors = await ctx.db.insert("leads", { source: "ghl", status: "qualifie" });
      await ctx.db.insert("callLogs", { leadId: n1, setterId: setter, result: "joint" } as never);
      await ctx.db.insert("rdv", { leadId: n1, locationType: "domicile", status: "planifie", promotionId: promoId });
      await ctx.db.insert("rdv", { leadId: a1, locationType: "agence", status: "planifie", promotionId: promoId });
      await ctx.db.insert("rdv", { leadId: hors, locationType: "agence", status: "planifie", promotionId: promoId });
    });
    const s = await asUser(t, admin).query(api.promotions.stats, { promotionId: promoId });
    expect(s.nouveaux).toEqual({ leads: 2, joints: 1, rdvDomicile: 1, rdvBureau: 0, qualifies: 1, signes: 1 });
    expect(s.anciens).toEqual({ leads: 1, joints: 0, rdvDomicile: 0, rdvBureau: 1, qualifies: 1, signes: 0 });
    expect(s.rdvBureauHorsPromo).toBe(1);
  });
});
```

Adapter le `callLogs` inséré aux champs **requis** de la table (`convex/schema.ts:433`). Le `as never` couvre seulement le typage : convex-test valide le schéma à l'exécution.

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/backend_convex && npx vitest run convex/promotions_stats.test.ts`
Expected: FAIL, `stats` undefined.

- [ ] **Step 3: Implementation**

```ts
const QUALIFIED = new Set(["qualifie", "rdv_pris", "rdv_honore", "signature_en_cours", "signe"]);

type StatBlock = { leads: number; joints: number; rdvDomicile: number; rdvBureau: number; qualifies: number; signes: number };
const emptyBlock = (): StatBlock => ({ leads: 0, joints: 0, rdvDomicile: 0, rdvBureau: 0, qualifies: 0, signes: 0 });

export const stats = query({
  args: { promotionId: v.id("promotions") },
  handler: async (ctx, { promotionId }) => {
    await requireRole(ctx, ["admin"]);
    const nouveaux = emptyBlock();
    const anciens = emptyBlock();
    const leads = await ctx.db.query("leads").withIndex("by_promotion", (q) => q.eq("promotionId", promotionId)).collect();
    const inPromo = new Set<string>();
    for (const lead of leads) {
      if (lead.deletedAt !== undefined) continue;
      inPromo.add(lead._id);
      const block = lead.promotionSource === "statut" ? anciens : nouveaux;
      block.leads++;
      if (QUALIFIED.has(lead.status)) block.qualifies++;
      if (lead.status === "signe") block.signes++;
      const calls = await ctx.db.query("callLogs").withIndex("by_lead", (q) => q.eq("leadId", lead._id)).collect();
      if (calls.some((c) => c.result === "joint")) block.joints++;
      const rdvs = await ctx.db.query("rdv").withIndex("by_lead", (q) => q.eq("leadId", lead._id)).collect();
      for (const r of rdvs) {
        if (r.deletedAt !== undefined) continue;
        if (r.locationType === "agence") block.rdvBureau++;
        else block.rdvDomicile++;
      }
    }
    const promoRdvs = await ctx.db.query("rdv").withIndex("by_promotion", (q) => q.eq("promotionId", promotionId)).collect();
    const rdvBureauHorsPromo = promoRdvs.filter(
      (r) => r.deletedAt === undefined && r.locationType === "agence" && !inPromo.has(r.leadId),
    ).length;
    return { nouveaux, anciens, rdvBureauHorsPromo };
  },
});
```

- [ ] **Step 4: Run tests**

Run: `cd ~/backend_convex && npx convex codegen && npx vitest run convex/promotions_stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Full backend suite + typecheck, then commit**

Run: `cd ~/backend_convex && npx vitest run convex && npx tsc --noEmit -p convex`
Expected: tout passe. Les échecs qui existaient déjà avant ce chantier doivent être signalés, pas masqués.

```bash
cd ~/backend_convex
git add convex/promotions.ts convex/promotions_stats.test.ts convex/_generated
git commit -m "feat(promotions): chiffres par promo (nouveaux/anciens, domicile/bureau)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Couche de données front (types, mapping, hooks, helpers purs)

**Files:**
- Modify: `frontend/src/lib/types.ts` (type `LeadResponse`, vers la l.106)
- Modify: `frontend/src/lib/convexApi.ts` (type `ConvexLeadDoc`, l.31-70)
- Modify: `frontend/src/lib/convexMappers.ts` (`mapConvexLead`, l.66-100)
- Create: `frontend/src/lib/promotions.ts`, `frontend/src/lib/promotionsApi.ts`
- Test: `frontend/src/lib/promotions.test.ts`

**Interfaces:**
- Consumes : API Convex des Tasks 2 à 7 (noms `promotions:*`).
- Produces :
  - `LeadResponse.promotionId: string | null`
  - `LeadResponse.promotionSource: 'tag' | 'statut' | null`
  - `type ActivePromotion = { _id: string; name: string; startAt: number; endAt: number; offer?: string; pitch?: string; officeCalendarId?: string; officeAddress?: string }`
  - `activePromotionIds(promos: ActivePromotion[]): Set<string>`
  - `isInActivePromotion(lead, ids): boolean`
  - `withoutActivePromotionLeads<T>(leads: T[], ids): T[]`
  - `promotionLeads<T>(leads: T[], promotionId, source: 'all' | 'tag' | 'statut'): T[]`
  - `formatPromotionRange(startAt, endAt): string`, ex. « du 23 au 29 nov. »
  - `officePromotion(promos): ActivePromotion | undefined`
  - hooks `useActivePromotions(): ActivePromotion[]`, `usePromotionsList()`, `usePromotionStats(id)`, `useLegacyPreview(id)` ;
  - fonctions `createPromotion`, `updatePromotion`, `archivePromotion`, `attachLegacy`, `backfillPromotion`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/promotions.test.ts
import { describe, expect, it } from 'vitest'
import {
  activePromotionIds, formatPromotionRange, isInActivePromotion, officePromotion,
  promotionLeads, withoutActivePromotionLeads, type ActivePromotion,
} from './promotions'

const promo: ActivePromotion = { _id: 'p1', name: 'Black Friday', startAt: Date.parse('2026-11-22T20:00:00Z'), endAt: Date.parse('2026-11-29T19:59:59.999Z') }
const leads = [
  { id: 'a', promotionId: 'p1', promotionSource: 'tag' as const },
  { id: 'b', promotionId: 'p1', promotionSource: 'statut' as const },
  { id: 'c', promotionId: 'old', promotionSource: 'tag' as const },
  { id: 'd', promotionId: null, promotionSource: null },
]

describe('promotions helpers', () => {
  it('exclut seulement les leads des promos en cours', () => {
    const ids = activePromotionIds([promo])
    expect(withoutActivePromotionLeads(leads, ids).map((l) => l.id)).toEqual(['c', 'd'])
    expect(isInActivePromotion(leads[0], ids)).toBe(true)
    expect(isInActivePromotion(leads[2], ids)).toBe(false)
  })
  it('promo archivée/terminée (absente des actives) → leads réintégrés', () => {
    expect(withoutActivePromotionLeads(leads, activePromotionIds([]))).toHaveLength(4)
  })
  it('filtre nouveaux / anciens', () => {
    expect(promotionLeads(leads, 'p1', 'all').map((l) => l.id)).toEqual(['a', 'b'])
    expect(promotionLeads(leads, 'p1', 'tag').map((l) => l.id)).toEqual(['a'])
    expect(promotionLeads(leads, 'p1', 'statut').map((l) => l.id)).toEqual(['b'])
  })
  it('dates en heure de la Réunion', () => {
    expect(formatPromotionRange(promo.startAt, promo.endAt)).toBe('du 23 au 29 nov.')
  })
  it('officePromotion : la promo qui a un calendrier bureau', () => {
    expect(officePromotion([promo])).toBeUndefined()
    expect(officePromotion([{ ...promo, officeCalendarId: 'cal' }])?._id).toBe('p1')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/backend_convex/frontend && npx vitest run src/lib/promotions.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3: Helpers purs**

```ts
// frontend/src/lib/promotions.ts
// Helpers purs de l'onglet Promotion : exclusion des leads d'une promo en
// cours des onglets habituels, filtre nouveaux/anciens, libellés de dates
// (heure de la Réunion, quel que soit le fuseau du navigateur).

export type ActivePromotion = {
  _id: string
  name: string
  startAt: number
  endAt: number
  offer?: string
  pitch?: string
  officeCalendarId?: string
  officeAddress?: string
}

type PromoLead = { promotionId?: string | null; promotionSource?: 'tag' | 'statut' | null }

export function activePromotionIds(promos: ActivePromotion[]): Set<string> {
  return new Set(promos.map((p) => p._id))
}

export function isInActivePromotion(lead: PromoLead, ids: Set<string>): boolean {
  return Boolean(lead.promotionId && ids.has(lead.promotionId))
}

export function withoutActivePromotionLeads<T extends PromoLead>(leads: T[], ids: Set<string>): T[] {
  if (ids.size === 0) return leads
  return leads.filter((l) => !isInActivePromotion(l, ids))
}

export function promotionLeads<T extends PromoLead>(leads: T[], promotionId: string, source: 'all' | 'tag' | 'statut'): T[] {
  return leads.filter((l) => l.promotionId === promotionId && (source === 'all' || l.promotionSource === source))
}

export function officePromotion(promos: ActivePromotion[]): ActivePromotion | undefined {
  return promos.find((p) => Boolean(p.officeCalendarId))
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const REUNION_OFFSET_MS = 4 * 3_600_000

function reunionParts(ms: number) {
  const d = new Date(ms + REUNION_OFFSET_MS)
  return { day: d.getUTCDate(), month: d.getUTCMonth() }
}

export function formatPromotionRange(startAt: number, endAt: number): string {
  const a = reunionParts(startAt)
  const b = reunionParts(endAt)
  return a.month === b.month
    ? `du ${a.day} au ${b.day} ${MONTHS[b.month]}`
    : `du ${a.day} ${MONTHS[a.month]} au ${b.day} ${MONTHS[b.month]}`
}

/** ms → "YYYY-MM-DD" du jour Réunion (pré-remplissage du formulaire). */
export function reunionDayInput(ms: number): string {
  return new Date(ms + REUNION_OFFSET_MS).toISOString().slice(0, 10)
}
```

- [ ] **Step 4: Champs du lead**

- `frontend/src/lib/types.ts`, dans `LeadResponse`, après `resubmittedAt: string | null` :

```ts
  /** Promotion de rattachement (Black Friday…), null sinon. */
  promotionId?: string | null
  /** Origine du rattachement : tag GHL (nouveaux) ou ciblage par statut (anciens). */
  promotionSource?: 'tag' | 'statut' | null
```

- `frontend/src/lib/convexApi.ts`, dans `ConvexLeadDoc`, après `resubmittedAt?: number` :

```ts
  promotionId?: string
  promotionSource?: 'tag' | 'statut'
```

- `frontend/src/lib/convexMappers.ts`, dans `mapConvexLead`, après `resubmittedAt: iso(doc.resubmittedAt),` :

```ts
    promotionId: doc.promotionId ?? null,
    promotionSource: doc.promotionSource ?? null,
```

- [ ] **Step 5: Références Convex + hooks**

```ts
// frontend/src/lib/promotionsApi.ts
// Accès Convex de l'onglet Promotion. `now` est figé par session
// (useSessionNow) : la liste « en cours » ne boucle pas à chaque rendu.
import { useQuery } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { convexClient } from './convexClient'
import { useSessionNow } from './convexHooks'
import type { ActivePromotion } from './promotions'

export type PromotionStatus = 'a_venir' | 'en_cours' | 'terminee'
export type PromotionRow = ActivePromotion & {
  tag?: string
  legacyStatuses?: string[]
  legacyArrivedFrom?: number
  legacyArrivedTo?: number
  archived: boolean
  status: PromotionStatus
}
export type PromotionInput = {
  name: string; tag?: string; startDay: string; endDay: string; offer?: string; pitch?: string
  officeCalendarId?: string; officeAddress?: string; legacyStatuses?: string[]
  legacyArrivedFromDay?: string; legacyArrivedToDay?: string
}
export type StatBlock = { leads: number; joints: number; rdvDomicile: number; rdvBureau: number; qualifies: number; signes: number }
export type PromotionStats = { nouveaux: StatBlock; anciens: StatBlock; rdvBureauHorsPromo: number }
export type LegacyPreview = { eligible: number; byStatus: Record<string, number>; skipped: number }

const refs = {
  active: makeFunctionReference<'query', { now: number }, ActivePromotion[]>('promotions:active'),
  list: makeFunctionReference<'query', { now: number }, PromotionRow[]>('promotions:list'),
  stats: makeFunctionReference<'query', { promotionId: string }, PromotionStats>('promotions:stats'),
  previewLegacy: makeFunctionReference<'query', { promotionId: string; now: number }, LegacyPreview>('promotions:previewLegacy'),
  create: makeFunctionReference<'mutation', PromotionInput, string>('promotions:create'),
  update: makeFunctionReference<'mutation', PromotionInput & { id: string }, null>('promotions:update'),
  archive: makeFunctionReference<'mutation', { id: string }, null>('promotions:archive'),
  attachLegacy: makeFunctionReference<'action', { promotionId: string }, { scanned: number; attached: number; skipped: number }>('promotions:attachLegacy'),
  backfill: makeFunctionReference<'action', { promotionId: string }, { scanned: number; attached: number }>('promotions:backfill'),
}

export function useActivePromotions(): ActivePromotion[] {
  const now = useSessionNow()
  return useQuery(refs.active, { now }) ?? []
}
export function usePromotionsList(): PromotionRow[] | undefined {
  const now = useSessionNow()
  return useQuery(refs.list, { now })
}
export function usePromotionStats(promotionId: string | null): PromotionStats | undefined {
  return useQuery(refs.stats, promotionId ? { promotionId } : 'skip')
}
export function useLegacyPreview(promotionId: string | null): LegacyPreview | undefined {
  const now = useSessionNow()
  return useQuery(refs.previewLegacy, promotionId ? { promotionId, now } : 'skip')
}

function client() {
  if (!convexClient) throw new Error('Convex non configuré.')
  return convexClient
}
export const createPromotion = (input: PromotionInput) => client().mutation(refs.create, input)
export const updatePromotion = (id: string, input: PromotionInput) => client().mutation(refs.update, { id, ...input })
export const archivePromotion = (id: string) => client().mutation(refs.archive, { id })
export const attachLegacy = (promotionId: string) => client().action(refs.attachLegacy, { promotionId })
export const backfillPromotion = (promotionId: string) => client().action(refs.backfill, { promotionId })
```

Vérifier le chemin réel de `convexClient` : `grep -rn "export const convexClient\|export let convexClient" frontend/src/lib`. Il est importé par `lib/hooks.ts`. Vérifier aussi que `useSessionNow` (`convexHooks.ts:89`) renvoie bien un nombre stable. **Attention :** si `useSessionNow` est figé pour toute la session, une promo qui démarre pendant que la page est ouverte n'apparaît qu'au rechargement. C'est acceptable pour le Black Friday, mais il faut le dire dans le rapport de tâche.

- [ ] **Step 6: Run tests + typecheck**

Run: `cd ~/backend_convex/frontend && npx vitest run src/lib/promotions.test.ts && npx tsc --noEmit`
Expected: PASS, aucune erreur TS.

- [ ] **Step 7: Commit**

```bash
cd ~/backend_convex
git add frontend/src/lib/promotions.ts frontend/src/lib/promotions.test.ts frontend/src/lib/promotionsApi.ts frontend/src/lib/types.ts frontend/src/lib/convexApi.ts frontend/src/lib/convexMappers.ts
git commit -m "feat(promotions): couche données front (types, hooks, helpers)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Onglet Promotion côté setter (exclusion, bandeau, filtre, badge)

**Files:**
- Create: `frontend/src/components/promotions/PromotionBanner.tsx`
- Modify: `frontend/src/pages/leads/LeadsList.tsx` :
  - `SetterFilter` (l.178) ;
  - `SETTER_STATUS_FILTERS` (l.191-199) ;
  - `LeadsSetter` (l.203-500) ;
  - `filterSetterLeadsByStatus` (l.922-939) ;
  - type des `statusFilters` de `LeadsRail` (l.1323-1342).
- Test: `frontend/src/lib/promotions.test.ts` (déjà couvert par la Task 8) + test de rendu `frontend/src/components/promotions/PromotionBanner.test.tsx`

**Interfaces:**
- Consumes : Task 8 (`useActivePromotions`, `activePromotionIds`, `withoutActivePromotionLeads`, `promotionLeads`, `formatPromotionRange`).
- Produces : `<PromotionBanner promo={ActivePromotion} source={'all'|'tag'|'statut'} onSource={fn} />`, et le `SetterFilter` gagne la valeur `'promotion'`.

- [ ] **Step 1: Write the failing render test**

```tsx
// frontend/src/components/promotions/PromotionBanner.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PromotionBanner } from './PromotionBanner'

const promo = { _id: 'p1', name: 'Black Friday', startAt: Date.parse('2026-11-22T20:00:00Z'), endAt: Date.parse('2026-11-29T19:59:59.999Z'), offer: '-15 % sur les kits', pitch: 'Dire bonjour', officeCalendarId: 'cal' }

describe('PromotionBanner', () => {
  it('affiche nom, dates, offre, mention bureau ; argumentaire dépliable ; filtre source', () => {
    const onSource = vi.fn()
    render(<PromotionBanner promo={promo} source="all" onSource={onSource} />)
    expect(screen.getByText('Black Friday')).toBeInTheDocument()
    expect(screen.getByText(/du 23 au 29 nov\./)).toBeInTheDocument()
    expect(screen.getByText('-15 % sur les kits')).toBeInTheDocument()
    expect(screen.getByText(/RDV au bureau possibles/)).toBeInTheDocument()
    expect(screen.queryByText('Dire bonjour')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /argumentaire/i }))
    expect(screen.getByText('Dire bonjour')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Anciens' }))
    expect(onSource).toHaveBeenCalledWith('statut')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/backend_convex/frontend && npx vitest run src/components/promotions/PromotionBanner.test.tsx`
Expected: FAIL, module introuvable.

- [ ] **Step 3: Bandeau**

```tsx
// frontend/src/components/promotions/PromotionBanner.tsx
import { useState } from 'react'
import { formatPromotionRange, type ActivePromotion } from '../../lib/promotions'

export type PromotionSourceFilter = 'all' | 'tag' | 'statut'

const SOURCES: { key: PromotionSourceFilter; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'tag', label: 'Nouveaux' },
  { key: 'statut', label: 'Anciens' },
]

export function PromotionBanner({ promo, source, onSource }: {
  promo: ActivePromotion
  source: PromotionSourceFilter
  onSource: (s: PromotionSourceFilter) => void
}) {
  const [showPitch, setShowPitch] = useState(false)
  return (
    <div className="mx-4 sm:mx-8 mt-4 rounded-[18px] border border-or/30 bg-or-tint p-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold tracking-widest uppercase text-or-dark">Promotion en cours</div>
          <div className="font-black text-lg text-text">{promo.name}</div>
          <div className="text-xs text-muted">{formatPromotionRange(promo.startAt, promo.endAt)}</div>
        </div>
        <div className="flex gap-1">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onSource(s.key)}
              className={`pill-tab text-xs ${source === s.key ? '!bg-text !text-white' : 'bg-white border border-line text-muted'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {promo.offer && <p className="text-sm font-semibold text-text">{promo.offer}</p>}
      {promo.officeCalendarId && (
        <p className="text-xs text-or-dark">RDV au bureau possibles le vendredi et le samedi{promo.officeAddress ? ` — ${promo.officeAddress}` : ''}.</p>
      )}
      {promo.pitch && (
        <div>
          <button type="button" onClick={() => setShowPitch((v) => !v)} className="text-xs font-semibold text-or hover:underline">
            {showPitch ? 'Masquer l’argumentaire' : 'Voir l’argumentaire'}
          </button>
          {showPitch && <p className="mt-1 whitespace-pre-line text-sm text-text">{promo.pitch}</p>}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Intégration dans LeadsList.tsx (setter)**

1. Ligne 178 : `type SetterFilter = 'nouveau' | 'sans_reponse' | 'relance_ct' | 'rappel' | 'qualifie' | 'perdu' | 'relance_lt' | 'promotion'`.
2. Ligne 191 : élargir le type de `countKey` avec `| 'promotion'`. Ne **pas** ajouter l'entrée au tableau statique : elle est ajoutée dynamiquement, voir le point 5.
3. Imports en tête :

```ts
import { useActivePromotions } from '../../lib/promotionsApi'
import { activePromotionIds, promotionLeads, withoutActivePromotionLeads } from '../../lib/promotions'
import { PromotionBanner, type PromotionSourceFilter } from '../../components/promotions/PromotionBanner'
```

4. Dans `LeadsSetter`, remplacer `const categoryLeads = mine` par :

```ts
  // Promotions en cours : leurs leads ne sont QUE dans l'onglet Promotion
  // (retour automatique dans les onglets habituels à la fin de la promo).
  const activePromos = useActivePromotions()
  const activePromoIds = useMemo(() => activePromotionIds(activePromos), [activePromos])
  const currentPromo = activePromos[0]
  const [promoSource, setPromoSource] = useState<PromotionSourceFilter>('all')
  const promoLeads = useMemo(
    () => (currentPromo ? promotionLeads(mine, currentPromo._id, promoSource) : []),
    [mine, currentPromo, promoSource],
  )
  const categoryLeads = useMemo(() => withoutActivePromotionLeads(mine, activePromoIds), [mine, activePromoIds])
  // Si la promo se termine pendant qu'on est sur l'onglet, on retombe sur « Nouveaux ».
  useEffect(() => {
    if (filter === 'promotion' && !currentPromo) setFilter('nouveau')
  }, [filter, currentPromo])
```

5. Dans `counts`, ajouter `promotion: currentPromo ? promotionLeads(mine, currentPromo._id, 'all').length : 0,`, et `currentPromo, mine` dans les dépendances. Construire les filtres affichés :

```ts
  const statusFilters = useMemo(
    () => currentPromo
      ? [{ key: 'promotion' as const, label: 'Promotion', icon: 'tag' as const, countKey: 'promotion' as const }, ...SETTER_STATUS_FILTERS]
      : SETTER_STATUS_FILTERS,
    [currentPromo],
  )
```

Puis passer `statusFilters={statusFilters}` à `<LeadsRail>` (l.368).

6. Dans `filtered` : remplacer `let list = searching ? categoryLeads : filterSetterLeadsByStatus(categoryLeads, filter)` par :

```ts
    // Recherche globale : retrouve aussi les leads de promo.
    let list = searching
      ? mine
      : filter === 'promotion' ? promoLeads : filterSetterLeadsByStatus(categoryLeads, filter)
```

Ajouter `mine, promoLeads` aux dépendances. Dans `missingCounts`, faire le même remplacement pour `withinStatus`.

7. `filterSetterLeadsByStatus` : ajouter `case 'promotion': return leads` (le filtrage promo est fait en amont), pour que le `switch` reste exhaustif.

8. Afficher le bandeau : juste après `<div className="flex-grow flex flex-col min-w-0">` (l.379) :

```tsx
          {filter === 'promotion' && currentPromo && (
            <PromotionBanner promo={currentPromo} source={promoSource} onSource={setPromoSource} />
          )}
```

9. Badge historique : dans le rendu de la cellule `nom` côté setter (chercher `ResubmittedBadge lead={lead}` et ajouter à côté) :

```tsx
{lead.promotionId && !activePromoIds.has(lead.promotionId) && (
  <span className="ml-1 rounded-full bg-or-tint px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-or-dark" title="Lead d'une promotion terminée">Promo</span>
)}
```

Si la cellule est rendue dans une fonction séparée qui n'a pas accès à `activePromoIds`, passer `activePromoIds` en prop. Le nom exact de la promo terminée n'est pas chargé côté setter, d'où le libellé générique « Promo ». C'est un écart assumé et minime par rapport à la spec, qui disait « Black Friday » : le signaler dans le rapport.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd ~/backend_convex/frontend && npx vitest run src/components/promotions src/lib/promotions.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/backend_convex
git add frontend/src/components/promotions/PromotionBanner.tsx frontend/src/components/promotions/PromotionBanner.test.tsx frontend/src/pages/leads/LeadsList.tsx
git commit -m "feat(promotions): onglet Promotion setter (exclusion, bandeau, nouveaux/anciens)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Onglet Promotion côté admin (formulaire, liste, chiffres, actions)

**Files:**
- Create: `frontend/src/components/promotions/PromotionForm.tsx`, `frontend/src/components/promotions/PromotionsAdmin.tsx`
- Modify: `frontend/src/pages/leads/LeadsList.tsx` (`LeadsAdmin`, l.501-842)
- Test: `frontend/src/components/promotions/PromotionsAdmin.test.tsx`

**Interfaces:**
- Consumes : Task 8 (hooks et fonctions `promotionsApi`), `useGhlCalendars`. Vérifier s'il existe un hook qui appelle `ghlCalendar:listCalendars` (`grep -n "listCalendars" frontend/src/lib`). S'il n'existe pas, ajouter dans `promotionsApi.ts` :
  `listGhlCalendars = () => client().action(makeFunctionReference<'action', Record<string, never>, { id: string; name: string }[]>('ghlCalendar:listCalendars'), {})`.
  Vérifier la forme du retour dans `convex/ghlCalendar.ts:431` et adapter le mapping.
- Produces :
  - `<PromotionsAdmin leads={LeadResponse[]} />`
  - `<PromotionForm initial?: PromotionRow onClose onSaved />`
  - `validatePromotionForm(values): string | null`, exporté pour le test.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/promotions/PromotionsAdmin.test.tsx
import { describe, expect, it } from 'vitest'
import { validatePromotionForm, EMPTY_PROMOTION_FORM } from './PromotionForm'

describe('validatePromotionForm', () => {
  it('exige nom, dates ordonnées et tag ou statut', () => {
    expect(validatePromotionForm({ ...EMPTY_PROMOTION_FORM })).toMatch(/nom/i)
    const base = { ...EMPTY_PROMOTION_FORM, name: 'BF', startDay: '2026-11-23', endDay: '2026-11-29' }
    expect(validatePromotionForm(base)).toMatch(/tag ou au moins un statut/i)
    expect(validatePromotionForm({ ...base, tag: 'black friday' })).toBeNull()
    expect(validatePromotionForm({ ...base, legacyStatuses: ['perdu'] })).toBeNull()
    expect(validatePromotionForm({ ...base, tag: 'x', endDay: '2026-11-20' })).toMatch(/fin/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/backend_convex/frontend && npx vitest run src/components/promotions/PromotionsAdmin.test.tsx`
Expected: FAIL, module introuvable.

- [ ] **Step 3: Formulaire**

```tsx
// frontend/src/components/promotions/PromotionForm.tsx
import { useEffect, useState } from 'react'
import { createPromotion, listGhlCalendars, updatePromotion, type PromotionInput, type PromotionRow } from '../../lib/promotionsApi'
import { reunionDayInput } from '../../lib/promotions'
import { humanizeError } from '../../lib/errors'

export const LEGACY_STATUS_OPTIONS: { key: string; label: string }[] = [
  { key: 'perdu', label: 'Perdu' },
  { key: 'pas_qualifie', label: 'Pas qualifié' },
  { key: 'pas_de_reponse', label: 'Sans réponse' },
  { key: 'relance', label: 'Relance long terme' },
  { key: 'a_rappeler', label: 'À rappeler' },
  { key: 'nouveau', label: 'Nouveau (jamais traité)' },
]

export type PromotionFormValues = {
  name: string; tag: string; startDay: string; endDay: string; offer: string; pitch: string
  officeCalendarId: string; officeAddress: string; legacyStatuses: string[]
  legacyArrivedFromDay: string; legacyArrivedToDay: string
}

export const EMPTY_PROMOTION_FORM: PromotionFormValues = {
  name: '', tag: '', startDay: '', endDay: '', offer: '', pitch: '',
  officeCalendarId: '', officeAddress: '', legacyStatuses: [], legacyArrivedFromDay: '', legacyArrivedToDay: '',
}

export function validatePromotionForm(v: PromotionFormValues): string | null {
  if (!v.name.trim()) return 'Le nom de la promotion est obligatoire.'
  if (!v.startDay || !v.endDay) return 'Choisis une date de début et une date de fin.'
  if (v.endDay < v.startDay) return 'La date de fin doit être après la date de début.'
  if (!v.tag.trim() && v.legacyStatuses.length === 0) return 'Indique un tag ou au moins un statut d’anciens leads.'
  return null
}

function toInput(v: PromotionFormValues): PromotionInput {
  const opt = (s: string) => (s.trim() ? s.trim() : undefined)
  return {
    name: v.name.trim(), tag: opt(v.tag), startDay: v.startDay, endDay: v.endDay,
    offer: opt(v.offer), pitch: opt(v.pitch), officeCalendarId: opt(v.officeCalendarId), officeAddress: opt(v.officeAddress),
    legacyStatuses: v.legacyStatuses.length ? v.legacyStatuses : undefined,
    legacyArrivedFromDay: opt(v.legacyArrivedFromDay), legacyArrivedToDay: opt(v.legacyArrivedToDay),
  }
}

function fromRow(p: PromotionRow): PromotionFormValues {
  return {
    name: p.name, tag: p.tag ?? '', startDay: reunionDayInput(p.startAt), endDay: reunionDayInput(p.endAt),
    offer: p.offer ?? '', pitch: p.pitch ?? '', officeCalendarId: p.officeCalendarId ?? '', officeAddress: p.officeAddress ?? '',
    legacyStatuses: p.legacyStatuses ?? [],
    legacyArrivedFromDay: p.legacyArrivedFrom ? reunionDayInput(p.legacyArrivedFrom) : '',
    legacyArrivedToDay: p.legacyArrivedTo ? reunionDayInput(p.legacyArrivedTo) : '',
  }
}

export function PromotionForm({ initial, onClose, onSaved }: { initial?: PromotionRow; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<PromotionFormValues>(() => (initial ? fromRow(initial) : EMPTY_PROMOTION_FORM))
  const [calendars, setCalendars] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    listGhlCalendars().then((rows) => {
      setCalendars(rows)
      // Pré-remplissage : le calendrier « Black Friday » s'il existe.
      if (!initial) {
        const bf = rows.find((c) => c.name.toLowerCase().includes('black friday'))
        if (bf) setValues((v) => (v.officeCalendarId ? v : { ...v, officeCalendarId: bf.id }))
      }
    }).catch(() => setCalendars([]))
  }, [initial])
  const set = <K extends keyof PromotionFormValues>(k: K, val: PromotionFormValues[K]) => setValues((v) => ({ ...v, [k]: val }))

  async function save() {
    const invalid = validatePromotionForm(values)
    if (invalid) return setError(invalid)
    setSaving(true); setError(null)
    try {
      if (initial) await updatePromotion(initial._id, toInput(values))
      else await createPromotion(toInput(values))
      onSaved()
    } catch (e) {
      setError(humanizeError(e, 'Enregistrement impossible'))
    } finally {
      setSaving(false)
    }
  }

  const field = 'bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-label="Promotion">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[22px] bg-white p-5 space-y-4">
        <h2 className="font-black text-lg">{initial ? 'Modifier la promotion' : 'Nouvelle promotion'}</h2>

        <section className="space-y-2">
          <div className="text-[10px] font-bold tracking-widest uppercase text-faint">Général</div>
          <input className={field} placeholder="Nom (ex. Black Friday 2026)" value={values.name} onChange={(e) => set('name', e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">Début<input type="date" className={field} value={values.startDay} onChange={(e) => set('startDay', e.target.value)} /></label>
            <label className="text-xs text-muted">Fin<input type="date" className={field} value={values.endDay} onChange={(e) => set('endDay', e.target.value)} /></label>
          </div>
          <input className={field} placeholder="Offre (ex. -15 % sur les kits)" value={values.offer} onChange={(e) => set('offer', e.target.value)} />
          <textarea className={`${field} h-24 resize-none`} placeholder="Argumentaire pour les setters" value={values.pitch} onChange={(e) => set('pitch', e.target.value)} />
        </section>

        <section className="space-y-2">
          <div className="text-[10px] font-bold tracking-widest uppercase text-faint">Nouveaux leads (tag GHL)</div>
          <input className={field} placeholder="Tag GHL (ex. black friday)" value={values.tag} onChange={(e) => set('tag', e.target.value)} />
          <p className="text-xs text-muted">Le tag doit être posé par un workflow GHL. Ajoutez ensuite une action Webhook vers /webhooks/ghl/tags.</p>
        </section>

        <section className="space-y-2">
          <div className="text-[10px] font-bold tracking-widest uppercase text-faint">Anciens leads à inviter</div>
          <div className="flex flex-wrap gap-2">
            {LEGACY_STATUS_OPTIONS.map((s) => {
              const on = values.legacyStatuses.includes(s.key)
              return (
                <button key={s.key} type="button"
                  onClick={() => set('legacyStatuses', on ? values.legacyStatuses.filter((x) => x !== s.key) : [...values.legacyStatuses, s.key])}
                  className={`pill-tab text-xs ${on ? '!bg-text !text-white' : 'bg-white border border-line text-muted'}`}>
                  {s.label}
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">Arrivés depuis (facultatif)<input type="date" className={field} value={values.legacyArrivedFromDay} onChange={(e) => set('legacyArrivedFromDay', e.target.value)} /></label>
            <label className="text-xs text-muted">Arrivés jusqu’au (facultatif)<input type="date" className={field} value={values.legacyArrivedToDay} onChange={(e) => set('legacyArrivedToDay', e.target.value)} /></label>
          </div>
          <p className="text-xs text-muted">Le nombre de leads concernés et le bouton « Rattacher ces leads » apparaissent sur la carte de la promotion après l’enregistrement.</p>
        </section>

        <section className="space-y-2">
          <div className="text-[10px] font-bold tracking-widest uppercase text-faint">RDV au bureau</div>
          <select className={field} value={values.officeCalendarId} onChange={(e) => set('officeCalendarId', e.target.value)}>
            <option value="">Pas de RDV au bureau</option>
            {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className={field} placeholder="Adresse du bureau" value={values.officeAddress} onChange={(e) => set('officeAddress', e.target.value)} />
        </section>

        {error && <div className="rounded-[14px] border border-rouille/40 bg-rouille-tint px-3 py-2 text-sm">{error}</div>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-line bg-white py-2 text-sm font-semibold">Annuler</button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary rounded-xl py-2 text-sm disabled:opacity-60">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  )
}
```

Vérifier l'import de `humanizeError` : `grep -rn "export function humanizeError" frontend/src/lib`. Il est utilisé dans `SplitPanel.tsx`, reprendre le même chemin.

Pour l'aperçu des anciens leads, l'implémentation choisie l'affiche sur la carte de la promo et non dans le formulaire (Step 4). En effet, `previewLegacy` lit une promo enregistrée. La spec disait « dans le formulaire » ; l'écart est assumé et à mentionner dans le rapport.

- [ ] **Step 4: Liste admin**

```tsx
// frontend/src/components/promotions/PromotionsAdmin.tsx
import { useState } from 'react'
import type { LeadResponse } from '../../lib/types'
import { formatPromotionRange, promotionLeads } from '../../lib/promotions'
import {
  archivePromotion, attachLegacy, backfillPromotion, useLegacyPreview, usePromotionStats, usePromotionsList,
  type PromotionRow, type StatBlock,
} from '../../lib/promotionsApi'
import { PromotionForm, LEGACY_STATUS_OPTIONS } from './PromotionForm'
import { humanizeError } from '../../lib/errors'

const GROUPS: { key: PromotionRow['status']; label: string }[] = [
  { key: 'en_cours', label: 'En cours' },
  { key: 'a_venir', label: 'À venir' },
  { key: 'terminee', label: 'Terminées' },
]

export function PromotionsAdmin({ leads, onOpenLeads }: { leads: LeadResponse[]; onOpenLeads: (promo: PromotionRow) => void }) {
  const promos = usePromotionsList()
  const [editing, setEditing] = useState<PromotionRow | 'new' | null>(null)
  return (
    <div className="px-4 sm:px-8 py-4 space-y-5 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="font-black text-lg">Promotions</h2>
        <button type="button" onClick={() => setEditing('new')} className="btn-primary rounded-xl px-4 py-2 text-sm">Nouvelle promotion</button>
      </div>
      {promos === undefined && <p className="text-sm text-muted">Chargement…</p>}
      {promos && promos.length === 0 && <p className="text-sm text-muted">Aucune promotion pour l’instant.</p>}
      {promos && GROUPS.map((g) => {
        const rows = promos.filter((p) => p.status === g.key)
        if (rows.length === 0) return null
        return (
          <section key={g.key} className="space-y-2">
            <div className="text-[10px] font-bold tracking-widest uppercase text-faint">{g.label}</div>
            {rows.map((p) => (
              <PromotionCard key={p._id} promo={p} leadCount={promotionLeads(leads, p._id, 'all').length}
                onEdit={() => setEditing(p)} onOpenLeads={() => onOpenLeads(p)} />
            ))}
          </section>
        )
      })}
      {editing && (
        <PromotionForm initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />
      )}
    </div>
  )
}

function StatLine({ label, b }: { label: string; b: StatBlock }) {
  return (
    <div className="text-xs text-text">
      <span className="font-bold">{label}</span> : {b.leads} leads · {b.joints} joints · {b.rdvDomicile} RDV domicile · {b.rdvBureau} RDV bureau · {b.qualifies} qualifiés · {b.signes} signés
    </div>
  )
}

function PromotionCard({ promo, leadCount, onEdit, onOpenLeads }: { promo: PromotionRow; leadCount: number; onEdit: () => void; onOpenLeads: () => void }) {
  const stats = usePromotionStats(promo._id)
  const preview = useLegacyPreview(promo.status !== 'terminee' && promo.legacyStatuses?.length ? promo._id : null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label); setMessage(null)
    try { setMessage(await fn()) } catch (e) { setMessage(humanizeError(e, 'Action impossible')) } finally { setBusy(null) }
  }
  const statusLabels = (promo.legacyStatuses ?? []).map((s) => LEGACY_STATUS_OPTIONS.find((o) => o.key === s)?.label ?? s).join(', ')

  return (
    <div className="rounded-[18px] border border-line bg-white/70 p-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-bold text-text">{promo.name}</div>
          <div className="text-xs text-muted">
            {formatPromotionRange(promo.startAt, promo.endAt)}
            {promo.tag ? ` · tag « ${promo.tag} »` : ''}
            {statusLabels ? ` · anciens : ${statusLabels}` : ''}
            {promo.officeCalendarId ? ' · RDV bureau' : ''}
          </div>
        </div>
        <button type="button" onClick={onOpenLeads} className="text-xs font-semibold text-or hover:underline">Voir les {leadCount} leads</button>
      </div>
      {stats && (
        <div className="space-y-0.5">
          <StatLine label="Nouveaux" b={stats.nouveaux} />
          <StatLine label="Anciens" b={stats.anciens} />
          {stats.rdvBureauHorsPromo > 0 && <div className="text-xs text-text">+ {stats.rdvBureauHorsPromo} RDV bureau pris par des leads hors promo</div>}
        </div>
      )}
      {preview && (
        <div className="text-xs text-muted">Anciens leads à rattacher : <span className="font-bold text-text">{preview.eligible}</span>{preview.skipped ? ` (${preview.skipped} ignorés : RDV à venir, signés ou déjà dans une promo)` : ''}</div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={onEdit} className="pill-tab text-xs bg-white border border-line">Modifier</button>
        {promo.status !== 'terminee' && (promo.legacyStatuses?.length ?? 0) > 0 && (
          <button type="button" disabled={busy !== null}
            onClick={() => run('legacy', async () => { const r = await attachLegacy(promo._id); return `${r.attached} lead(s) rattaché(s), ${r.skipped} ignoré(s).` })}
            className="pill-tab text-xs bg-white border border-line">{busy === 'legacy' ? 'Rattachement…' : 'Rattacher ces leads'}</button>
        )}
        {promo.tag && (
          <button type="button" disabled={busy !== null}
            onClick={() => run('backfill', async () => { const r = await backfillPromotion(promo._id); return `${r.attached} lead(s) rattrapé(s) sur ${r.scanned} webhooks relus.` })}
            className="pill-tab text-xs bg-white border border-line">{busy === 'backfill' ? 'Rattrapage…' : 'Rattraper les tags'}</button>
        )}
        {!promo.archived && (
          <button type="button" disabled={busy !== null}
            onClick={() => { if (window.confirm(`Archiver « ${promo.name} » ? Ses leads reviendront dans les onglets habituels.`)) void run('archive', async () => { await archivePromotion(promo._id); return 'Promotion archivée.' }) }}
            className="pill-tab text-xs bg-white border border-line text-rouille">Archiver</button>
        )}
      </div>
      {message && <div className="text-xs text-text">{message}</div>}
    </div>
  )
}
```

- [ ] **Step 5: Intégration dans LeadsAdmin**

Dans `LeadsAdmin` (`LeadsList.tsx`) :

```ts
  const [adminView, setAdminView] = useState<'leads' | 'promotions'>('leads')
  const [promoLeadsOf, setPromoLeadsOf] = useState<{ id: string; name: string } | null>(null)
  const activePromos = useActivePromotions()
  const activePromoIds = useMemo(() => activePromotionIds(activePromos), [activePromos])
```

- Remplacer `const leads = leadsData ?? []` par :

```ts
  const allLeads = leadsData ?? []
  // Pendant une promo en cours, ses leads ne sont visibles que dans l'onglet
  // Promotion (même règle que côté setter) ; « Voir les leads » d'une promo
  // affiche exactement ceux-là ; la recherche reste globale.
  const leads = promoLeadsOf
    ? promotionLeads(allLeads, promoLeadsOf.id, 'all')
    : query.trim() ? allLeads : withoutActivePromotionLeads(allLeads, activePromoIds)
```

Vérifier que la variable de recherche de `LeadsAdmin` s'appelle bien `query` (l.524). Laisser le reste du composant lire `leads` comme avant.

- Dans le JSX, juste après `<Topbar ... />` (l.684-687), ajouter :

```tsx
      <div className="px-4 sm:px-8 pt-3 flex gap-2">
        <button type="button" onClick={() => { setAdminView('leads'); setPromoLeadsOf(null) }} className={`pill-tab ${adminView === 'leads' && !promoLeadsOf ? '!bg-text !text-white' : 'bg-white border border-line text-muted'}`}>Leads</button>
        <button type="button" onClick={() => setAdminView('promotions')} className={`pill-tab ${adminView === 'promotions' ? '!bg-text !text-white' : 'bg-white border border-line text-muted'}`}>Promotion</button>
        {promoLeadsOf && <span className="pill-tab bg-or-tint text-or-dark">Leads de « {promoLeadsOf.name} »</span>}
      </div>
      {adminView === 'promotions' && (
        <PromotionsAdmin leads={allLeads} onOpenLeads={(p) => { setPromoLeadsOf({ id: p._id, name: p.name }); setAdminView('leads') }} />
      )}
```

et entourer le bloc existant `<div className="flex flex-grow overflow-hidden"> … </div>` de `{adminView === 'leads' && ( … )}`.

Imports à ajouter : `PromotionsAdmin`, `promotionLeads`, `withoutActivePromotionLeads`, `activePromotionIds`, `useActivePromotions`. Certains sont déjà importés par la Task 9 : compléter la liste.

- [ ] **Step 6: Run tests + typecheck**

Run: `cd ~/backend_convex/frontend && npx vitest run src/components/promotions && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/backend_convex
git add frontend/src/components/promotions frontend/src/pages/leads/LeadsList.tsx frontend/src/lib/promotionsApi.ts
git commit -m "feat(promotions): onglet Promotion admin (création, chiffres, rattachements)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Deux qualifications dans la barre latérale (domicile / bureau)

**Files:**
- Modify: `frontend/src/components/SplitPanel.tsx` (`NotesTab`, l.940-1545 ; `formatRdvTransferNote`, l.1687)
- Create: `frontend/src/components/promotions/qualification.ts`
- Test: `frontend/src/components/promotions/qualification.test.ts`

**Interfaces:**
- Consumes : Task 8 (`useActivePromotions`, `officePromotion`), `createGhlAppointment` (`lib/hooks.ts:1368`, accepte déjà `calendarId` et `locationType`), `useGhlFreeSlots`.
- Produces (pures, testées) :
  - `type RdvMode = 'domicile' | 'bureau'`
  - `nextStepAfterQualification(mode: RdvMode): 'secteur' | 'rdv'`
  - `previousStepFromRdv(mode: RdvMode): 'secteur' | 'qualification'`
  - `bureauSlotHint(slotsCount: number, hasDate: boolean): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/components/promotions/qualification.test.ts
import { describe, expect, it } from 'vitest'
import { bureauSlotHint, nextStepAfterQualification, previousStepFromRdv } from './qualification'

describe('parcours de qualification', () => {
  it('bureau saute l’étape secteur, dans les deux sens', () => {
    expect(nextStepAfterQualification('domicile')).toBe('secteur')
    expect(nextStepAfterQualification('bureau')).toBe('rdv')
    expect(previousStepFromRdv('domicile')).toBe('secteur')
    expect(previousStepFromRdv('bureau')).toBe('qualification')
  })
  it('message quand le calendrier bureau n’a aucun créneau', () => {
    expect(bureauSlotHint(0, true)).toMatch(/vendredi ou un samedi/)
    expect(bureauSlotHint(3, true)).toBeNull()
    expect(bureauSlotHint(0, false)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/backend_convex/frontend && npx vitest run src/components/promotions/qualification.test.ts`
Expected: FAIL.

- [ ] **Step 3: Helpers purs**

```ts
// frontend/src/components/promotions/qualification.ts
export type RdvMode = 'domicile' | 'bureau'

export function nextStepAfterQualification(mode: RdvMode): 'secteur' | 'rdv' {
  return mode === 'bureau' ? 'rdv' : 'secteur'
}

export function previousStepFromRdv(mode: RdvMode): 'secteur' | 'qualification' {
  return mode === 'bureau' ? 'qualification' : 'secteur'
}

export function bureauSlotHint(slotsCount: number, hasDate: boolean): string | null {
  if (!hasDate || slotsCount > 0) return null
  return 'Aucun créneau au bureau ce jour-là : choisis un vendredi ou un samedi. Si rien n’apparaît, le calendrier bureau est peut-être désactivé dans GHL (prévenir l’admin).'
}
```

- [ ] **Step 4: Intégration dans NotesTab (SplitPanel.tsx)**

1. Imports :

```ts
import { useActivePromotions } from '../lib/promotionsApi'
import { officePromotion } from '../lib/promotions'
import { bureauSlotHint, nextStepAfterQualification, previousStepFromRdv, type RdvMode } from './promotions/qualification'
```

2. États, après `const [sector, setSector] = …` :

```ts
  const activePromos = useActivePromotions()
  const officePromo = officePromotion(activePromos)
  const [rdvMode, setRdvMode] = useState<RdvMode>('domicile')
  // Promo archivée/terminée pendant la saisie : on repasse en domicile.
  useEffect(() => { if (!officePromo && rdvMode === 'bureau') setRdvMode('domicile') }, [officePromo, rdvMode])
  const isBureau = rdvMode === 'bureau' && Boolean(officePromo)
```

3. Créneaux : remplacer le bloc `const slotRange = …` et `useGhlFreeSlots({...})` par :

```ts
  const slotRange = shouldLoadCalendarData && (sector || isBureau) ? buildDayRange(rdvDate) : null
  const { data: ghlSlotsData, loading: ghlSlotsLoading, refetch: refetchGhlSlots } = useGhlFreeSlots({
    sector: shouldLoadCalendarData ? (isBureau ? 'Bureau' : sector || undefined) : undefined,
    calendarId: shouldLoadCalendarData
      ? (isBureau ? officePromo?.officeCalendarId : selectedSectorConfig?.calendarId) || undefined
      : undefined,
    from: slotRange?.from,
    to: slotRange?.to,
    timezone: 'Indian/Reunion',
  })
```

4. Étape `qualification` : remplacer le bloc `<div className="grid grid-cols-1 gap-2">` qui contient le seul `StatusChoice` « Qualifié » par :

```tsx
            <div className="grid grid-cols-1 gap-2">
              <StatusChoice
                active={setterStatus === 'qualifie' && rdvMode === 'domicile'}
                icon="home"
                title={officePromo ? 'Qualifié – RDV à domicile' : 'Qualifié'}
                text="Secteur et RDV"
                onClick={() => { setSetterStatus('qualifie'); setRdvMode('domicile'); setResult('joint') }}
              />
              {officePromo && (
                <StatusChoice
                  active={setterStatus === 'qualifie' && rdvMode === 'bureau'}
                  icon="map-pin"
                  title="Qualifié – RDV au bureau"
                  text={`${officePromo.name} · vendredi ou samedi au bureau`}
                  onClick={() => { setSetterStatus('qualifie'); setRdvMode('bureau'); setResult('joint') }}
                />
              )}
            </div>
```

5. Le bouton « Continuer vers secteur » appelle `saveCallAndLead(setterStatus)`. Repérer dans `saveCallAndLead` la ligne `setStep('secteur')` de la branche `qualifie` et la remplacer par `setStep(nextStepAfterQualification(rdvMode))`. Libellé du bouton : `{rdvMode === 'bureau' ? 'Continuer vers le calendrier bureau' : 'Continuer vers secteur'}`. Texte d'aide juste au-dessus : `{rdvMode === 'bureau' ? 'Valide la qualification pour choisir un créneau au bureau.' : 'Valide la qualification pour passer à la sélection du secteur puis au RDV.'}`.

6. Étape `rdv` : remplacer l'encart « Secteur sélectionné » par :

```tsx
          <div className="rounded-[18px] border border-or/20 bg-or-tint p-3">
            <div className="text-[10px] font-bold tracking-widest uppercase text-or-dark mb-1">{isBureau ? 'RDV au bureau' : 'Secteur sélectionné'}</div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold text-or-dark">{isBureau ? `Bureau Electro Concept OI · ${officePromo?.name}` : sector}</span>
              <button type="button" onClick={() => setStep(previousStepFromRdv(isBureau ? 'bureau' : 'domicile'))} className="text-xs font-semibold text-or hover:underline">Changer</button>
            </div>
            {isBureau && officePromo?.officeAddress && <div className="text-xs text-or-dark mt-1">{officePromo.officeAddress}</div>}
          </div>
```

Dans le `<p className="text-xs text-muted">` sous l'agenda, en mode bureau, afficher en priorité `bureauSlotHint(ghlTimeSlots.length, Boolean(rdvDate) && !ghlSlotsLoading)` s'il n'est pas null. Bouton « Retour » de l'étape `rdv` : `onClick={() => setStep(previousStepFromRdv(isBureau ? 'bureau' : 'domicile'))}`.

7. Étape `confirmation` : dans le « Résumé final », remplacer le `Field` du secteur (chercher `label="SECTEUR"`) par `<Field label={isBureau ? 'LIEU' : 'SECTEUR'} value={isBureau ? `RDV au bureau${officePromo?.officeAddress ? ` — ${officePromo.officeAddress}` : ''}` : sector} />`.

8. `validateRdv()` : remplacer `if (!sector) throw new Error('Sélectionne un secteur.')` par `if (!isBureau && !sector) throw new Error('Sélectionne un secteur.')`. Dans l'appel `createGhlAppointment`, remplacer :
   - `sector,` par `sector: isBureau ? 'Bureau' : sector,`
   - `calendarId: selectedSectorConfig?.calendarId || undefined,` par `calendarId: (isBureau ? officePromo?.officeCalendarId : selectedSectorConfig?.calendarId) || undefined,`
   - `locationType: 'domicile',` par `locationType: isBureau ? 'agence' : 'domicile',`

   Dans la branche locale `createRdv` (mode sans GHL), mettre `locationType: isBureau ? 'agence' : 'domicile',`. Message de succès : préfixer `isBureau ? 'RDV au bureau créé dans GHL.' : …`.

9. `formatRdvTransferNote` (l.1687) : ajouter un paramètre `bureau?: { address?: string }`. S'il est fourni, la note commence par `RDV BUREAU${address ? ` — ${address}` : ''}` sur la première ligne. À l'appel (chercher `rdvTransferNote =`), passer `bureau: isBureau ? { address: officePromo?.officeAddress } : undefined`.

- [ ] **Step 5: Test de rendu de la qualification**

```tsx
// frontend/src/components/SplitPanel.bureau.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { StatusChoice } from './SplitPanel'
```

Note : si `NotesTab` n'est pas exporté et que le monter demande trop de mocks (Convex, GHL), s'en tenir aux tests purs du Step 1. Ajouter alors un test manuel au Step 7 de la Task 12. **Ne pas** exporter de composants internes uniquement pour le test.

- [ ] **Step 6: Run tests + typecheck**

Run: `cd ~/backend_convex/frontend && npx vitest run src/components && npx tsc --noEmit`
Expected: PASS, y compris les tests existants de `SplitPanel` s'il y en a.

- [ ] **Step 7: Commit**

```bash
cd ~/backend_convex
git add frontend/src/components/SplitPanel.tsx frontend/src/components/promotions/qualification.ts frontend/src/components/promotions/qualification.test.ts
git commit -m "feat(promotions): qualification RDV à domicile / RDV au bureau

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Badge « Bureau » sur les RDV + vérification finale

**Files:**
- Create: `frontend/src/components/RdvLocationBadge.tsx`
- Modify: `frontend/src/components/SplitPanel.tsx` (`RdvInfoCard`, l.621-660 : `MiniInfo label="Type"`), `frontend/src/pages/rdv/RdvDetail.tsx:19` (`LOCATION_LABEL`), `frontend/src/pages/rdv/RdvCalendar.tsx` (libellé de carte, vers la l.833)
- Test: `frontend/src/components/RdvLocationBadge.test.tsx`

**Interfaces:**
- Produces :
  - `<RdvLocationBadge location={RdvLocation} />` : ne rend rien pour `domicile`, rend « Bureau » pour `agence` et « Visio » pour `visio` ;
  - `rdvLocationLabel(location): string`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/RdvLocationBadge.test.tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RdvLocationBadge, rdvLocationLabel } from './RdvLocationBadge'

describe('RdvLocationBadge', () => {
  it('Bureau pour agence, rien pour domicile', () => {
    const { container, rerender } = render(<RdvLocationBadge location="domicile" />)
    expect(container).toBeEmptyDOMElement()
    rerender(<RdvLocationBadge location="agence" />)
    expect(screen.getByText('Bureau')).toBeInTheDocument()
    expect(rdvLocationLabel('agence')).toBe('Bureau')
    expect(rdvLocationLabel('domicile')).toBe('Domicile')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/backend_convex/frontend && npx vitest run src/components/RdvLocationBadge.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementation**

```tsx
// frontend/src/components/RdvLocationBadge.tsx
import type { RdvLocation } from '../lib/types'

const LABEL: Record<RdvLocation, string> = { domicile: 'Domicile', agence: 'Bureau', visio: 'Visio' }

export function rdvLocationLabel(location: RdvLocation): string {
  return LABEL[location] ?? location
}

export function RdvLocationBadge({ location }: { location: RdvLocation }) {
  if (location === 'domicile') return null
  return (
    <span className="rounded-full bg-or-tint px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-or-dark">
      {rdvLocationLabel(location)}
    </span>
  )
}
```

Vérifier que `RdvLocation` est bien exporté par `lib/types.ts` (utilisé l.544).

- [ ] **Step 4: Utilisations**

- `SplitPanel.tsx`, `RdvInfoCard` : `<MiniInfo label="Type" value={rdv.locationType} />` devient `<MiniInfo label="Type" value={rdvLocationLabel(rdv.locationType)} />`. Ajouter `<RdvLocationBadge location={rdv.locationType} />` à côté de `RDV {rdv.status}` dans l'en-tête de la carte.
- `RdvDetail.tsx` : dans `LOCATION_LABEL`, `agence` devient `'Bureau'`.
- `RdvCalendar.tsx`, vers la l.833 : `: (lead ? fullName(lead) : localRdvFallbackLabel(item.rdv))` devient

```tsx
      : `${item.rdv.locationType === 'agence' ? 'Bureau · ' : ''}${lead ? fullName(lead) : localRdvFallbackLabel(item.rdv)}`
```

Vérifier que `item.rdv` existe dans cette branche (type de `item`). Sinon, placer le préfixe là où `item.rdv` est garanti.

- [ ] **Step 5: Suites complètes + build**

Run:

```bash
cd ~/backend_convex && npx vitest run convex && npx tsc --noEmit -p convex
cd ~/backend_convex/frontend && npx vitest run && npx tsc --noEmit && npm run build
```

Expected : tout passe. Toute régression doit être corrigée avant de continuer, et tout échec qui existait déjà doit être noté tel quel dans le rapport.

- [ ] **Step 6: Commit**

```bash
cd ~/backend_convex
git add frontend/src/components/RdvLocationBadge.tsx frontend/src/components/RdvLocationBadge.test.tsx frontend/src/components/SplitPanel.tsx frontend/src/pages/rdv/RdvDetail.tsx frontend/src/pages/rdv/RdvCalendar.tsx
git commit -m "feat(promotions): badge Bureau sur les RDV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Vérification manuelle (après feu vert de Mario pour déployer)**

Seulement après `npx convex deploy`, validé par Mario, et la mise en ligne du front :

1. Admin → Leads → **Promotion** → Nouvelle promotion « ZZ test » : tag `zz-test-promo`, dates du jour, calendrier « Black Friday », adresse du bureau.
2. Dans GHL, sur un **contact de test uniquement**, poser le tag `zz-test-promo` puis déclencher le webhook. Ou appeler la route directement :
   `curl -X POST https://spotted-horse-257.eu-west-1.convex.site/webhooks/ghl/tags -H 'content-type: application/json' -H "x-elevenprocess-webhook-secret: $SECRET" -d '{"contact_id":"<id contact test>","tags":"zz-test-promo"}'`
   → `matched: true, attached: true`.
3. Setter : l'onglet Promotion montre le lead, et le lead a disparu de son onglet habituel.
4. Barre latérale → Qualifié – RDV au bureau → un créneau apparaît (une fois le calendrier activé dans GHL) → valider → le RDV est dans le calendrier GHL « Black Friday » et VELORA l'affiche avec le badge Bureau. Après la synchro de 15 min, le commercial attribué est repris.
5. Annuler le RDV de test dans GHL, puis archiver la promo « ZZ test » : le lead revient dans son onglet habituel.

- [ ] **Step 8: Push**

```bash
cd ~/backend_convex && git push origin main
```

Seulement si Mario l'a demandé. Sinon, le signaler dans le rapport final.

---

## Self-Review (fait à l'écriture)

- **Couverture de la spec :**
  - §4 données : Task 2 ;
  - §5.1 : Task 1 ;
  - §5.2-5.3 : Task 3 ;
  - §5.4 : Task 5 ;
  - §5.5 : Task 4 ;
  - §6.1 : Task 6 ;
  - §6.2 : Task 11 ;
  - §6.3 : Task 12 ;
  - §7 : Tasks 2 à 7 (sauf `leads`, voir les adaptations) ;
  - §8.1 : Task 9 ;
  - §8.2 : Task 10 ;
  - §8.3 : Tasks 1 et 8 ;
  - §9 cas limites : Tasks 3 à 6, 9 et 11 ;
  - §10 tests : répartis dans chaque tâche ;
  - §11 mise en service : Task 12, Steps 7-8.
- **Écarts assumés et signalés :**
  - exclusion côté client et pas de query `promotions.leads` ;
  - rattachement d'opportunité dans un appel séparé ;
  - badge « Promo » générique côté setter ;
  - aperçu des anciens leads sur la carte, pas dans le formulaire.
- **Cohérence des noms :** `applyTagsToLead`, `applyLeadTags`, `applyContactTags`, `officeCalendarForBooking`, `officeCalendars`, `previewLegacy`, `attachLegacy`, `attachLegacyBatch`, `backfill`, `backfillBatch`, `assertAdmin`, `getInternal`, `stats`. Les champs `promotionId`, `promotionSource` et `promotionJoinedAt` sont nommés de façon identique côté Convex et côté front.
