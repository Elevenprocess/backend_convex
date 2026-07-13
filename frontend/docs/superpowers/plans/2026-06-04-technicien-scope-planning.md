# Technicien — scope dossiers attribués + planning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le technicien ne voit/édite que les dossiers que le back office lui a attribués (`clients.technicienVtId`), avec un écran planning de ses VT + installations et une UI réduite à 2 entrées.

**Architecture:** Source de vérité unique = `clients.technicienVtId`. Backend : on rebase tout le scoping délivrabilité du technicien (visibilité + édition + `GET /clients` + `GET /documents/:id/raw`) sur ce champ au lieu de `workflowSteps.responsableId` (jamais rempli). Frontend : 2 pages dédiées alimentées par `GET /clients` (auto-scopé), nav réduite, gating par phase du board (vt/installation éditables, reste lecture seule).

**Tech Stack:** NestJS + Drizzle + Jest (backend `/root/ECOI_backend`) ; React 19 + Vite + Vitest (frontend `/root/ECOI_frontend`).

**Spec:** `ECOI_frontend/docs/superpowers/specs/2026-06-04-technicien-scope-planning-design.md`

**Note d'exécution :** déviation assumée vs spec §9 — `ClientsList` est alimenté par `/leads` (pas `/clients`), donc non scopable pour le technicien. On crée une liste dédiée `TechnicienDossiers` alimentée par `GET /clients`.

---

## Fichiers touchés

**Backend (`/root/ECOI_backend`)**
- Modify: `src/modules/delivrabilite/delivrabilite-permissions.ts` — rebase `canEditStep`/`canEditSubstep`/`visibleStepsWhere`/`visibleSubstepsWhere` sur `clients.technicienVtId`.
- Modify: `src/modules/delivrabilite/clients.service.ts` — `getTechnicienVtId()` + scope `list()` pour technicien.
- Modify: `src/modules/delivrabilite/clients.controller.ts` — passe l'`actor` à `list()`.
- Modify: `src/modules/delivrabilite/workflow-steps.service.ts` — fournit `clientTechnicienVtId` à `assertCanMutate`.
- Modify: `src/modules/delivrabilite/substeps.service.ts` — idem.
- Modify: `src/modules/delivrabilite/documents.service.ts` — scope `getRaw` + `assertCanManage` sur `clients.technicienVtId`.
- Modify: `src/modules/delivrabilite/documents.controller.ts` — passe l'`actor` à `getRaw`.
- Modify: tests `delivrabilite-permissions.spec.ts`, `workflow-steps.permissions.spec.ts`, `substeps.permissions.spec.ts`, `clients.controller.spec.ts`, `documents.service.spec.ts`.

**Frontend (`/root/ECOI_frontend`)**
- Create: `src/lib/technicienCalendar.ts` + `src/lib/technicienCalendar.test.ts` — dérivation d'événements.
- Create: `src/pages/technicien/TechnicienPlanning.tsx` — calendrier mensuel.
- Create: `src/pages/technicien/TechnicienDossiers.tsx` — liste scopée.
- Modify: `src/components/shell/Sidebar.tsx` — nav réduite technicien.
- Modify: `src/main.tsx` — routes `/planning`, `/mes-dossiers` + redirections technicien.
- Modify: `src/components/suivi/WorkflowBoard.tsx` + `src/components/suivi/SubstepCard.tsx` — gating par phase.
- Modify: `src/pages/SuiviDetail.tsx` — prédicat d'édition + breadcrumb technicien.

---

## BACKEND

### Task B1 : Rebaser le scoping permissions sur `clients.technicienVtId`

**Files:**
- Modify: `src/modules/delivrabilite/delivrabilite-permissions.ts`
- Modify: `src/modules/delivrabilite/clients.service.ts`
- Modify: `src/modules/delivrabilite/workflow-steps.service.ts`
- Modify: `src/modules/delivrabilite/substeps.service.ts`
- Modify: `src/modules/delivrabilite/documents.service.ts`
- Test: `src/modules/delivrabilite/delivrabilite-permissions.spec.ts`, `workflow-steps.permissions.spec.ts`

- [ ] **Step 1 : Réécrire le test unitaire de `canEditStep` (red)**

Dans `src/modules/delivrabilite/delivrabilite-permissions.spec.ts`, remplacer le bloc `describe('canEditStep — scoping technicien', ...)` (lignes ~61-87) par la version basée sur `clientTechnicienVtId` :

```ts
describe('canEditStep — scoping technicien', () => {
  it('technicien édite SA phase terrain quand le dossier lui est attribué', () => {
    expect(canEditStep({ id: 'u1', role: 'technicien' }, { phase: 'vt', clientTechnicienVtId: 'u1' })).toBe(true);
    expect(canEditStep({ id: 'u1', role: 'technicien' }, { phase: 'installation', clientTechnicienVtId: 'u1' })).toBe(true);
  });

  it('technicien NE peut PAS éditer une phase terrain d’un dossier non attribué', () => {
    expect(canEditStep({ id: 'u1', role: 'technicien' }, { phase: 'vt', clientTechnicienVtId: 'autre' })).toBe(false);
    expect(canEditStep({ id: 'u1', role: 'technicien' }, { phase: 'vt', clientTechnicienVtId: null })).toBe(false);
  });

  it('technicien NE peut PAS éditer une phase admin même sur son dossier', () => {
    expect(canEditStep({ id: 'u1', role: 'technicien' }, { phase: 'dp', clientTechnicienVtId: 'u1' })).toBe(false);
  });

  it('responsable_technique, back_office et admin éditent toute étape (full write)', () => {
    for (const role of ['responsable_technique', 'back_office', 'admin']) {
      expect(canEditStep({ id: 'x', role }, { phase: 'dp', clientTechnicienVtId: null })).toBe(true);
      expect(canEditStep({ id: 'x', role }, { phase: 'vt', clientTechnicienVtId: 'autre' })).toBe(true);
    }
  });
});
```

