# VT technicien — notifications + calendrier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quand une VT est attribuée/replanifiée à un technicien dans la page Suivi, lui envoyer une notification in-app persistée + temps réel, et afficher la VT dans la page « Calendrier » (`/rdv`).

**Architecture:** Backend NestJS (ECOI_backend) — nouveau module Notifications branché sur la table `notifications` existante, déclencheurs dans `clients.service` (attribution) et `substeps.service` (changement de date), et endpoint `GET /clients/vt-calendar`. Frontend React (ECOI_frontend) — hooks `useNotifications`/`useVtCalendar`, affichage VT dans `RdvCalendar`, intégration des notifs persistées dans `Notifications.tsx`, ciblage par `userId` dans `realtime.ts`.

**Tech Stack:** NestJS, Drizzle ORM, socket.io, Zod (nestjs-zod), Jest (backend) ; React, TypeScript, Vitest/Testing-Library (frontend).

**Contraintes repo (rappel):**
- Deux repos git **séparés** : `ECOI_backend` et `ECOI_frontend`. Commits indépendants dans chacun.
- **DB de test indisponible** → côté backend, on teste des **fonctions pures** (helpers extraits) en Jest ; le câblage DB (service/controller) est validé par **typecheck/build** (`npx tsc --noEmit` ou `npm run build`), pas par test d'intégration.
- Commits **scopés fichier par fichier** (WIP concurrent). Stage explicitement les fichiers listés, jamais `git add -A`.
- Spec de référence : `ECOI_frontend/docs/superpowers/specs/2026-06-08-vt-technicien-notif-calendrier-design.md`.

---

## File Structure

**Backend (`ECOI_backend/`):**
- Create: `src/modules/notifications/notifications.service.ts` — CRUD notifs + `createAndEmit`.
- Create: `src/modules/notifications/notifications.controller.ts` — `GET /notifications`, `PATCH /:id/read`, `POST /read-all`.
- Create: `src/modules/notifications/notifications.module.ts` — module.
- Create: `src/modules/notifications/dto/notification-response.dto.ts` — type + mapper.
- Create: `src/modules/notifications/dto/query-notifications.dto.ts` — Zod query.
- Create: `src/modules/notifications/notif-messages.ts` — **fonctions pures** de construction des messages (testables).
- Create: `src/modules/notifications/notif-messages.spec.ts` — tests purs.
- Modify: `src/modules/realtime/realtime.events.ts` — étendre `RealtimeNotification` (`userId?`, kinds VT).
- Modify: `src/app.module.ts` — enregistrer `NotificationsModule`.
- Modify: `src/modules/delivrabilite/clients.service.ts` — déclencheur `vt_assigned` + helper pur `shouldNotifyAssignment`.
- Create: `src/modules/delivrabilite/vt-assignment-notify.ts` — helper pur `shouldNotifyAssignment`.
- Create: `src/modules/delivrabilite/vt-assignment-notify.spec.ts` — tests purs.
- Modify: `src/modules/delivrabilite/substeps.service.ts` — déclencheur `vt_date_changed` + helper pur `shouldNotifyVtDateChange`.
- Create: `src/modules/delivrabilite/vt-date-change-notify.ts` — helper pur.
- Create: `src/modules/delivrabilite/vt-date-change-notify.spec.ts` — tests purs.
- Create: `src/modules/delivrabilite/vt-calendar.ts` — **fonctions pures** : sélection de date VT + filtre période + scoping.
- Create: `src/modules/delivrabilite/vt-calendar.spec.ts` — tests purs.
- Modify: `src/modules/delivrabilite/clients.service.ts` — méthode `vtCalendar(...)` (câblage DB).
- Modify: `src/modules/delivrabilite/clients.controller.ts` — route `GET /clients/vt-calendar`.
- Create: `src/modules/delivrabilite/dto/vt-calendar.dto.ts` — types + Zod query.

**Frontend (`ECOI_frontend/`):**
- Modify: `src/lib/types.ts` — `NotificationResponse`, `VtCalendarEntry`.
- Modify: `src/lib/api.ts` — `markNotificationRead`, `markAllNotificationsRead`.
- Modify: `src/lib/hooks.ts` — `useNotifications`, `useVtCalendar`.
- Modify: `src/pages/rdv/RdvCalendar.tsx` — variante `CalendarItem` `source: 'vt'` + popup VT.
- Create: `src/pages/rdv/RdvCalendar.vt.test.tsx` — rendu VT.
- Modify: `src/pages/Notifications.tsx` — intégrer notifs persistées.
- Modify: `src/lib/realtime.ts` — filtrage `userId`.
- Create: `src/lib/realtime.test.ts` — filtrage `userId` (extraire un helper pur `shouldSurfaceNotification`).
- Create: `src/lib/realtimeNotify.ts` — helper pur `shouldSurfaceNotification`.

---

# PARTIE A — BACKEND (`ECOI_backend`)

## Task 1: Étendre le type RealtimeNotification

**Files:**
- Modify: `src/modules/realtime/realtime.events.ts`

- [ ] **Step 1: Étendre `RealtimeNotification`**

Remplacer le type existant par :

```typescript
export type RealtimeNotification = {
  id: string;
  kind:
    | 'new_lead'
    | 'callback_due'
    | 'callback_scheduled'
    | 'lead_updated'
    | 'workflow_blocked'
    | 'vt_assigned'
    | 'vt_date_changed';
  title: string;
  body: string;
  /** Destinataire ciblé. Si absent : broadcast legacy (tous). */
  userId?: string;
  leadId?: string;
  workflowStepId?: string;
  clientId?: string;
  createdAt: string;
};
```

- [ ] **Step 2: Typecheck**

Run: `cd ECOI_backend && npx tsc --noEmit`
Expected: PASS (les emit existants restent valides, on n'a fait qu'ajouter des champs optionnels et des kinds).

- [ ] **Step 3: Commit**

```bash
cd ECOI_backend
git add src/modules/realtime/realtime.events.ts
git commit -m "feat(realtime): RealtimeNotification — userId ciblé + kinds VT"
```

---

## Task 2: Messages de notification (fonctions pures + tests)

**Files:**
- Create: `src/modules/notifications/notif-messages.ts`
- Test: `src/modules/notifications/notif-messages.spec.ts`

- [ ] **Step 1: Écrire le test (échoue)**

`src/modules/notifications/notif-messages.spec.ts` :