- [ ] **Step 2 : Lancer le test → échec de compilation/typage attendu**

Run: `cd /root/ECOI_backend && npx jest delivrabilite-permissions -t "scoping technicien"`
Expected: FAIL (propriété `clientTechnicienVtId` inconnue sur la signature actuelle).

- [ ] **Step 3 : Modifier `delivrabilite-permissions.ts`**

Ajouter `clients` à l'import schema (ligne 2) :

```ts
import { clients, workflowSteps, workflowSubsteps } from '../../db/schema';
```

Remplacer `canEditStep` (lignes ~62-72) :

```ts
/** Capacité + scoping : ce user peut-il éditer une étape de CE dossier ? */
export function canEditStep(
  user: { id: string; role: string },
  step: { phase: Phase; clientTechnicienVtId: string | null },
): boolean {
  if (!can(user.role, 'edit', step.phase)) return false;
  if (normalizeRole(user.role) === 'technicien') {
    return step.clientTechnicienVtId === user.id;
  }
  return true;
}
```

Remplacer `visibleStepsWhere` (lignes ~79-84) :

```ts
export function visibleStepsWhere(user: { id: string; role: string }): SQL | undefined {
  if (normalizeRole(user.role) === 'technicien') {
    return sql`${workflowSteps.clientId} in (select id from clients where technicien_vt_id = ${user.id})`;
  }
  return undefined;
}
```

Remplacer `canEditSubstep` (lignes ~90-95) :

```ts
export function canEditSubstep(
  user: { id: string; role: string },
  substep: { phase: Phase; clientTechnicienVtId: string | null },
): boolean {
  return canEditStep(user, substep);
}
```

Remplacer `visibleSubstepsWhere` (lignes ~98-103) :

```ts
export function visibleSubstepsWhere(user: { id: string; role: string }): SQL | undefined {
  if (normalizeRole(user.role) === 'technicien') {
    return sql`${workflowSubsteps.clientId} in (select id from clients where technicien_vt_id = ${user.id})`;
  }
  return undefined;
}
```

- [ ] **Step 4 : Ajouter `getTechnicienVtId` à `ClientsService`**

Dans `src/modules/delivrabilite/clients.service.ts`, ajouter cette méthode publique (après `findByLeadId`, ~ligne 135) :

```ts
/** Renvoie le technicien VT attribué à un dossier (ou null). Sert au scoping permissions. */
async getTechnicienVtId(
  clientId: string,
  executor: Pick<Db, 'select'> = this.db,
): Promise<string | null> {
  const [row] = await executor
    .select({ technicienVtId: clients.technicienVtId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  return row?.technicienVtId ?? null;
}
```

- [ ] **Step 5 : Adapter `workflow-steps.service.ts`**

Dans `update()`, juste après `if (!before) throw ...` (~ligne 88), charger le technicien et le passer :

```ts
      const clientTechnicienVtId = await this.clientsService.getTechnicienVtId(
        before.clientId,
        tx,
      );
      this.assertCanMutate(context.actor, before, dto, clientTechnicienVtId);
```

Modifier la signature et le corps de `assertCanMutate` (~ligne 143) :

```ts
  private assertCanMutate(
    actor: ActingUser,
    before: WorkflowStepRow,
    dto: UpdateWorkflowStepDto,
    clientTechnicienVtId: string | null,
  ): void {
    const phase = before.phase as Phase;

    if (!canEditStep(actor, { phase, clientTechnicienVtId })) {
      throw new ForbiddenException(
        `Rôle ${actor.role} non autorisé à modifier une étape ${phase}`,
      );
    }
```

(le reste de la méthode — checks `reassigns` et `resolvesProblem` — inchangé.)

- [ ] **Step 6 : Adapter `substeps.service.ts`**

Dans `update()`, après `if (!before) throw ...` (~ligne 78) :

```ts
      const clientTechnicienVtId = await this.clientsService.getTechnicienVtId(
        before.clientId,
        tx,
      );
      this.assertCanMutate(context.actor, before, dto, clientTechnicienVtId);
```

Modifier `assertCanMutate` (~ligne 119) :

```ts
  private assertCanMutate(
    actor: ActingUser,
    before: SubstepRow,
    dto: UpdateSubstepDto,
    clientTechnicienVtId: string | null,
  ): void {
    const def = catalogByKey(before.key as WorkflowSubstepKey);
    const phase = (def?.phase ?? 'vt') as Phase;
    if (!canEditSubstep(actor, { phase, clientTechnicienVtId })) {
      throw new ForbiddenException(`Rôle ${actor.role} non autorisé à modifier une sous-étape ${phase}`);
    }
```

(le reste inchangé.)

- [ ] **Step 7 : Adapter `documents.service.ts`**

Ajouter `clients` à l'import schema (ligne 10) :

```ts
import { clients, documents, workflowSubsteps } from '../../db/schema';
```

Ajouter une méthode privée (avant `assertCanManage`, ~ligne 128) :

```ts
  private async getClientTechnicienVtId(clientId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ technicienVtId: clients.technicienVtId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    return row?.technicienVtId ?? null;
  }
```

Modifier `assertCanManage` (~ligne 133) :

```ts
  private assertCanManage(
    actor: ActingUser,
    substep: SubstepRow,
    clientTechnicienVtId: string | null,
  ): void {
    const def = catalogByKey(substep.key as WorkflowSubstepKey);
    const phase = (def?.phase ?? 'vt') as Phase;
    if (!canEditSubstep(actor, { phase, clientTechnicienVtId })) {
      throw new ForbiddenException(
        `Rôle ${actor.role} non autorisé sur les documents de cette sous-étape`,
      );
    }
  }
```

Dans `uploadForSubstep`, remplacer l'appel `this.assertCanManage(opts.actor, substep);` (~ligne 50) :

```ts
    const tvt = await this.getClientTechnicienVtId(substep.clientId);
    this.assertCanManage(opts.actor, substep, tvt);
```