```typescript
import { vtAssignedMessage, vtDateChangedMessage, formatFrDate } from './notif-messages';

describe('notif-messages', () => {
  it('formatFrDate formate une date ISO date-only en JJ/MM/AAAA', () => {
    expect(formatFrDate('2026-06-03')).toBe('03/06/2026');
  });

  it('formatFrDate renvoie vide si null', () => {
    expect(formatFrDate(null)).toBe('');
  });

  it('vtAssignedMessage compose titre + corps', () => {
    expect(vtAssignedMessage({ leadName: 'Jean Dupont', city: 'Saint-Denis' })).toEqual({
      title: 'Nouvelle VT attribuée',
      body: 'Jean Dupont — Saint-Denis',
    });
  });

  it('vtAssignedMessage gère ville absente', () => {
    expect(vtAssignedMessage({ leadName: 'Jean Dupont', city: null })).toEqual({
      title: 'Nouvelle VT attribuée',
      body: 'Jean Dupont',
    });
  });

  it('vtDateChangedMessage inclut la date formatée', () => {
    expect(vtDateChangedMessage({ leadName: 'Jean Dupont', date: '2026-06-03' })).toEqual({
      title: 'Date de VT mise à jour',
      body: 'Jean Dupont — VT le 03/06/2026',
    });
  });
});
```

- [ ] **Step 2: Lancer → échoue (module introuvable)**

Run: `cd ECOI_backend && npx jest src/modules/notifications/notif-messages.spec.ts`
Expected: FAIL "Cannot find module './notif-messages'".

- [ ] **Step 3: Implémenter**

`src/modules/notifications/notif-messages.ts` :

```typescript
export function formatFrDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  // isoDate est 'YYYY-MM-DD' (date-only) → format JJ/MM/AAAA sans dépendre du fuseau.
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

export function vtAssignedMessage(input: {
  leadName: string;
  city: string | null;
}): { title: string; body: string } {
  const body = [input.leadName, input.city].filter(Boolean).join(' — ');
  return { title: 'Nouvelle VT attribuée', body };
}

export function vtDateChangedMessage(input: {
  leadName: string;
  date: string | null;
}): { title: string; body: string } {
  const fr = formatFrDate(input.date);
  const body = fr ? `${input.leadName} — VT le ${fr}` : `${input.leadName} — VT replanifiée`;
  return { title: 'Date de VT mise à jour', body };
}
```

- [ ] **Step 4: Lancer → passe**

Run: `cd ECOI_backend && npx jest src/modules/notifications/notif-messages.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd ECOI_backend
git add src/modules/notifications/notif-messages.ts src/modules/notifications/notif-messages.spec.ts
git commit -m "feat(notifications): messages VT (fonctions pures) + tests"
```

---

## Task 3: DTOs Notifications

**Files:**
- Create: `src/modules/notifications/dto/notification-response.dto.ts`
- Create: `src/modules/notifications/dto/query-notifications.dto.ts`

- [ ] **Step 1: Type de réponse + mapper**

`src/modules/notifications/dto/notification-response.dto.ts` :

```typescript
import type { notifications } from '../../../db/schema';

export type NotificationResponse = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
};

export function toNotificationResponse(
  row: typeof notifications.$inferSelect,
): NotificationResponse {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    payload: row.payload ?? null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
```

- [ ] **Step 2: DTO de query Zod**

`src/modules/notifications/dto/query-notifications.dto.ts` :

```typescript
import { z } from 'zod';

export const queryNotificationsSchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export type QueryNotificationsDto = z.infer<typeof queryNotificationsSchema>;
```

- [ ] **Step 3: Vérifier l'export `notifications` du schéma**

Run: `cd ECOI_backend && grep -rn "notifications" src/db/schema/index.ts`
Expected: la table `notifications` est ré-exportée. Si absente, ajouter `export * from './notifications';` dans `src/db/schema/index.ts` (et l'inclure dans ce commit).

- [ ] **Step 4: Typecheck**

Run: `cd ECOI_backend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ECOI_backend
git add src/modules/notifications/dto/notification-response.dto.ts src/modules/notifications/dto/query-notifications.dto.ts
# inclure src/db/schema/index.ts seulement si modifié à l'étape 3
git commit -m "feat(notifications): DTOs réponse + query"
```

---

## Task 4: NotificationsService + Controller + Module

**Files:**
- Create: `src/modules/notifications/notifications.service.ts`
- Create: `src/modules/notifications/notifications.controller.ts`
- Create: `src/modules/notifications/notifications.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Service**

`src/modules/notifications/notifications.service.ts` :

```typescript
import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DB_PROVIDER } from '../../db/db.module';
import type { Db } from '../../db/client';
import { notifications } from '../../db/schema';
import { RealtimeService } from '../realtime/realtime.service';
import type { RealtimeNotification } from '../realtime/realtime.events';
import { toNotificationResponse, type NotificationResponse } from './dto/notification-response.dto';

type CreateInput = {
  userId: string;
  type: RealtimeNotification['kind'];
  title: string;
  body?: string | null;
  payload?: Record<string, unknown> | null;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB_PROVIDER) private readonly db: Db,
    @Optional() private readonly realtime?: RealtimeService,
  ) {}

  async create(input: CreateInput): Promise<typeof notifications.$inferSelect> {
    const [row] = await this.db
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        payload: (input.payload ?? null) as never,
      })
      .returning();
    return row;
  }

  /** Persiste la notif puis l'émet en temps réel (ciblée via userId). Best-effort. */
  async createAndEmit(input: CreateInput): Promise<void> {
    try {
      const row = await this.create(input);
      this.realtime?.emitNotification({
        id: row.id,
        kind: input.type,
        title: input.title,
        body: input.body ?? '',
        userId: input.userId,
        ...(input.payload ?? {}),
        createdAt: row.createdAt.toISOString(),
      } as RealtimeNotification);
    } catch (err) {
      this.logger.error(`createAndEmit a échoué pour ${input.userId}/${input.type}`, err as Error);
    }
  }

  async findForUser(
    userId: string,
    opts: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<NotificationResponse[]> {
    const conditions = [eq(notifications.userId, userId)];
    if (opts.unreadOnly) conditions.push(isNull(notifications.readAt));
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(opts.limit ?? 100);
    return rows.map(toNotificationResponse);
  }

  async markRead(id: string, userId: string): Promise<NotificationResponse> {
    const [existing] = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException(`Notification ${id} introuvable`);
    if (existing.userId !== userId) throw new ForbiddenException('Notification non accessible');
    const [updated] = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.id, id))
      .returning();
    return toNotificationResponse(updated);
  }

  async markAllRead(userId: string): Promise<{ ok: true }> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { ok: true };
  }
}
```

- [ ] **Step 2: Controller**

`src/modules/notifications/notifications.controller.ts` :

```typescript
import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { SessionUser } from '../../auth/auth.service';
import { NotificationsService } from './notifications.service';
import { queryNotificationsSchema, type QueryNotificationsDto } from './dto/query-notifications.dto';
import type { NotificationResponse } from './dto/notification-response.dto';