Dans `softDelete`, remplacer le bloc (~lignes 108-110) :

```ts
    if (doc.workflowSubstepId) {
      const substep = await this.loadSubstep(doc.workflowSubstepId);
      if (substep) {
        const tvt = await this.getClientTechnicienVtId(substep.clientId);
        this.assertCanManage(actor, substep, tvt);
      }
    }
```

- [ ] **Step 8 : Mettre à jour `workflow-steps.permissions.spec.ts`**

Le mock DB n'expose pas `getTechnicienVtId`. Modifier `clientsServiceMock` (~ligne 61) pour stubber la méthode, et faire varier le technicien via le stub :

```ts
const clientsServiceMock = {
  recomputeStatus: jest.fn().mockResolvedValue(undefined),
  getTechnicienVtId: jest.fn().mockResolvedValue(null),
};
```

Dans le `describe('update()')`, ajuster les 3 tests technicien pour piloter l'attribution via le stub (le champ `responsableId` du step n'est plus lu) :

```ts
    it('technicien peut éditer une étape terrain de son dossier', async () => {
      clientsServiceMock.getTechnicienVtId.mockResolvedValue('tech-1');
      const before = makeStep({ phase: 'vt' });
      const svc = makeService(makeUpdateDb(before, makeStep({ phase: 'vt', status: 'en_cours' })));
      const res = await svc.update('step-1', { status: 'en_cours' } as any, { actor: TECH });
      expect(res.status).toBe('en_cours');
    });

    it('technicien NE peut PAS éditer une étape terrain d’un dossier non attribué', async () => {
      clientsServiceMock.getTechnicienVtId.mockResolvedValue('autre');
      const before = makeStep({ phase: 'vt' });
      const svc = makeService(makeUpdateDb(before));
      await expect(
        svc.update('step-1', { status: 'en_cours' } as any, { actor: TECH }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('technicien NE peut PAS éditer une phase administrative (dp)', async () => {
      clientsServiceMock.getTechnicienVtId.mockResolvedValue('tech-1');
      const before = makeStep({ phase: 'dp' });
      const svc = makeService(makeUpdateDb(before));
      await expect(
        svc.update('step-1', { status: 'en_cours' } as any, { actor: TECH }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
```

Pour le test `resolve_problem` technicien (~ligne 126), ajouter avant l'appel : `clientsServiceMock.getTechnicienVtId.mockResolvedValue('tech-1');`.
Ajouter un `afterEach(() => clientsServiceMock.getTechnicienVtId.mockResolvedValue(null));` dans le `describe` racine si besoin de reset (sinon `jest.clearAllMocks()` du `beforeEach` suffit — re-set le mock en tête de chaque test technicien comme ci-dessus).

- [ ] **Step 9 : Mettre à jour `substeps.permissions.spec.ts`**

Appliquer le même pattern : stubber `getTechnicienVtId` sur le `clientsServiceMock` du fichier et piloter l'attribution par test (mêmes 3 cas technicien : son dossier vt/installation = ok, dossier non attribué = 403, phase dp = 403). Reproduire la structure des tests ci-dessus en adaptant aux sous-étapes (`makeSubstep` du fichier, clé `vt_planifie` pour vt, `dp_a_faire` pour dp).

- [ ] **Step 10 : Lancer les tests permissions + services (green)**

Run: `cd /root/ECOI_backend && npx jest delivrabilite-permissions workflow-steps.permissions substeps.permissions`
Expected: PASS.

- [ ] **Step 11 : Commit**

```bash
cd /root/ECOI_backend && git add -A && git commit -m "fix(deliv): rebase scoping technicien sur clients.technicienVtId

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B2 : Scoper `GET /clients` pour le technicien

**Files:**
- Modify: `src/modules/delivrabilite/clients.service.ts`
- Modify: `src/modules/delivrabilite/clients.controller.ts`
- Test: `src/modules/delivrabilite/clients.controller.spec.ts`

- [ ] **Step 1 : Écrire le test e2e (red)**

Dans `clients.controller.spec.ts`, ajouter ce test (après celui de la ligne 125) :

```ts
  it('GET /clients : un technicien ne voit que ses dossiers attribués', async () => {
    const tech = await seedUser(db, { role: 'technicien' });
    session = buildSessionUser({ id: tech.id, role: 'technicien' });
    const { client: mine } = await seedDossier({ technicienVtId: tech.id, firstName: 'Aline' });
    await seedDossier({ firstName: 'Bob' }); // non attribué → invisible

    const res = await request(app.getHttpServer()).get('/clients').expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(mine.id);
  });

  it('GET /clients : un technicien ne peut pas élargir via ?technicienVtId d’un autre', async () => {
    const tech = await seedUser(db, { role: 'technicien' });
    const other = await seedUser(db, { role: 'technicien' });
    session = buildSessionUser({ id: tech.id, role: 'technicien' });
    await seedDossier({ technicienVtId: other.id });

    const res = await request(app.getHttpServer())
      .get(`/clients?technicienVtId=${other.id}`)
      .expect(200);

    expect(res.body).toHaveLength(0);
  });