@ApiTags('notifications')
@ApiCookieAuth('ecoi.session_token')
@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(queryNotificationsSchema)) q: QueryNotificationsDto,
    @CurrentUser() session: SessionUser,
  ): Promise<NotificationResponse[]> {
    return this.svc.findForUser(session.id, { unreadOnly: q.unreadOnly, limit: q.limit });
  }

  @Patch(':id/read')
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() session: SessionUser,
  ): Promise<NotificationResponse> {
    return this.svc.markRead(id, session.id);
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() session: SessionUser): Promise<{ ok: true }> {
    return this.svc.markAllRead(session.id);
  }
}
```

- [ ] **Step 3: Module**

`src/modules/notifications/notifications.module.ts` :

```typescript
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

> Note : `RealtimeModule` est `@Global` et exporte `RealtimeService`, donc pas besoin de l'importer ici. `DB_PROVIDER` vient de `DbModule` (global).

- [ ] **Step 4: Enregistrer dans app.module.ts**

Dans `src/app.module.ts`, ajouter l'import en haut :

```typescript
import { NotificationsModule } from "./modules/notifications/notifications.module";
```

Et ajouter `NotificationsModule,` dans le tableau `imports` (juste après `DelivrabiliteModule,`). Retirer `NotificationsModule` de la liste « À venir » du commentaire.

- [ ] **Step 5: Vérifier les chemins d'auth**

Run: `cd ECOI_backend && ls src/auth/guards/auth.guard.ts src/auth/decorators/current-user.decorator.ts && grep -n "SessionUser" src/auth/auth.service.ts | head -1`
Expected: les 2 fichiers existent et `SessionUser` est exporté (mêmes imports que `clients.controller.ts`).

- [ ] **Step 6: Typecheck + build**

Run: `cd ECOI_backend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd ECOI_backend
git add src/modules/notifications/notifications.service.ts src/modules/notifications/notifications.controller.ts src/modules/notifications/notifications.module.ts src/app.module.ts
git commit -m "feat(notifications): service + controller + module (GET/PATCH/read-all)"
```

---

## Task 5: Déclencheur VT attribuée (helper pur + câblage)

**Files:**
- Create: `src/modules/delivrabilite/vt-assignment-notify.ts`
- Test: `src/modules/delivrabilite/vt-assignment-notify.spec.ts`
- Modify: `src/modules/delivrabilite/clients.service.ts`

- [ ] **Step 1: Test du helper pur (échoue)**

`src/modules/delivrabilite/vt-assignment-notify.spec.ts` :

```typescript
import { shouldNotifyAssignment } from './vt-assignment-notify';

describe('shouldNotifyAssignment', () => {
  it('notifie quand un technicien est nouvellement assigné', () => {
    expect(shouldNotifyAssignment(null, 'tech-1')).toBe('tech-1');
  });

  it('notifie quand le technicien change', () => {
    expect(shouldNotifyAssignment('tech-1', 'tech-2')).toBe('tech-2');
  });

  it('ne notifie pas si inchangé', () => {
    expect(shouldNotifyAssignment('tech-1', 'tech-1')).toBeNull();
  });

  it('ne notifie pas si désassignation (nouveau = null)', () => {
    expect(shouldNotifyAssignment('tech-1', null)).toBeNull();
  });

  it('ne notifie pas si toujours nul', () => {
    expect(shouldNotifyAssignment(null, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer → échoue**

Run: `cd ECOI_backend && npx jest src/modules/delivrabilite/vt-assignment-notify.spec.ts`
Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implémenter le helper**

`src/modules/delivrabilite/vt-assignment-notify.ts` :

```typescript
/**
 * Retourne l'id du technicien à notifier, ou null si aucune notification ne
 * doit partir. On notifie uniquement à l'ASSIGNATION (nouveau technicien non
 * nul et différent de l'ancien), jamais à la désassignation.
 */
export function shouldNotifyAssignment(
  previousTechId: string | null,
  nextTechId: string | null,
): string | null {
  if (!nextTechId) return null;
  if (nextTechId === previousTechId) return null;
  return nextTechId;
}
```

- [ ] **Step 4: Lancer → passe**

Run: `cd ECOI_backend && npx jest src/modules/delivrabilite/vt-assignment-notify.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Câbler dans clients.service.ts**

5a. En haut du fichier `src/modules/delivrabilite/clients.service.ts`, ajouter les imports :

```typescript
import { Optional } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { shouldNotifyAssignment } from './vt-assignment-notify';
import { vtAssignedMessage } from '../notifications/notif-messages';
```