```

`buildSessionUser` doit accepter un `id` override ; vérifier la signature dans `src/common/test/auth-test.helper.ts` et utiliser la forme supportée (sinon `{ ...buildSessionUser({ role: 'technicien' }), id: tech.id }`).

- [ ] **Step 2 : Lancer → échec attendu**

Run: `cd /root/ECOI_backend && npx jest clients.controller -t "technicien ne voit que"`
Expected: FAIL (renvoie 2 dossiers).

- [ ] **Step 3 : Scoper le service**

Dans `clients.service.ts`, importer le helper de rôle en tête :

```ts
import { can, normalizeRole } from './delivrabilite-permissions';
```

Modifier la signature de `list` (~ligne 137) et forcer le filtre technicien :

```ts
  async list(
    q: QueryClientsDto,
    actor?: { id: string; role: string },
  ): Promise<ClientResponse[]> {
    const conditions: SQL[] = [isNull(clients.deletedAt)];

    // Technicien : visibilité forcée à SES dossiers attribués, quel que soit le query param.
    if (actor && normalizeRole(actor.role) === 'technicien') {
      conditions.push(eq(clients.technicienVtId, actor.id));
    } else if (q.technicienVtId) {
      conditions.push(eq(clients.technicienVtId, q.technicienVtId));
    }

    if (q.leadId) conditions.push(eq(clients.leadId, q.leadId));
    if (q.phase) conditions.push(eq(clients.currentPhase, q.phase));
    if (q.unassignedVt) conditions.push(isNull(clients.technicienVtId));
```

(le reste de `list` inchangé.)

- [ ] **Step 4 : Passer l'`actor` depuis le controller**

Dans `clients.controller.ts`, modifier `list` (~ligne 49) :

```ts
  @Get()
  @Roles(...WORKFLOW_ROLES)
  async list(
    @Query(new ZodValidationPipe(queryClientsSchema)) q: QueryClientsDto,
    @CurrentUser() session: SessionUser,
  ): Promise<ClientResponse[]> {
    return this.svc.list(q, { id: session.id, role: session.role });
  }
```

- [ ] **Step 5 : Lancer le test (green)**

Run: `cd /root/ECOI_backend && npx jest clients.controller`
Expected: PASS (tous, y compris les anciens tests admin qui passent `actor` admin → pas de filtre).

- [ ] **Step 6 : Commit**

```bash
cd /root/ECOI_backend && git add -A && git commit -m "fix(deliv): scope GET /clients au technicien attribué

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B3 : Scoper `GET /documents/:id/raw`

**Files:**
- Modify: `src/modules/delivrabilite/documents.service.ts`
- Modify: `src/modules/delivrabilite/documents.controller.ts`
- Test: `src/modules/delivrabilite/documents.service.spec.ts`

- [ ] **Step 1 : Écrire le test (red)**

Dans `documents.service.spec.ts`, ajouter un test vérifiant que `getRaw` renvoie `null` pour un technicien non attribué. Suivre le pattern de mock DB existant du fichier ; le test stubbe la requête document (clientId='c1') puis la requête technicien (technicienVtId='autre') :

```ts
  it('getRaw renvoie null pour un technicien non attribué au dossier', async () => {
    // db.select sur documents → renvoie la pièce ; puis sur clients → technicienVtId='autre'
    const svc = new DocumentsService(makeRawDb({ doc: { id: 'd1', clientId: 'c1', storageKey: 'k', filename: 'f', mimeType: 'application/pdf', deletedAt: null }, technicienVtId: 'autre' }), storageMock as any);
    const res = await svc.getRaw('d1', { id: 'tech-1', role: 'technicien' });
    expect(res).toBeNull();
  });
```

Ajouter un helper `makeRawDb` dans le fichier qui renvoie séquentiellement la ligne document puis la ligne technicien selon la table interrogée (s'inspirer des mocks DB déjà présents dans le fichier ; si le pattern existant diffère, l'adapter en gardant l'intention : 1er `select` → document, 2e `select` → `{ technicienVtId }`).

- [ ] **Step 2 : Lancer → échec attendu**

Run: `cd /root/ECOI_backend && npx jest documents.service -t "non attribué"`
Expected: FAIL (`getRaw` ignore l'actor aujourd'hui).

- [ ] **Step 3 : Scoper `getRaw`**

Dans `documents.service.ts`, importer `normalizeRole` :

```ts
import { canEditSubstep, normalizeRole, type Phase } from './delivrabilite-permissions';
```

Modifier `getRaw` (~ligne 85) :

```ts
  async getRaw(id: string, actor: ActingUser) {
    const [row] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!row) return null;

    // Technicien : accès limité aux pièces de SES dossiers attribués.
    if (normalizeRole(actor.role) === 'technicien') {
      const tvt = await this.getClientTechnicienVtId(row.clientId);
      if (tvt !== actor.id) return null;
    }

    try {
      const buffer = await this.storage.getBuffer(row.storageKey);
      return { buffer, filename: row.filename, contentType: row.mimeType };
    } catch {
      return null;
    }
  }
```

- [ ] **Step 4 : Passer l'`actor` depuis le controller**

Dans `documents.controller.ts`, modifier `raw` (~ligne 71) :

```ts
  @Get('documents/:id/raw')
  @Roles('admin', ...DELIVRABILITE_ROLES, 'technicien', 'finances')
  async raw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.svc.getRaw(id, { id: session.id, role: session.role });
    if (!result) throw new NotFoundException(`Document ${id} introuvable`);
    res.set({
      'Content-Type': result.contentType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(result.filename)}"`,
      'Cache-Control': 'private, max-age=3600',
    });
    return new StreamableFile(result.buffer);
  }
```

- [ ] **Step 5 : Lancer le test (green)**

Run: `cd /root/ECOI_backend && npx jest documents.service`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
cd /root/ECOI_backend && git add -A && git commit -m "fix(deliv): scope GET /documents/:id/raw au technicien attribué

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B4 : Suite backend complète

- [ ] **Step 1 : Lancer toute la suite**

Run: `cd /root/ECOI_backend && npm test`
Expected: PASS (résoudre toute régression résiduelle — typiquement un mock `getTechnicienVtId` manquant dans un spec service non listé).

- [ ] **Step 2 : Commit si correctifs**

```bash
cd /root/ECOI_backend && git add -A && git commit -m "test(deliv): fix mocks suite au rebase scoping technicien

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## FRONTEND

### Task F1 : Dérivation des événements planning (pure + testée)

**Files:**
- Create: `src/lib/technicienCalendar.ts`
- Test: `src/lib/technicienCalendar.test.ts`

- [ ] **Step 1 : Écrire le test (red)**

Create `src/lib/technicienCalendar.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { buildTechnicienEvents } from './technicienCalendar'
import type { ClientResponse } from './types'

function client(over: Partial<ClientResponse>): ClientResponse {
  return {
    id: 'c1', leadId: 'l1', rdvId: null,
    lead: { fullName: 'Aline Bee', city: 'Saint-Denis', phone: null },
    technicienVtId: 't1', poseTeamLeadId: null, adminReferentId: null,
    statusGlobal: 'vt_a_faire', currentPhase: 'vt', blocked: false, signedAt: null,
    steps: {}, ...over,
  }
}

describe('buildTechnicienEvents', () => {
  it('produit un événement VT et un événement installation datés', () => {
    const events = buildTechnicienEvents([
      client({ steps: {
        vt: { status: 'planifie', datePlanifiee: '2026-06-10', dateRealisee: null, problemReason: null },
        installation: { status: 'a_faire', datePlanifiee: '2026-06-20', dateRealisee: null, problemReason: null },
      } }),
    ])
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ date: '2026-06-10', type: 'vt', clientName: 'Aline Bee' })
    expect(events[1]).toMatchObject({ date: '2026-06-20', type: 'installation' })
  })

  it('ignore les phases sans date planifiée', () => {
    const events = buildTechnicienEvents([
      client({ steps: { vt: { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null } } }),
    ])
    expect(events).toHaveLength(0)
  })

  it('trie par date croissante', () => {
    const events = buildTechnicienEvents([
      client({ id: 'c2', steps: { installation: { status: 'a_faire', datePlanifiee: '2026-07-01', dateRealisee: null, problemReason: null } } }),
      client({ id: 'c1', steps: { vt: { status: 'a_faire', datePlanifiee: '2026-06-01', dateRealisee: null, problemReason: null } } }),
    ])
    expect(events.map((e) => e.date)).toEqual(['2026-06-01', '2026-07-01'])
  })
})
```

- [ ] **Step 2 : Lancer → échec attendu**

Run: `cd /root/ECOI_frontend && npx vitest run src/lib/technicienCalendar.test.ts`
Expected: FAIL (module absent).

- [ ] **Step 3 : Implémenter**

Create `src/lib/technicienCalendar.ts` :

```ts
import type { ClientResponse } from './types'

export type TechEventType = 'vt' | 'installation'

export type TechCalendarEvent = {
  clientId: string
  leadId: string
  date: string // YYYY-MM-DD (datePlanifiee)
  type: TechEventType
  clientName: string
  city: string | null
  status: string
}

/** Dérive les interventions terrain (VT + installation planifiées) à afficher au planning. */
export function buildTechnicienEvents(clients: ClientResponse[]): TechCalendarEvent[] {
  const events: TechCalendarEvent[] = []
  for (const c of clients) {
    const name = c.lead.fullName ?? 'Client'
    const phases: TechEventType[] = ['vt', 'installation']
    for (const type of phases) {
      const step = c.steps[type]
      if (step?.datePlanifiee) {
        events.push({
          clientId: c.id,
          leadId: c.leadId,
          date: step.datePlanifiee,
          type,
          clientName: name,
          city: c.lead.city,
          status: step.status,
        })
      }
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date))
}
```

- [ ] **Step 4 : Lancer (green)**