> `Inject`, `Injectable`, `ForbiddenException`, `NotFoundException` sont déjà importés ; ajouter seulement `Optional` à la liste `@nestjs/common` existante (ne pas dupliquer la ligne d'import).

5b. Ajouter `NotificationsService` au constructeur en `@Optional()` (pour ne pas casser les specs qui instancient le service sans ce provider) :

```typescript
constructor(
  @Inject(DB_PROVIDER) private readonly db: Db,
  // ... providers existants conservés à l'identique ...
  @Optional() private readonly notifications?: NotificationsService,
) {}
```

> ⚠️ Repérer le constructeur existant et **ajouter** le paramètre `@Optional()` en dernier sans toucher aux autres.

5c. Dans `assignTechnicien`, juste **avant** le `return toClientResponse(...)` (après avoir chargé `lead`), insérer :

```typescript
const techToNotify = shouldNotifyAssignment(
  existing.technicienVtId,
  updated.technicienVtId,
);
if (techToNotify && this.notifications) {
  const leadName = [lead?.firstName, lead?.lastName].filter(Boolean).join(' ').trim() || 'Client';
  const { title, body } = vtAssignedMessage({ leadName, city: lead?.city ?? null });
  await this.notifications.createAndEmit({
    userId: techToNotify,
    type: 'vt_assigned',
    title,
    body,
    payload: { clientId: updated.id, leadId: updated.leadId },
  });
}
```

> `createAndEmit` est déjà best-effort (try/catch interne) : aucune erreur ne remontera dans `assignTechnicien`.

- [ ] **Step 6: Vérifier que NotificationsService est résolvable**

`NotificationsModule` exporte `NotificationsService`. Vérifier que `DelivrabiliteModule` peut l'injecter : ajouter `NotificationsModule` aux `imports` de `src/modules/delivrabilite/delivrabilite.module.ts`.

Run: `cd ECOI_backend && grep -n "imports" src/modules/delivrabilite/delivrabilite.module.ts`
Puis ajouter l'import de classe en haut et `NotificationsModule` dans `imports`.

- [ ] **Step 7: Typecheck + tests delivrabilité existants**

Run: `cd ECOI_backend && npx tsc --noEmit && npx jest src/modules/delivrabilite/clients.service.spec.ts`
Expected: PASS (le `@Optional()` garde les specs existantes vertes ; `notifications` y sera `undefined`).

- [ ] **Step 8: Commit**

```bash
cd ECOI_backend
git add src/modules/delivrabilite/vt-assignment-notify.ts src/modules/delivrabilite/vt-assignment-notify.spec.ts src/modules/delivrabilite/clients.service.ts src/modules/delivrabilite/delivrabilite.module.ts
git commit -m "feat(delivrabilite): notifier le technicien à l'attribution d'une VT"
```

---

## Task 6: Déclencheur changement de date VT (helper pur + câblage)

**Files:**
- Create: `src/modules/delivrabilite/vt-date-change-notify.ts`
- Test: `src/modules/delivrabilite/vt-date-change-notify.spec.ts`
- Modify: `src/modules/delivrabilite/substeps.service.ts`

- [ ] **Step 1: Test du helper pur (échoue)**

`src/modules/delivrabilite/vt-date-change-notify.spec.ts` :

```typescript
import { shouldNotifyVtDateChange } from './vt-date-change-notify';

describe('shouldNotifyVtDateChange', () => {
  it('notifie quand la date du vt_planifie change', () => {
    expect(
      shouldNotifyVtDateChange({ key: 'vt_planifie', beforeDate: null, nextDate: '2026-06-03' }),
    ).toBe(true);
  });

  it('ne notifie pas si même date', () => {
    expect(
      shouldNotifyVtDateChange({ key: 'vt_planifie', beforeDate: '2026-06-03', nextDate: '2026-06-03' }),
    ).toBe(false);
  });

  it('ne notifie pas si date absente dans le patch', () => {
    expect(
      shouldNotifyVtDateChange({ key: 'vt_planifie', beforeDate: '2026-06-03', nextDate: undefined }),
    ).toBe(false);
  });

  it("ne notifie pas pour une autre sous-étape", () => {
    expect(
      shouldNotifyVtDateChange({ key: 'vt_validee', beforeDate: null, nextDate: '2026-06-03' }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer → échoue**

Run: `cd ECOI_backend && npx jest src/modules/delivrabilite/vt-date-change-notify.spec.ts`
Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implémenter le helper**

`src/modules/delivrabilite/vt-date-change-notify.ts` :

```typescript
/**
 * Décide si un changement de sous-étape déclenche une notif « date de VT
 * modifiée ». Vrai uniquement pour la sous-étape 'vt_planifie' quand une
 * nouvelle date (non undefined) diffère de l'ancienne.
 */
export function shouldNotifyVtDateChange(input: {
  key: string;
  beforeDate: string | null;
  nextDate: string | null | undefined;
}): boolean {
  if (input.key !== 'vt_planifie') return false;
  if (input.nextDate === undefined) return false;
  return (input.nextDate ?? null) !== (input.beforeDate ?? null);
}
```

- [ ] **Step 4: Lancer → passe**

Run: `cd ECOI_backend && npx jest src/modules/delivrabilite/vt-date-change-notify.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Câbler dans substeps.service.ts**

5a. Ajouter les imports en haut de `src/modules/delivrabilite/substeps.service.ts` :

```typescript
import { clients, leads } from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { shouldNotifyVtDateChange } from './vt-date-change-notify';
import { vtDateChangedMessage } from '../notifications/notif-messages';
```

> `workflowSteps`, `workflowSubsteps`, `auditLog`, `documents` sont déjà importés depuis `../../db/schema` ; **fusionner** `clients, leads` dans l'import existant plutôt que d'ajouter une 2ᵉ ligne. `Optional` est déjà importé.

5b. Ajouter `NotificationsService` au constructeur en `@Optional()` (après `realtime`) :

```typescript
constructor(
  @Inject(DB_PROVIDER) private readonly db: Db,
  private readonly clientsService: ClientsService,
  @Optional() private readonly realtime?: RealtimeService,
  @Optional() private readonly notifications?: NotificationsService,
) {}
```

5c. Dans `update()`, **après** le commit de la transaction. La méthode actuelle retourne `this.decorate(updated, tx)` dans le callback de transaction. Pour notifier après commit, capturer ce qu'il faut puis émettre hors transaction.

Remplacer la fin de `update()` ainsi : juste avant `return this.decorate(updated, tx);`, calculer le flag et stocker la cible sur une variable de portée externe. Concrètement, restructurer :

```typescript
async update(id: string, dto: UpdateSubstepDto, context: MutationContext): Promise<SubstepResponse> {
  let notifyPlan: { clientId: string; nextDate: string | null } | null = null;

  const result = await this.db.transaction(async (tx) => {
    const [before] = await tx.select().from(workflowSubsteps).where(eq(workflowSubsteps.id, id)).limit(1);
    if (!before) throw new NotFoundException(`Sous-étape ${id} introuvable`);

    this.assertCanMutate(context.actor, before, dto);

    const patch = this.buildPatch(before, dto);
    const [updated] = await tx
      .update(workflowSubsteps)
      .set(patch)
      .where(eq(workflowSubsteps.id, id))
      .returning();

    await this.applySla(tx, updated);
    await this.recomputePhase(tx, updated.stepId);
    await this.clientsService.recomputeStatus(updated.clientId, tx);

    if (dto.status && dto.status !== before.status) {
      await tx.insert(auditLog).values({
        userId: context.actor.id,
        action: 'workflow_substep_status_changed',
        entityType: 'workflow_substep',
        entityId: id,
        before: { status: before.status } as never,
        after: { status: updated.status } as never,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      });
    }

    this.realtime?.emitSubstepUpdated?.(updated);
    if (updated.status === 'probleme' && before.status !== 'probleme') {
      this.realtime?.emitSubstepBlocked?.(updated);
    }

    if (
      shouldNotifyVtDateChange({
        key: before.key,
        beforeDate: before.dateRealisee ?? null,
        nextDate: 'dateRealisee' in dto ? (dto.dateRealisee ?? null) : undefined,
      })
    ) {
      notifyPlan = { clientId: updated.clientId, nextDate: updated.dateRealisee ?? null };
    }

    return this.decorate(updated, tx);
  });

  if (notifyPlan && this.notifications) {
    await this.notifyVtDateChange(notifyPlan.clientId, notifyPlan.nextDate);
  }

  return result;
}

/** Best-effort : notifie le technicien assigné qu'une date de VT a changé. */
private async notifyVtDateChange(clientId: string, nextDate: string | null): Promise<void> {
  const [client] = await this.db
    .select({ technicienVtId: clients.technicienVtId, leadId: clients.leadId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client?.technicienVtId) return;
  const [lead] = await this.db
    .select({ firstName: leads.firstName, lastName: leads.lastName })
    .from(leads)
    .where(eq(leads.id, client.leadId))
    .limit(1);
  const leadName = [lead?.firstName, lead?.lastName].filter(Boolean).join(' ').trim() || 'Client';
  const { title, body } = vtDateChangedMessage({ leadName, date: nextDate });
  await this.notifications?.createAndEmit({
    userId: client.technicienVtId,
    type: 'vt_date_changed',
    title,
    body,
    payload: { clientId, substepId: undefined },
  });
}
```

> `before.dateRealisee` est un `string | null` (colonne `date`). Si le type Drizzle renvoie un `Date`, adapter en `.toISOString().slice(0,10)`. Vérifier le type avec le typecheck à l'étape suivante.

- [ ] **Step 6: Importer NotificationsModule dans le module (déjà fait en Task 5)**

`DelivrabiliteModule` importe déjà `NotificationsModule` depuis Task 5 — rien à faire ici. Vérifier :

Run: `cd ECOI_backend && grep -n "NotificationsModule" src/modules/delivrabilite/delivrabilite.module.ts`
Expected: présent.

- [ ] **Step 7: Typecheck + tests substeps existants**

Run: `cd ECOI_backend && npx tsc --noEmit && npx jest src/modules/delivrabilite/substeps.service.spec.ts`
Expected: PASS (le `@Optional()` laisse `notifications` undefined dans les specs).

- [ ] **Step 8: Commit**

```bash
cd ECOI_backend
git add src/modules/delivrabilite/vt-date-change-notify.ts src/modules/delivrabilite/vt-date-change-notify.spec.ts src/modules/delivrabilite/substeps.service.ts
git commit -m "feat(delivrabilite): notifier le technicien au changement de date VT"
```

---

## Task 7: Endpoint GET /clients/vt-calendar (helpers purs + câblage)

**Files:**
- Create: `src/modules/delivrabilite/vt-calendar.ts`
- Test: `src/modules/delivrabilite/vt-calendar.spec.ts`
- Create: `src/modules/delivrabilite/dto/vt-calendar.dto.ts`
- Modify: `src/modules/delivrabilite/clients.service.ts`
- Modify: `src/modules/delivrabilite/clients.controller.ts`

- [ ] **Step 1: Test des helpers purs (échoue)**

`src/modules/delivrabilite/vt-calendar.spec.ts` :

```typescript
import { pickVtDate, inPeriod } from './vt-calendar';

describe('pickVtDate', () => {
  it('prend la date de vt_planifie si présente', () => {
    expect(pickVtDate({ vt_planifie: '2026-06-03', vt_attribuee: '2026-06-05' })).toBe('2026-06-03');
  });
  it('replie sur vt_attribuee si vt_planifie absente', () => {
    expect(pickVtDate({ vt_planifie: null, vt_attribuee: '2026-06-05' })).toBe('2026-06-05');
  });
  it('renvoie null si aucune', () => {
    expect(pickVtDate({ vt_planifie: null, vt_attribuee: null })).toBeNull();
  });
});

describe('inPeriod', () => {
  it('vrai si la date est dans [from,to]', () => {
    expect(inPeriod('2026-06-03', '2026-06-01', '2026-06-30')).toBe(true);
  });
  it('faux si avant from', () => {
    expect(inPeriod('2026-05-31', '2026-06-01', '2026-06-30')).toBe(false);
  });
  it('faux si après to', () => {
    expect(inPeriod('2026-07-01', '2026-06-01', '2026-06-30')).toBe(false);
  });
  it('vrai si bornes absentes', () => {
    expect(inPeriod('2026-06-03', undefined, undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer → échoue**

Run: `cd ECOI_backend && npx jest src/modules/delivrabilite/vt-calendar.spec.ts`
Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implémenter les helpers**

`src/modules/delivrabilite/vt-calendar.ts` :

```typescript
/** Choisit la date de VT : vt_planifie en priorité, repli sur vt_attribuee. */
export function pickVtDate(dates: {
  vt_planifie: string | null;
  vt_attribuee: string | null;
}): string | null {
  return dates.vt_planifie ?? dates.vt_attribuee ?? null;
}

/** Vrai si `date` (YYYY-MM-DD) est dans la période [from,to] (bornes incluses, optionnelles). */
export function inPeriod(
  date: string,
  from: string | undefined,
  to: string | undefined,
): boolean {
  const d = date.slice(0, 10);
  if (from && d < from.slice(0, 10)) return false;
  if (to && d > to.slice(0, 10)) return false;
  return true;
}
```

- [ ] **Step 4: Lancer → passe**

Run: `cd ECOI_backend && npx jest src/modules/delivrabilite/vt-calendar.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: DTO query + type de réponse**

`src/modules/delivrabilite/dto/vt-calendar.dto.ts` :

```typescript
import { z } from 'zod';

export const vtCalendarQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});
export type VtCalendarQueryDto = z.infer<typeof vtCalendarQuerySchema>;

export type VtCalendarEntry = {
  clientId: string;
  leadId: string;
  leadName: string;
  city: string | null;
  phone: string | null;
  date: string; // YYYY-MM-DD
  status: string;
  technicienVtId: string | null;
  notes: string | null;
};
```

- [ ] **Step 6: Méthode service `vtCalendar`**

Dans `src/modules/delivrabilite/clients.service.ts`, ajouter (imports nécessaires : `workflowSubsteps` depuis schema, `pickVtDate, inPeriod` depuis `./vt-calendar`, types depuis `./dto/vt-calendar.dto`) :

```typescript
async vtCalendar(
  q: VtCalendarQueryDto,
  actor: { id: string; role: string },
): Promise<VtCalendarEntry[]> {
  // Réutilise le scoping de list() : un technicien ne voit que ses clients.
  const visibleClients = await this.list({} as never, actor);

  const entries: VtCalendarEntry[] = [];
  for (const c of visibleClients) {
    const subs = await this.db
      .select({ key: workflowSubsteps.key, dateRealisee: workflowSubsteps.dateRealisee })
      .from(workflowSubsteps)
      .where(eq(workflowSubsteps.clientId, c.id));
    const byKey: Record<string, string | null> = {};
    for (const s of subs) byKey[s.key] = s.dateRealisee ?? null;
    const date = pickVtDate({
      vt_planifie: byKey['vt_planifie'] ?? null,
      vt_attribuee: byKey['vt_attribuee'] ?? null,
    });
    if (!date || !inPeriod(date, q.from, q.to)) continue;
    entries.push({
      clientId: c.id,
      leadId: c.leadId,
      leadName: c.lead?.fullName ?? 'Client',
      city: c.lead?.city ?? null,
      phone: c.lead?.phone ?? null,
      date: date.slice(0, 10),
      status: c.steps?.vt?.status ?? 'a_faire',
      technicienVtId: c.technicienVtId,
      notes: null,
    });
  }
  return entries;
}
```

> Vérifier les noms de champs de `ClientResponse` (`lead.fullName`, `lead.city`, `lead.phone`, `steps.vt.status`, `technicienVtId`) au typecheck — ils viennent de `client-response.dto.ts`. Adapter si la signature de `list()` exige un DTO précis plutôt que `{}` (passer un `QueryClientsDto` vide validé).

- [ ] **Step 7: Route controller**

Dans `src/modules/delivrabilite/clients.controller.ts`, ajouter la route **avant** `@Patch(':id')` (pour que `vt-calendar` ne soit pas capté comme un `:id`) — mais comme c'est un `@Get` et que `:id` est un `@Patch`, il n'y a pas de collision ; placer le `@Get('vt-calendar')` après `@Get()` :

```typescript
import { vtCalendarQuerySchema, type VtCalendarQueryDto, type VtCalendarEntry } from './dto/vt-calendar.dto';

// ... dans la classe ...
@Get('vt-calendar')
@Roles(...WORKFLOW_ROLES)
async vtCalendar(
  @Query(new ZodValidationPipe(vtCalendarQuerySchema)) q: VtCalendarQueryDto,
  @CurrentUser() session: SessionUser,
): Promise<VtCalendarEntry[]> {
  return this.svc.vtCalendar(q, { id: session.id, role: session.role });
}
```

- [ ] **Step 8: Typecheck**

Run: `cd ECOI_backend && npx tsc --noEmit`
Expected: PASS. Corriger les noms de champs si le typecheck signale un écart avec `ClientResponse`.

- [ ] **Step 9: Commit**

```bash
cd ECOI_backend
git add src/modules/delivrabilite/vt-calendar.ts src/modules/delivrabilite/vt-calendar.spec.ts src/modules/delivrabilite/dto/vt-calendar.dto.ts src/modules/delivrabilite/clients.service.ts src/modules/delivrabilite/clients.controller.ts
git commit -m "feat(delivrabilite): endpoint GET /clients/vt-calendar (scopé par rôle)"
```

---

# PARTIE B — FRONTEND (`ECOI_frontend`)

## Task 8: Types + API + hooks

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/hooks.ts`

- [ ] **Step 1: Types**

Ajouter dans `src/lib/types.ts` :

```typescript
export type NotificationResponse = {
  id: string
  type: string
  title: string
  body: string | null
  payload: unknown
  readAt: string | null
  createdAt: string
}

export type VtCalendarEntry = {
  clientId: string
  leadId: string
  leadName: string
  city: string | null
  phone: string | null
  date: string // YYYY-MM-DD
  status: string
  technicienVtId: string | null
  notes: string | null
}
```

- [ ] **Step 2: API mutations**

Ajouter dans `src/lib/api.ts` (après les autres fonctions ; importer `NotificationResponse` dans le bloc d'import de types en tête de fichier) :

```typescript
export function markNotificationRead(id: string): Promise<NotificationResponse> {
  return api<NotificationResponse>(`/notifications/${id}/read`, { method: 'PATCH' })
}

export function markAllNotificationsRead(): Promise<{ ok: true }> {
  return api<{ ok: true }>('/notifications/read-all', { method: 'POST' })
}
```

- [ ] **Step 3: Hooks**

Ajouter dans `src/lib/hooks.ts` (ajouter `NotificationResponse, VtCalendarEntry` au bloc d'import de types en tête) :

```typescript
// ─── Notifications ─────────────────────────────────────────
export function useNotifications(filters?: { unreadOnly?: boolean; limit?: number }): Async<NotificationResponse[]> {
  return useFetch<NotificationResponse[]>('/notifications', {
    unreadOnly: filters?.unreadOnly ? 'true' : undefined,
    limit: filters?.limit,
  })
}

// ─── Calendrier VT ─────────────────────────────────────────
export function useVtCalendar(filters?: { from?: string; to?: string } | null): Async<VtCalendarEntry[]> {
  return useFetch<VtCalendarEntry[]>(
    filters === null ? null : '/clients/vt-calendar',
    filters === null ? undefined : { from: filters?.from, to: filters?.to },
    { refreshCachedOnMount: true, silentInitialLoading: true },
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `cd ECOI_frontend && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ECOI_frontend
git add src/lib/types.ts src/lib/api.ts src/lib/hooks.ts
git commit -m "feat(api): hooks useNotifications + useVtCalendar"
```

---

## Task 9: Ciblage temps réel par userId (helper pur + câblage)

**Files:**
- Create: `src/lib/realtimeNotify.ts`
- Test: `src/lib/realtime.test.ts`
- Modify: `src/lib/realtime.ts`

- [ ] **Step 1: Test du helper (échoue)**

`src/lib/realtime.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import { shouldSurfaceNotification } from './realtimeNotify'

describe('shouldSurfaceNotification', () => {
  it('affiche si pas de userId (broadcast legacy)', () => {
    expect(shouldSurfaceNotification(undefined, 'me')).toBe(true)
  })
  it('affiche si userId == moi', () => {
    expect(shouldSurfaceNotification('me', 'me')).toBe(true)
  })
  it("n'affiche pas si userId != moi", () => {
    expect(shouldSurfaceNotification('autre', 'me')).toBe(false)
  })
  it('affiche si je ne suis pas identifié (fallback legacy)', () => {
    expect(shouldSurfaceNotification('autre', null)).toBe(true)
  })
})
```

- [ ] **Step 2: Lancer → échoue**

Run: `cd ECOI_frontend && npx vitest run src/lib/realtime.test.ts`
Expected: FAIL "Cannot find module './realtimeNotify'".

- [ ] **Step 3: Implémenter le helper**

`src/lib/realtimeNotify.ts` :

```typescript
/**
 * Décide si une notification temps réel doit être affichée à l'utilisateur
 * courant. Ciblage : si la notif porte un userId, on n'affiche que pour ce
 * destinataire. Sans userId (legacy broadcast) ou utilisateur courant inconnu,
 * on conserve le comportement historique (afficher).
 */
export function shouldSurfaceNotification(
  notificationUserId: string | undefined,
  currentUserId: string | null,
): boolean {
  if (!notificationUserId) return true
  if (!currentUserId) return true
  return notificationUserId === currentUserId
}
```

- [ ] **Step 4: Lancer → passe**

Run: `cd ECOI_frontend && npx vitest run src/lib/realtime.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Câbler dans realtime.ts**

Dans `src/lib/realtime.ts` :

5a. Importer le helper et l'auth :

```typescript
import { shouldSurfaceNotification } from './realtimeNotify'
import { useAuth } from './auth'
```

5b. Remplacer le handler `notification:new` pour filtrer par `userId`. Le store `useAuth` est accessible hors React via `useAuth.getState()` :

```typescript
socket.on('notification:new', (notification: { title?: string; body?: string; id?: string; userId?: string }) => {
  const me = useAuth.getState().user?.id ?? null
  if (!shouldSurfaceNotification(notification.userId, me)) return
  notifyRealtimeRefresh({ event: 'notification:new', paths: ['/notifications', '/leads', '/rdv', '/call-logs', '/analytics/summary', '/analytics/funnel'] })
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && notification.title) {
    try {
      new Notification(notification.title, { body: notification.body, tag: notification.id, requireInteraction: true, silent: false } as NotificationOptions)
    } catch {
      try { new Notification(notification.title, { body: notification.body, tag: notification.id }) } catch { /* notification bloquée par le navigateur */ }
    }
  }
})
```

> Vérifier que `useAuth` expose `.getState()` (zustand vanilla store) — c'est le cas (cf. `useAuth.setState` utilisé dans les tests). Si l'import de `useAuth` dans `realtime.ts` crée un cycle, lire l'id depuis `localStorage`/le store via un sélecteur léger ; sinon conserver l'import direct.

- [ ] **Step 6: Typecheck**

Run: `cd ECOI_frontend && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd ECOI_frontend
git add src/lib/realtimeNotify.ts src/lib/realtime.test.ts src/lib/realtime.ts
git commit -m "feat(realtime): ne notifier que le destinataire ciblé (userId)"
```

---

## Task 10: Afficher les VT dans le calendrier

**Files:**
- Modify: `src/pages/rdv/RdvCalendar.tsx`
- Test: `src/pages/rdv/RdvCalendar.vt.test.tsx`

- [ ] **Step 1: Étendre l'union CalendarItem + helper de conversion**

Dans `src/pages/rdv/RdvCalendar.tsx` :

1a. Importer le hook et le type :

```typescript
import { useGhlCalendarEvents, useRdvList, useLeads, useVtCalendar, type GhlCalendarEvent } from '../../lib/hooks'
import type { VtCalendarEntry } from '../../lib/types'
```

1b. Étendre l'union `CalendarItem` :

```typescript
type CalendarItem =
  | { source: 'local'; id: string; scheduledAt: string; status: RdvStatus; rdv: RdvResponse }
  | { source: 'ghl'; id: string; scheduledAt: string; status: 'ghl'; event: GhlCalendarEvent }
  | { source: 'vt'; id: string; scheduledAt: string; status: 'vt'; vt: VtCalendarEntry }
```

1c. Ajouter un helper module-level qui transforme une date VT (date-only) en `scheduledAt` à 08:00 heure Réunion :

```typescript
// La VT n'a pas d'heure en base : on la pose à 08:00 heure Réunion pour
// l'afficher dans la grille horaire, sur la bonne journée.
function vtScheduledAt(date: string): string {
  // date = 'YYYY-MM-DD'. 08:00 Réunion = 04:00 UTC (UTC+4).
  return `${date.slice(0, 10)}T04:00:00.000Z`
}
```

- [ ] **Step 2: Charger les VT et les fusionner**

2a. Après les hooks existants (`useRdvList`, `useGhlCalendarEvents`, `useLeads`), ajouter :

```typescript
const { data: vtEntries } = useVtCalendar({
  from: period.from.toISOString(),
  to: period.to.toISOString(),
})
```

2b. Dans le `useMemo` `calendarItems`, ajouter les VT et inclure `vtEntries` dans les deps :

```typescript
const vtItems: CalendarItem[] = (vtEntries ?? []).map((vt) => ({
  source: 'vt',
  id: `vt-${vt.clientId}`,
  scheduledAt: vtScheduledAt(vt.date),
  status: 'vt',
  vt,
}))
return [...localItems, ...ghlItems, ...vtItems].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
```

Mettre à jour la ligne de dépendances : `}, [ghlEventsData?.events, rdvs, vtEntries])`.

- [ ] **Step 3: Gérer la source 'vt' dans le rendu et le clic**

3a. Dans `RdvBlock`, `RdvButton`, `StackPopup` : les `item.source === 'ghl'` / `'local'` sont traités ; ajouter le cas `'vt'`. Le plus simple : un libellé dédié. Dans `RdvBlock` au début :

```typescript
const isVt = item.source === 'vt'
const label = isVt
  ? `VT — ${item.vt.leadName}`
  : item.source === 'ghl'
    ? ghlEventLabel(item.event)
    : (lead ? fullName(lead) : localRdvFallbackLabel(item.rdv))
const detail = isVt
  ? [item.vt.city, item.vt.phone].filter(Boolean).join(' · ')
  : item.source === 'ghl' ? ghlEventDetail(item.event) : localRdvFallbackDetail(item.rdv)
```

> Appliquer la même logique (`isVt`) dans `RdvButton` et la liste de `StackPopup`. Pour `sectorForItem`, ajouter en tête : `if (item.source === 'vt') return sectorFromCity(item.vt.city)`.

3b. Donner une couleur distincte aux VT : dans `RdvBlock`, remplacer `const tone = CARD_TONE` par :

```typescript
const tone = isVt ? 'bg-info-tint text-text border-info' : CARD_TONE
```

3c. Clic sur une VT — modifier `openCalendarItem` :

```typescript
const openCalendarItem = (item: CalendarItem) => {
  if (item.source === 'vt') {
    if (role === 'admin' || role === 'delivrabilite' || role === 'responsable_technique' || role === 'back_office') {
      navigate(`/suivi/${item.vt.clientId}`)
    } else {
      setVtPopup(item.vt) // technicien : popup lecture seule
    }
    return
  }
  if (item.source === 'local') {
    navigate(`/rdv/${item.id}`)
    return
  }
  const lead = item.event.contactId ? leadByExternalId.get(item.event.contactId) : undefined
  const search = lead ? fullName(lead) : item.event.contactPhone || item.event.contactName || item.event.contactEmail || item.event.title || ''
  if (search) navigate(leadSearchPath(role, search))
}
```

3d. Ajouter l'état + le popup lecture seule dans `RdvCalendar` :

```typescript
const [vtPopup, setVtPopup] = useState<VtCalendarEntry | null>(null)
```

Et juste avant la fermeture de `</AppShell>`, rendre le popup :

```tsx
{vtPopup && (
  <div className="fixed inset-0 z-[120] flex items-center justify-center bg-noir/40 backdrop-blur-sm px-4" onClick={(e) => e.target === e.currentTarget && setVtPopup(null)}>
    <div className="glass-card w-full max-w-sm p-0 shadow-2xl">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-2">
        <div>
          <div className="eyebrow text-or-dark">Visite technique</div>
          <h3 className="font-black text-lg mt-0.5">{vtPopup.leadName}</h3>
        </div>
        <button onClick={() => setVtPopup(null)} className="rounded-full p-1.5 text-muted hover:bg-cream hover:text-text" aria-label="Fermer">×</button>
      </div>
      <div className="px-5 py-4 space-y-1.5 text-sm text-muted">
        <div>📅 {vtPopup.date.split('-').reverse().join('/')}</div>
        {vtPopup.city && <div>📍 {vtPopup.city}</div>}
        {vtPopup.phone && <div>📞 {vtPopup.phone}</div>}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Écrire le test de rendu VT**

`src/pages/rdv/RdvCalendar.vt.test.tsx` :

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { VtCalendarEntry } from '../../lib/types'

vi.mock('../../components/shell/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../../components/shell/Topbar', () => ({ Topbar: () => null }))

const vt: VtCalendarEntry = {
  clientId: 'c-1', leadId: 'l-1', leadName: 'Jean Dupont', city: 'Saint-Denis',
  phone: '0600000000', date: '2026-06-08', status: 'planifie', technicienVtId: 't-1', notes: null,
}

vi.mock('../../lib/hooks', () => ({
  useRdvList: () => ({ data: [], loading: false, error: null }),
  useGhlCalendarEvents: () => ({ data: { events: [] }, loading: false, error: null }),
  useLeads: () => ({ data: [], loading: false, error: null }),
  useVtCalendar: () => ({ data: [vt], loading: false, error: null }),
}))
vi.mock('../../lib/auth', () => ({ useAuth: (sel: (s: { user?: { role: string } }) => unknown) => sel({ user: { role: 'technicien' } }) }))

import { RdvCalendar } from './RdvCalendar'

beforeEach(() => { window.localStorage.clear() })

describe('RdvCalendar — VT', () => {
  it('affiche une carte VT dans le calendrier', () => {
    // Cale la date courante via le cursor par défaut : la VT est le 2026-06-08.
    render(<MemoryRouter><RdvCalendar /></MemoryRouter>)
    expect(screen.getAllByText(/VT — Jean Dupont/i).length).toBeGreaterThan(0)
  })
})
```

> ⚠️ Le calendrier démarre sur la semaine courante (date système). Le test peut ne pas afficher la VT du 2026-06-08 si la date système diffère. Si le rendu dépend de `new Date()`, stabiliser avec `vi.setSystemTime(new Date('2026-06-08T06:00:00Z'))` dans un `beforeEach` (importer `vi`), puis `vi.useRealTimers()` en `afterEach`.

- [ ] **Step 5: Lancer le test**

Run: `cd ECOI_frontend && npx vitest run src/pages/rdv/RdvCalendar.vt.test.tsx`
Expected: PASS. Ajuster `vi.setSystemTime` si nécessaire (cf. note).

- [ ] **Step 6: Typecheck**

Run: `cd ECOI_frontend && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd ECOI_frontend
git add src/pages/rdv/RdvCalendar.tsx src/pages/rdv/RdvCalendar.vt.test.tsx
git commit -m "feat(calendar): afficher les VT planifiées dans la page Calendrier"
```

---

## Task 11: Intégrer les notifs persistées dans la page Rappels

**Files:**
- Modify: `src/pages/Notifications.tsx`

> Cette page (1100+ lignes) construit des notifs dérivées (leads/rdv/call-logs). On AJOUTE les notifs persistées comme source supplémentaire, sans réécrire l'existant.

- [ ] **Step 1: Repérer le point d'agrégation**

Run: `cd ECOI_frontend && grep -n "useLeads\|useRdvList\|useCallLogs\|const notifs\|return (\|\.map(" src/pages/Notifications.tsx | head -40`
Objectif : localiser où la liste des notifs affichées est construite et rendue.

- [ ] **Step 2: Charger les notifs persistées**

Près des autres hooks de données en haut du composant, ajouter :

```typescript
const { data: persisted } = useNotifications({ limit: 50 })
```

(et importer `useNotifications` depuis `../lib/hooks`, `markNotificationRead` depuis `../lib/api`.)

- [ ] **Step 3: Mapper en items affichables**

Construire un bloc de notifs persistées (VT et autres), mappées vers la même forme visuelle que les notifs existantes. Comme la structure interne dépend du composant, suivre le type d'item local repéré à l'étape 1 et ajouter :

```typescript
const persistedItems = useMemo(() => (persisted ?? []).map((n) => ({
  id: `db-${n.id}`,
  title: n.title,
  body: n.body ?? '',
  createdAt: n.createdAt,
  readAt: n.readAt,
  clientId: (n.payload as { clientId?: string } | null)?.clientId,
  kind: n.type,
})), [persisted])
```

Puis fusionner `persistedItems` dans la liste rendue (concaténer avant le tri par date existant). Au clic / au survol « marquer lu » d'un item `db-*`, appeler `markNotificationRead(n.id)` puis rafraîchir (`notifyRealtimeRefresh({ event: 'notification:read', paths: ['/notifications'] })`).

> Le détail d'intégration dépend du JSX existant. Respecter le style des cartes de la page. Ne pas casser les notifs dérivées.

- [ ] **Step 4: Typecheck**

Run: `cd ECOI_frontend && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Vérifier visuellement (manuel)**

Lancer le front (`npm run dev`), se connecter en technicien de test, attribuer une VT côté manager → la notif apparaît dans Rappels. (Si l'environnement le permet ; sinon, valider par le typecheck + revue.)

- [ ] **Step 6: Commit**

```bash
cd ECOI_frontend
git add src/pages/Notifications.tsx
git commit -m "feat(notifications): afficher les notifs persistées (VT) dans Rappels"
```

---

## Done — vérification finale

- [ ] **Backend** : `cd ECOI_backend && npx tsc --noEmit && npx jest` → tous verts (les nouveaux specs purs + les specs existants).
- [ ] **Frontend** : `cd ECOI_frontend && npx tsc --noEmit -p tsconfig.json && npx vitest run` → tous verts.
- [ ] **Revue manuelle** du parcours : attribuer VT → notif technicien (in-app + browser) → VT visible dans Calendrier du technicien ; changer la date → 2ᵉ notif.

---

## Notes de cohérence des types (vérifiées entre tâches)

- `RealtimeNotification.userId?: string` (Task 1) consommé par `createAndEmit` (Task 4) et filtré par `shouldSurfaceNotification` (Task 9).
- `NotificationResponse` identique backend (Task 3) / frontend (Task 8).
- `VtCalendarEntry` identique backend (`dto/vt-calendar.dto.ts`, Task 7) / frontend (`types.ts`, Task 8) : `clientId, leadId, leadName, city, phone, date, status, technicienVtId, notes`.
- `type: RealtimeNotification['kind']` partagé : `'vt_assigned' | 'vt_date_changed'` utilisés dans Tasks 5/6 et reconnus par le type de Task 1.
- Helpers purs : `shouldNotifyAssignment` (T5), `shouldNotifyVtDateChange` (T6), `pickVtDate`/`inPeriod` (T7), `shouldSurfaceNotification` (T9) — tous testés isolément.