Run: `cd /root/ECOI_frontend && npx vitest run src/lib/technicienCalendar.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
cd /root/ECOI_frontend && git add -A && git commit -m "feat(technicien): dérivation des événements planning VT/installation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task F2 : Page planning (`/planning`)

**Files:**
- Create: `src/pages/technicien/TechnicienPlanning.tsx`

- [ ] **Step 1 : Créer la page**

Create `src/pages/technicien/TechnicienPlanning.tsx` :

```tsx
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { LoadingBlock } from '../../components/Spinner'
import { useClients } from '../../lib/hooks'
import { buildTechnicienEvents, type TechCalendarEvent } from '../../lib/technicienCalendar'

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// Cases du mois affiché, lundi en première colonne, grille 6 semaines.
function monthCells(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7 // 0 = lundi
  const start = new Date(first)
  start.setDate(first.getDate() - offset)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

export function TechnicienPlanning() {
  const navigate = useNavigate()
  const { data: clients, loading } = useClients({})
  const [cursor, setCursor] = useState(() => new Date())

  const eventsByDay = useMemo(() => {
    const map = new Map<string, TechCalendarEvent[]>()
    for (const e of buildTechnicienEvents(clients ?? [])) {
      const list = map.get(e.date) ?? []
      list.push(e)
      map.set(e.date, list)
    }
    return map
  }, [clients])

  const cells = useMemo(() => monthCells(cursor), [cursor])
  const todayKey = ymd(new Date())

  const upcoming = useMemo(
    () => buildTechnicienEvents(clients ?? []).filter((e) => e.date >= todayKey).slice(0, 8),
    [clients, todayKey],
  )

  return (
    <AppShell>
      <Topbar eyebrow="PLANNING" title="Mes interventions" />
      <main className="p-4 sm:p-6 md:p-8 flex-grow overflow-y-auto">
        <div className="flex items-center gap-3 mb-4">
          <button className="btn-secondary p-2 rounded-xl" aria-label="Mois précédent"
            onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>‹</button>
          <h2 className="font-black text-lg">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</h2>
          <button className="btn-secondary p-2 rounded-xl" aria-label="Mois suivant"
            onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>›</button>
          <button className="btn-secondary px-3 py-2 rounded-xl text-xs ml-2"
            onClick={() => setCursor(new Date())}>Aujourd'hui</button>
          <div className="ml-auto flex items-center gap-3 text-[11px] font-bold text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> VT</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Installation</span>
          </div>
        </div>

        {loading && !clients ? (
          <LoadingBlock label="Chargement du planning…" />
        ) : (
          <div className="glass-card !p-0 overflow-hidden">
            <div className="grid grid-cols-7 border-b border-line-soft">
              {WEEKDAYS.map((w) => (
                <div key={w} className="px-2 py-2 text-center eyebrow text-[10px] text-faint">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((d) => {
                const key = ymd(d)
                const list = eventsByDay.get(key) ?? []
                const muted = d.getMonth() !== cursor.getMonth()
                const isToday = key === todayKey
                return (
                  <div key={key} className={`min-h-[88px] border-l border-t border-line-soft p-1.5 flex flex-col gap-1 ${muted ? 'bg-white/30 text-faint' : 'bg-white/55'} ${isToday ? 'ring-2 ring-cuivre ring-inset' : ''}`}>
                    <span className="text-xs font-bold">{d.getDate()}</span>
                    {list.map((e) => (
                      <button key={`${e.clientId}-${e.type}`} onClick={() => navigate(`/suivi/${e.leadId}`)}
                        title={`${e.type === 'vt' ? 'VT' : 'Installation'} — ${e.clientName}${e.city ? ` · ${e.city}` : ''}`}
                        className={`text-left text-[10px] font-semibold rounded px-1.5 py-1 truncate text-white ${e.type === 'vt' ? 'bg-sky-500' : 'bg-emerald-500'}`}>
                        {e.clientName}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <section className="mt-6">
          <h3 className="eyebrow text-or-dark mb-2">Prochaines interventions</h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">Aucune intervention planifiée.</p>
          ) : (
            <ul className="divide-y divide-line-soft glass-card !p-0 overflow-hidden">
              {upcoming.map((e) => (
                <li key={`${e.clientId}-${e.type}-${e.date}`}>
                  <button onClick={() => navigate(`/suivi/${e.leadId}`)}
                    className="w-full text-left px-4 py-3 hover:bg-cream/60 flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${e.type === 'vt' ? 'bg-sky-500' : 'bg-emerald-500'}`} />
                    <span className="font-bold">{e.clientName}</span>
                    <span className="text-xs text-muted">{e.type === 'vt' ? 'VT' : 'Installation'}{e.city ? ` · ${e.city}` : ''}</span>
                    <span className="ml-auto text-xs tabular-nums text-muted">{e.date}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </AppShell>
  )
}
```

- [ ] **Step 2 : Typecheck**

Run: `cd /root/ECOI_frontend && npx tsc -b --noEmit`
Expected: PASS (la page n'est pas encore routée ; vérifie surtout le typage).

- [ ] **Step 3 : Commit**

```bash
cd /root/ECOI_frontend && git add -A && git commit -m "feat(technicien): page planning mensuel VT/installation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task F3 : Page « Mes dossiers » (`/mes-dossiers`)

**Files:**
- Create: `src/pages/technicien/TechnicienDossiers.tsx`

- [ ] **Step 1 : Créer la page**

Create `src/pages/technicien/TechnicienDossiers.tsx` :

```tsx
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { LoadingBlock } from '../../components/Spinner'
import { useClients } from '../../lib/hooks'
import type { ClientResponse, WorkflowPhase } from '../../lib/types'

const PHASE_LABEL: Record<WorkflowPhase, string> = {
  vt: 'Visite technique', dp: 'Déclaration préalable', racco: 'Raccordement',
  consuel: 'Consuel', installation: 'Installation', mes: 'Mise en service',
}

function nextFieldDate(c: ClientResponse): string | null {
  return c.steps.vt?.datePlanifiee ?? c.steps.installation?.datePlanifiee ?? null
}

export function TechnicienDossiers() {
  const navigate = useNavigate()
  const { data: clients, loading } = useClients({})

  return (
    <AppShell>
      <Topbar eyebrow="MES DOSSIERS" title="Dossiers qui me sont attribués" />
      <main className="p-4 sm:p-6 md:p-8 flex-grow overflow-y-auto">
        {loading && !clients ? (
          <LoadingBlock label="Chargement des dossiers…" />
        ) : !clients || clients.length === 0 ? (
          <p className="text-sm text-muted">Aucun dossier ne vous est attribué pour le moment.</p>
        ) : (
          <ul className="divide-y divide-line-soft glass-card !p-0 overflow-hidden">
            {clients.map((c) => {
              const date = nextFieldDate(c)
              return (
                <li key={c.id}>
                  <button onClick={() => navigate(`/suivi/${c.leadId}`)}
                    className="w-full text-left px-4 py-3 hover:bg-cream/60 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold truncate">{c.lead.fullName ?? 'Client'}</div>
                      <div className="text-xs text-muted truncate">
                        {[c.lead.city, c.lead.phone].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-muted shrink-0">{PHASE_LABEL[c.currentPhase]}</span>
                    {c.blocked && <span className="text-[10px] font-bold text-rouille shrink-0">bloqué</span>}
                    {date && <span className="text-xs tabular-nums text-muted shrink-0">{date}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </AppShell>
  )
}
```

- [ ] **Step 2 : Typecheck**

Run: `cd /root/ECOI_frontend && npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
cd /root/ECOI_frontend && git add -A && git commit -m "feat(technicien): page liste de mes dossiers attribués

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task F4 : Nav réduite du technicien (Sidebar)

**Files:**
- Modify: `src/components/shell/Sidebar.tsx`

- [ ] **Step 1 : Court-circuiter `sections` pour le technicien**

Dans `Sidebar.tsx`, au tout début du `useMemo` qui calcule `sections` (~ligne 109), ajouter avant le calcul `isOps` :

```ts
  const sections = useMemo(() => {
    if (role === 'technicien') {
      return [
        {
          id: 'technicien',
          label: 'Espace',
          items: [
            { to: '/planning', icon: 'calendar' as const, label: 'Planning' },
            { to: '/mes-dossiers', icon: 'inbox' as const, label: 'Mes dossiers' },
          ],
        },
      ]
    }
    const isOps =
      role === 'delivrabilite' ||
      role === 'responsable_technique' ||
      role === 'back_office'
    // ... (suite inchangée, sans 'technicien' dans isOps)
```

Retirer la ligne `role === 'technicien' ||` du bloc `isOps` existant (le technicien ne passe plus jamais par cette branche).

- [ ] **Step 2 : Typecheck + build**

Run: `cd /root/ECOI_frontend && npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
cd /root/ECOI_frontend && git add -A && git commit -m "feat(technicien): nav réduite à Planning + Mes dossiers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task F5 : Routing + redirections technicien

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1 : Imports**

Dans `src/main.tsx`, ajouter après les imports de pages (~ligne 29) :

```tsx
import { TechnicienPlanning } from './pages/technicien/TechnicienPlanning'
import { TechnicienDossiers } from './pages/technicien/TechnicienDossiers'
import { useAuth } from './lib/auth'
```

- [ ] **Step 2 : Composants de garde/redirection**

Avant la déclaration `const router = ...` (~ligne 31), ajouter :

```tsx
function RoleHome() {
  const role = useAuth((s) => s.user?.role)
  return <Navigate to={role === 'technicien' ? '/planning' : '/overview'} replace />
}

function NoTechnicien({ children }: { children: React.ReactElement }) {
  const role = useAuth((s) => s.user?.role)
  if (role === 'technicien') return <Navigate to="/planning" replace />
  return children
}
```

(Ajouter `import { type ReactElement } from 'react'` ou utiliser `React.ReactElement` — selon le style du fichier ; importer `React` si nécessaire.)

- [ ] **Step 3 : Routes**

Dans le tableau `children` du bloc `<RequireAuth />`, ajouter les 2 routes technicien et envelopper les pages ops avec `NoTechnicien` :

```tsx
          { path: '/planning', element: <TechnicienPlanning /> },
          { path: '/mes-dossiers', element: <TechnicienDossiers /> },
          { path: '/overview', element: <NoTechnicien><Overview /></NoTechnicien> },
          { path: '/leads', element: <NoTechnicien><LeadsList /></NoTechnicien> },
          { path: '/rdv', element: <NoTechnicien><RdvCalendar /></NoTechnicien> },
          { path: '/analytics', element: <NoTechnicien><Analytics /></NoTechnicien> },
          { path: '/notifications', element: <NoTechnicien><Notifications /></NoTechnicien> },
          { path: '/suivi', element: <NoTechnicien><Suivi /></NoTechnicien> },
```

Remplacer les anciennes lignes correspondantes (`/overview`, `/leads`, `/rdv`, `/analytics`, `/notifications`, `/suivi`). Laisser `/client`, `/client/:id`, `/suivi/:id` accessibles (board scopé backend). Remplacer la route catch-all :

```tsx
          { path: '*', element: <RoleHome /> },
```

- [ ] **Step 4 : Build complet**

Run: `cd /root/ECOI_frontend && npm run build`
Expected: PASS (build Vite + tsc -b, plus strict que `tsc --noEmit`).

- [ ] **Step 5 : Commit**

```bash
cd /root/ECOI_frontend && git add -A && git commit -m "feat(technicien): routes /planning /mes-dossiers + redirection des pages ops

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task F6 : Gating par phase du board

**Files:**
- Modify: `src/components/suivi/WorkflowBoard.tsx`
- Modify: `src/components/suivi/SubstepCard.tsx`
- Modify: `src/pages/SuiviDetail.tsx`

- [ ] **Step 1 : Prop `canEditPhase` sur `WorkflowBoard`**

Dans `WorkflowBoard.tsx`, ajouter au type `Props` :

```ts
import type { SubstepResponse, UpdateSubstepPatch, WorkflowPhase } from '../../lib/types'

type Props = {
  substeps: SubstepResponse[]
  onMutate: (id: string, patch: UpdateSubstepPatch) => void
  today: string
  savingId?: string | null
  onDocsChanged?: () => void
  canEditPhase?: (phase: WorkflowPhase) => boolean
}
```

Destructurer `canEditPhase` et le propager dans `renderList` :

```tsx
export function WorkflowBoard({ substeps, onMutate, today, savingId, onDocsChanged, canEditPhase }: Props) {
  // ...
  const renderList = (list: SubstepResponse[]) => (
    <div className="wf-list">
      {list.map((s) => (
        <SubstepCard
          key={s.id}
          substep={s}
          onMutate={onMutate}
          today={today}
          saving={savingId === s.id}
          onDocsChanged={onDocsChanged}
          readOnly={canEditPhase ? !canEditPhase(s.phase) : false}
        />
      ))}
    </div>
  )
```

- [ ] **Step 2 : Prop `readOnly` sur `SubstepCard`**

Dans `SubstepCard.tsx`, ajouter `readOnly?: boolean` au type `Props` et l'utiliser pour neutraliser l'édition. Modifier la signature :

```tsx
export function SubstepCard({ substep, onMutate, today, saving, onDocsChanged, readOnly }: Props) {
```

Remplacer le bloc des champs (~lignes 85-99) pour rendre une vue lecture seule quand `readOnly` :

```tsx
        {locked ? (
          <p className="wf-locked-note"><Icon name="shield" size={13} /> En attente d'une étape précédente</p>
        ) : readOnly ? (
          <div className="wf-substep-fields wf-readonly">
            {substep.dateRealisee && <p className="wf-field-ro"><span>Date</span> {substep.dateRealisee}</p>}
            {substep.notes && <p className="wf-field-ro"><span>Notes</span> {substep.notes}</p>}
            <p className="wf-field-ro wf-field-ro-status"><span>Statut</span> {substep.status}</p>
          </div>
        ) : (
          <div className="wf-substep-fields">
            <label className="wf-field">
              <span>Date prévue / réalisation</span>
              <input type="date" value={date} onChange={(e) => { setDate(e.target.value); debounced({ dateRealisee: e.target.value || null }) }} />
            </label>
            <label className="wf-field">
              <span>Notes</span>
              <textarea rows={2} value={notes} placeholder="Notes internes, blocages, contact…"
                onChange={(e) => { setNotes(e.target.value); debounced({ notes: e.target.value || null }) }} />
            </label>
          </div>
        )}
```

Pour la zone documents (~ligne 101), conserver la liste mais masquer dropzone + suppression quand `readOnly` :

```tsx
        {!locked && substep.expectedDocs.length > 0 && (
          <div className="wf-docs">
            <div className="wf-docs-head">
              <span>Documents</span>
              {substep.missingDocument && <span className="wf-docs-missing"><Icon name="tag" size={11} /> pièce manquante</span>}
            </div>
            {substep.documents.length > 0 && (
              <ul className="wf-docs-list">
                {substep.documents.map((d) => (
                  <li key={d.id} className="wf-doc">
                    <a className="wf-doc-name" href={substepDocumentRawUrl(d.id)} target="_blank" rel="noreferrer" title={d.filename}>
                      <Icon name="check" size={12} /> <span>{d.filename}</span>
                    </a>
                    <span className="wf-doc-size">{Math.max(1, Math.round(d.sizeBytes / 1024))} Ko</span>
                    {!readOnly && (
                      <button type="button" className="wf-doc-del" onClick={() => void onDeleteDoc(d.id)} aria-label="Supprimer le document">
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!readOnly && (
              <FileDropzone
                id={`docs-${substep.id}`}
                multiple
                uploading={uploading}
                title="Déposer un ou plusieurs fichiers"
                subtitle="Tout type · 25 Mo / fichier"
                onFiles={(files) => void onUploadFiles(files)}
              />
            )}
            {docError && <p className="wf-docs-error">{docError}</p>}
          </div>
        )}
```

Masquer le bouton d'action quand `readOnly` (~ligne 134) :

```tsx
        {!readOnly && (
          <footer className="wf-substep-foot">
            <button type="button" className="wf-cta" disabled={locked || saving} onClick={onAction}>
              {done ? 'Rouvrir' : substep.actionLabel}
            </button>
            {saving && <span className="wf-saving">…</span>}
          </footer>
        )}
```

- [ ] **Step 3 : Prédicat + breadcrumb dans `SuiviDetail`**

Dans `SuiviDetail.tsx`, ajouter le type d'import et le prédicat. En haut du composant (après `const role = ...`, ~ligne 17) :

```tsx
  const FIELD_PHASES: WorkflowPhase[] = ['vt', 'installation']
  const canEditPhase = (phase: WorkflowPhase) =>
    role === 'technicien' ? FIELD_PHASES.includes(phase) : true
```

Ajouter `WorkflowPhase` à l'import types (ligne 14) :

```tsx
import type { UpdateSubstepPatch, WorkflowPhase } from '../lib/types'
```

Passer le prédicat au board (~ligne 114) :

```tsx
                <WorkflowBoard substeps={substeps ?? []} onMutate={onMutate} today={today} savingId={savingId} onDocsChanged={refetch} canEditPhase={canEditPhase} />
```

Adapter le breadcrumb (~ligne 79) pour ne pas renvoyer le technicien vers `/suivi` (page non accessible) :

```tsx
        <nav className="suivi-breadcrumb">
          <Link to={role === 'technicien' ? '/mes-dossiers' : '/suivi'}>← {role === 'technicien' ? 'Mes dossiers' : 'Tous les dossiers'}</Link>
        </nav>
```

Et le `Navigate` de secours `if (!id) return <Navigate to="/suivi" replace />` (~ligne 70) :

```tsx
  if (!id) return <Navigate to={role === 'technicien' ? '/mes-dossiers' : '/suivi'} replace />
```

- [ ] **Step 4 : Style lecture seule (optionnel mais propre)**

Dans `src/index.css`, ajouter une règle discrète pour `.wf-readonly` / `.wf-field-ro` (texte compact, libellé en gras) :

```css
.wf-field-ro { font-size: 12px; color: var(--muted, #6b7280); margin: 2px 0; }
.wf-field-ro span { font-weight: 700; margin-right: 6px; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
```

- [ ] **Step 5 : Build**

Run: `cd /root/ECOI_frontend && npm run build`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
cd /root/ECOI_frontend && git add -A && git commit -m "feat(technicien): board en lecture seule hors phases terrain (vt/installation)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task F7 : Vérification finale frontend

- [ ] **Step 1 : Tests + build**

Run: `cd /root/ECOI_frontend && npx vitest run && npm run build`
Expected: PASS (tests verts + build OK).

- [ ] **Step 2 : Vérification manuelle (à faire tourner par l'utilisateur)**

Se connecter en `technicien` :
- Atterrissage sur `/planning`, sidebar = 2 entrées (Planning, Mes dossiers).
- Le calendrier montre VT + installations planifiées, rien d'autre.
- `/mes-dossiers` ne liste que les dossiers attribués.
- Ouvrir un dossier : phases vt/installation éditables, dp/racco/consuel/mes en lecture seule.
- Taper `/overview` ou `/analytics` à la main → redirigé vers `/planning`.

---

## Self-Review (effectué)

- **Couverture spec :** §1-5 backend → B1-B4 ; §6 Sidebar → F4 ; §7 routing → F5 ; §8 planning → F1-F2 ; §9 liste → F3 (déviation documentée : page dédiée au lieu de `ClientsList`) ; §10 gating → F6.
- **Placeholders :** aucun TODO/TBD ; tout le code est fourni.
- **Cohérence des types :** signature `canEditStep/canEditSubstep` passe de `responsableId` à `clientTechnicienVtId` partout (permissions + 3 services + tests) ; `getTechnicienVtId(clientId, executor?)` stable ; `buildTechnicienEvents` / `TechCalendarEvent` cohérents entre F1/F2 ; prop `canEditPhase(phase)` ↔ `readOnly` cohérente F6.
- **Note :** `/leads` et `/rdv` restent `ALL_ROLES` côté API (hors scope spec) ; les pages sont masquées/redirigées mais le hook `useLeads` reste techniquement appelable — exposition de métadonnées leads non bloquante, à traiter dans un chantier séparé si besoin.
