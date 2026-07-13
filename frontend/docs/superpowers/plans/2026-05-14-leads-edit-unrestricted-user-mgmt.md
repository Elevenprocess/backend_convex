# Leads Edit Unrestricted + Admin User Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setters get full admin parity on leads (all fields editable, all status transitions allowed). Admin gets a per-user modal in Settings to edit fields, regenerate a password-creation link (preserving all FK history), or soft-delete the user.

**Architecture:** Two independent code changes, shipped together. Change 1 is pure code deletion + 2 form fields. Change 2 adds a `target_user_id` column to invitations so `acceptInvitation` can branch into a "set password on existing user" flow that preserves `user.id` (and all leads/RDV/calls attached to it).

**Tech Stack:** NestJS + Drizzle ORM + Postgres + better-auth (backend `/root/ECOI_backend`); React 19 + Vite + Tailwind (frontend `/root/ECOI_frontend`).

**Spec:** `/root/ECOI_frontend/docs/superpowers/specs/2026-05-14-leads-edit-unrestricted-user-mgmt-design.md`

---

## File Structure

### Backend (`/root/ECOI_backend/`)
- **Modify** `src/db/schema/user-invitations.ts` — add `targetUserId` column
- **Create** `src/db/migrations/XXXX_add_target_user_id_to_user_invitations.sql` (auto-generated)
- **Modify** `src/modules/leads/leads.service.ts` — remove `ALLOWED_TRANSITIONS` and transition check
- **Modify** `src/modules/leads/leads.controller.ts` — remove `session` arg from svc.update call
- **Modify** `src/modules/leads/leads.service.spec.ts` — remove transition tests
- **Create** `src/modules/users/dto/renew-user.dto.ts` — Zod DTO for renew payload
- **Modify** `src/modules/users/dto/invitation-response.dto.ts` — expose `targetUserId`
- **Modify** `src/modules/users/users.service.ts` — add `renew()`, update `acceptInvitation()`
- **Modify** `src/modules/users/users.controller.ts` — add `POST /users/:id/renew`
- **Modify** `src/modules/users/users.service.spec.ts` — new tests for renew + acceptInvitation branching

### Frontend (`/root/ECOI_frontend/`)
- **Modify** `src/lib/types.ts` — extend `InvitationResponse` with `targetUserId`
- **Modify** `src/lib/hooks.ts` — add `renewUser()`, `updateUser()`, `deleteUser()`
- **Modify** `src/components/SplitPanel.tsx` — extend InfosTab with `revenuFiscal` + `typeLogement`
- **Create** `src/components/UserEditModal.tsx` — admin modal with edit + renew + delete
- **Modify** `src/pages/Settings.tsx` — wire UserRow click → modal

---

## Phase 1 — Backend: Remove lead edit RBAC

### Task 1: Remove `ALLOWED_TRANSITIONS` (TDD)

**Files:**
- Modify: `/root/ECOI_backend/src/modules/leads/leads.service.ts:14-36`
- Modify: `/root/ECOI_backend/src/modules/leads/leads.service.ts:135-160`
- Modify: `/root/ECOI_backend/src/modules/leads/leads.controller.ts:71-79`
- Test: `/root/ECOI_backend/src/modules/leads/leads.service.spec.ts`

- [ ] **Step 1: Find existing transition tests and identify what to delete**

Run:
```bash
cd /root/ECOI_backend
grep -n "Transition\|transition\|ALLOWED_TRANSITIONS\|actorRole" src/modules/leads/leads.service.spec.ts src/modules/leads/leads.controller.spec.ts
```
Expected output: lines referencing transition validation and `actorRole`. Note their line numbers — they'll be deleted in Step 6.

- [ ] **Step 2: Write a new test that proves setters can do any transition**

In `src/modules/leads/leads.service.spec.ts`, find the `describe('LeadsService — write'` block (or the equivalent — open the file to confirm the correct describe). Add this test inside it:

```ts
it('setter peut faire n\'importe quelle transition de statut (parité admin)', async () => {
  const lead = await seedLead(db, { status: 'signe' });
  const setter: ActorContext = {
    id: '00000000-0000-0000-0000-000000000001',
    role: 'setter',
  };
  // Anciennement interdit: signe → nouveau
  const updated = await svc.update(lead.id, { status: 'nouveau' });
  expect(updated!.status).toBe('nouveau');
});
```

If `seedLead` or `ActorContext` imports are missing from the spec file, copy them from existing tests at the top of the file (look at how transitions tests imported them).

- [ ] **Step 3: Run the new test (should pass already if you removed the check, or fail with BadRequestException if not yet)**

```bash
cd /root/ECOI_backend
pnpm test -- leads.service.spec.ts -t "setter peut faire n'importe quelle transition"
```

Expected at this stage: **FAIL** with `BadRequestException: Transition de statut interdite : signe → nouveau`.

- [ ] **Step 4: Delete the ALLOWED_TRANSITIONS constant**

In `src/modules/leads/leads.service.ts`, delete lines 17-36 (the entire `type LeadStatus` line, the comment block, and the `ALLOWED_TRANSITIONS` constant). Keep the `ActorContext` export type (lines 12-15) — it's used elsewhere.

The block to delete (exactly):

```ts
type LeadStatus = typeof leads.$inferSelect.status;

/**
 * Transitions de statut autorisées pour les non-admins.
 * Un admin peut faire n'importe quelle transition (correction manuelle).
 * Une transition vers le même statut (X→X) est toujours autorisée — utile pour
 * re-planifier un rappel sur un lead déjà `a_rappeler`.
 */
const ALLOWED_TRANSITIONS: Record<LeadStatus, ReadonlySet<LeadStatus>> = {
  nouveau:        new Set(['nouveau', 'qualifie', 'pas_qualifie', 'a_rappeler', 'pas_de_reponse', 'perdu', 'rdv_pris']),
  a_rappeler:     new Set(['a_rappeler', 'qualifie', 'pas_qualifie', 'pas_de_reponse', 'perdu', 'rdv_pris', 'relance']),
  pas_de_reponse: new Set(['pas_de_reponse', 'a_rappeler', 'qualifie', 'pas_qualifie', 'perdu', 'rdv_pris', 'relance']),
  relance:        new Set(['relance', 'a_rappeler', 'qualifie', 'pas_qualifie', 'pas_de_reponse', 'perdu', 'rdv_pris']),
  pas_qualifie:   new Set(['pas_qualifie', 'a_rappeler', 'qualifie', 'perdu']),
  qualifie:       new Set(['qualifie', 'rdv_pris', 'a_rappeler', 'pas_qualifie', 'perdu']),
  rdv_pris:       new Set(['rdv_pris', 'rdv_honore', 'a_rappeler', 'perdu']),
  rdv_honore:     new Set(['rdv_honore', 'signe', 'perdu', 'a_rappeler']),
  signe:          new Set(['signe']),
  perdu:          new Set(['perdu', 'a_rappeler']),
};
```

- [ ] **Step 5: Modify `update()` signature and remove the transition check**

In `src/modules/leads/leads.service.ts`, replace the entire `update()` method (currently around lines 135-160) with:

```ts
async update(id: string, dto: UpdateLeadDto) {
  const target = await this.findById(id);
  if (!target) return null;

  const [row] = await this.db
    .update(leads)
    .set({ ...dto, updatedAt: new Date() })
    .where(and(eq(leads.id, id), isNull(leads.deletedAt)))
    .returning();
  if (row) this.realtime?.emitLeadUpdated(toLeadResponse(row));
  return row ?? null;
}
```

Also remove the now-unused `BadRequestException` import at the top if no other method uses it. Check with:
```bash
grep -n "BadRequestException" src/modules/leads/leads.service.ts
```
If the only match is the import line, remove `BadRequestException` from the import list.

- [ ] **Step 6: Update the controller to drop the `actorRole` argument**

In `src/modules/leads/leads.controller.ts`, line 76 currently reads:
```ts
const upd = await this.svc.update(id, dto, { actorRole: session.role });
```
Replace with:
```ts
const upd = await this.svc.update(id, dto);
```

The `@CurrentUser() session: SessionUser` arg is still used by the AuditInterceptor decorator — **keep it** in the handler signature.

- [ ] **Step 7: Delete obsolete transition tests**

In `src/modules/leads/leads.service.spec.ts`, find and DELETE any `it(...)` block that asserts on a transition being rejected (look for matches you found in Step 1 — patterns like `rejects.toThrow.*Transition` or `actorRole`). Tests that simply assert successful updates stay.

In `src/modules/leads/leads.controller.spec.ts`, same — delete any test asserting transition rejection. The successful-update tests stay (they may have used `role: 'admin'` — that's fine, they continue to pass).

- [ ] **Step 8: Run the full leads test suite**

```bash
cd /root/ECOI_backend
pnpm test -- leads
```

Expected: ALL leads tests pass (including the new "setter peut faire n'importe quelle transition" test).

- [ ] **Step 9: Commit**

```bash
cd /root/ECOI_backend
git add src/modules/leads/leads.service.ts src/modules/leads/leads.controller.ts src/modules/leads/leads.service.spec.ts src/modules/leads/leads.controller.spec.ts
git commit -m "feat(leads): remove RBAC status transition restriction

Setters now have full parity with admins on lead edits. Drops
ALLOWED_TRANSITIONS check that produced spurious 'Transition interdite'
errors on legitimate corrections."
```

---

## Phase 2 — Frontend: InfosTab full edit

### Task 2: Add `revenuFiscal` + `typeLogement` to InfosTab edit form

**Files:**
- Modify: `/root/ECOI_frontend/src/components/SplitPanel.tsx` (around lines 230-373)

- [ ] **Step 1: Read the current `InfosEditable` type and helpers**

Open `src/components/SplitPanel.tsx` and locate (Read tool):
- The `InfosEditable` type definition (search "InfosEditable")
- The `leadToInfosForm()` helper just below it
- The `InfosTab` component function (around line 251)
- The read-only render block (around line 301)
- The edit render block (around line 328)
- The `save()` function (around line 270)
- The `parseRevenuFiscal()` function (around line 1345 — keep as-is)

- [ ] **Step 2: Extend `InfosEditable` type to add the two fields**

Find:
```ts
type InfosEditable = {
  firstName: string
  lastName: string
  email: string
  phone: string
  addressLine: string
  city: string
  postalCode: string
  status: LeadResponse['status']
}
```

Replace with:
```ts
type InfosEditable = {
  firstName: string
  lastName: string
  email: string
  phone: string
  addressLine: string
  city: string
  postalCode: string
  status: LeadResponse['status']
  typeLogement: string
  revenuFiscal: string
}
```

- [ ] **Step 3: Extend `leadToInfosForm()` to seed the two new fields**

Find the function (returns an `InfosEditable`). It currently looks like:
```ts
function leadToInfosForm(lead: LeadResponse): InfosEditable {
  return {
    firstName: cleanField(lead.firstName) ?? '',
    lastName: cleanField(lead.lastName) ?? '',
    email: cleanField(lead.email) ?? '',
    phone: cleanField(lead.phone) ?? '',
    addressLine: cleanField(lead.addressLine) ?? '',
    city: cleanField(lead.city) ?? '',
    postalCode: cleanField(lead.postalCode) ?? '',
    status: lead.status,
  }
}
```

Replace with:
```ts
function leadToInfosForm(lead: LeadResponse): InfosEditable {
  return {
    firstName: cleanField(lead.firstName) ?? '',
    lastName: cleanField(lead.lastName) ?? '',
    email: cleanField(lead.email) ?? '',
    phone: cleanField(lead.phone) ?? '',
    addressLine: cleanField(lead.addressLine) ?? '',
    city: cleanField(lead.city) ?? '',
    postalCode: cleanField(lead.postalCode) ?? '',
    status: lead.status,
    typeLogement: cleanField(lead.typeLogement) ?? '',
    revenuFiscal: lead.revenuFiscal?.toString() ?? '',
  }
}
```

- [ ] **Step 4: Add read-only display rows**

In `InfosTab`, locate the read-only render block (`if (!editing) { return (...)`). Inside the returned `<div className="space-y-3">`, after the line with `<Field label="VILLE" value={fieldOrDash(lead.city)} />`, ADD two lines:

```tsx
<Field label="TYPE LOGEMENT" value={fieldOrDash(lead.typeLogement)} />
<Field label="REVENU FISCAL" value={lead.revenuFiscal != null ? lead.revenuFiscal.toLocaleString('fr-FR') : '—'} />
```

- [ ] **Step 5: Add editable inputs to the edit form**

In the edit render block (the `return (...)` after `if (!editing)`), find:
```tsx
<EditableField label="VILLE" value={form.city} onChange={(v) => setForm((f) => ({ ...f, city: v }))} />
<div>
  <div className="text-[10px] font-bold text-faint uppercase tracking-widest mb-1">STATUT</div>
```

Insert two new `<EditableField>` BETWEEN the `VILLE` field and the `STATUT` div:

```tsx
<EditableField label="VILLE" value={form.city} onChange={(v) => setForm((f) => ({ ...f, city: v }))} />
<EditableField label="TYPE LOGEMENT" value={form.typeLogement} onChange={(v) => setForm((f) => ({ ...f, typeLogement: v }))} placeholder="ex: maison" />
<EditableField label="REVENU FISCAL" value={form.revenuFiscal} onChange={(v) => setForm((f) => ({ ...f, revenuFiscal: v }))} placeholder="ex: 25000" />
<div>
  <div className="text-[10px] font-bold text-faint uppercase tracking-widest mb-1">STATUT</div>
```

- [ ] **Step 6: Update `save()` to parse `revenuFiscal` before sending**

The current `save()` builds a `patch` by iterating keys of `form` and comparing to `initial`. For `revenuFiscal` we need to parse the string. Replace the `save()` function body with this exact code:

```ts
  async function save() {
    setSaving(true)
    setError(null)
    try {
      const patch: Record<string, unknown> = {}
      const initial = leadToInfosForm(lead)
      for (const key of Object.keys(form) as (keyof InfosEditable)[]) {
        if (form[key] === initial[key]) continue
        if (key === 'status') {
          patch.status = form.status
          continue
        }
        if (key === 'revenuFiscal') {
          // parseRevenuFiscal throws on invalid format — caught below.
          patch.revenuFiscal = parseRevenuFiscal(form.revenuFiscal)
          continue
        }
        const trimmed = (form[key] as string).trim()
        patch[key] = trimmed === '' ? null : trimmed
      }
      if (Object.keys(patch).length === 0) {
        setEditing(false)
        return
      }
      await updateLead(lead.id, patch as Parameters<typeof updateLead>[1])
      onSaved?.()
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 7: Type check the frontend**

```bash
cd /root/ECOI_frontend
npx tsc --noEmit
```

Expected: no errors related to SplitPanel.tsx. (Pre-existing errors elsewhere are out of scope; if any appear in SplitPanel itself, fix them.)

- [ ] **Step 8: Commit**

```bash
cd /root/ECOI_frontend
git add src/components/SplitPanel.tsx
git commit -m "feat(leads): expose revenuFiscal and typeLogement in sidebar edit form

Setters can now modify these directly from the lead sidebar without
going through the qualification workflow."
```

---

## Phase 3 — Backend: Schema migration

### Task 3: Add `target_user_id` column to `user_invitations`

**Files:**
- Modify: `/root/ECOI_backend/src/db/schema/user-invitations.ts`
- Create: migration file in `src/db/migrations/`

- [ ] **Step 1: Add the new column to the Drizzle schema**

Edit `src/db/schema/user-invitations.ts`. Currently the column list ends with:
```ts
acceptedUserId: uuid('accepted_user_id').references(() => users.id),
acceptedAt: timestamp('accepted_at', { withTimezone: true }),
expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
```

Add `targetUserId` AFTER `acceptedUserId`:
```ts
acceptedUserId: uuid('accepted_user_id').references(() => users.id),
acceptedAt: timestamp('accepted_at', { withTimezone: true }),
targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
```

- [ ] **Step 2: Generate the migration**

```bash
cd /root/ECOI_backend
pnpm db:generate
```

Expected output: drizzle-kit writes a new SQL file under `src/db/migrations/` named something like `00XX_<auto-name>.sql`. Take note of the filename.

- [ ] **Step 3: Inspect the generated SQL**

Open the new file (use Read tool with its absolute path). Confirm it contains exactly:
```sql
ALTER TABLE "user_invitations" ADD COLUMN "target_user_id" uuid;
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
```
(constraint name may vary slightly — that's fine).

If anything else appears in the file (unrelated schema changes), it's noise from drizzle-kit detecting drift. Manually edit the file to keep ONLY the two `ALTER TABLE` lines above. Then commit.

- [ ] **Step 4: Run the migration**

```bash
cd /root/ECOI_backend
pnpm db:migrate
```

Expected: "Migrations completed" or equivalent success message. No error.

- [ ] **Step 5: Verify the column exists**

```bash
cd /root/ECOI_backend
psql "$DATABASE_URL" -c "\d user_invitations" 2>&1 | grep target_user_id
```

If `$DATABASE_URL` isn't set in your shell, find it in `.env` and prefix the command. Expected output line containing `target_user_id | uuid |`.

- [ ] **Step 6: Commit**

```bash
cd /root/ECOI_backend
git add src/db/schema/user-invitations.ts src/db/migrations/
git commit -m "feat(db): add target_user_id to user_invitations

Enables 'renew account' flow: invitations can now point to an existing
user row (preserving FK history) instead of always creating a new user."
```

---

## Phase 4 — Backend: `renew()` service and endpoint

### Task 4: Create the `RenewUserDto`

**Files:**
- Create: `/root/ECOI_backend/src/modules/users/dto/renew-user.dto.ts`

- [ ] **Step 1: Create the DTO file**

Write to `/root/ECOI_backend/src/modules/users/dto/renew-user.dto.ts`:

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const renewUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(2).max(120).optional(),
  phone: z.string().max(40).nullable().optional(),
  role: z.enum(['admin', 'setter', 'commercial', 'delivrabilite']).optional(),
  team: z
    .enum(['setting', 'closing', 'admin', 'delivrabilite'])
    .nullable()
    .optional(),
});

export class RenewUserDto extends createZodDto(renewUserSchema) {}
```

- [ ] **Step 2: Type check**

```bash
cd /root/ECOI_backend
npx tsc --noEmit
```

Expected: no error related to renew-user.dto.ts.

- [ ] **Step 3: Commit (with subsequent task — don't commit yet, this DTO is unused until Task 5)**

Skip commit. Proceed to Task 5.

### Task 5: Implement `UsersService.renew()` (TDD)

**Files:**
- Modify: `/root/ECOI_backend/src/modules/users/users.service.ts`
- Modify: `/root/ECOI_backend/src/modules/users/users.service.spec.ts`

- [ ] **Step 1: Add required imports to users.service.ts**

In `src/modules/users/users.service.ts`, at the top, update the schema import:

Current:
```ts
import { userInvitations, users } from '../../db/schema';
```

Replace with:
```ts
import { accounts, sessions, userInvitations, users } from '../../db/schema';
```

- [ ] **Step 2: Write failing test #1 — renew() on non-existent user throws NotFoundException**

In `src/modules/users/users.service.spec.ts`, add a new `describe` block AFTER the existing `describe('UsersService — write', ...)` block:

```ts
describe('UsersService — renew', () => {
  const { db, pool } = createTestDb();
  let service: UsersService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DB_PROVIDER, useValue: db },
        // Mock InvitationMailService to avoid sending real emails in tests
        {
          provide: 'InvitationMailService',
          useValue: { sendInvitation: async () => false },
        },
      ],
    })
      // Match the real provider key (class) — see invite() injection
      .overrideProvider(require('./invitation-mail.service').InvitationMailService)
      .useValue({ sendInvitation: async () => false })
      .compile();
    service = moduleRef.get(UsersService);
  });

  beforeEach(() => truncateAll(pool));
  afterAll(() => pool.end());

  it('renew() throws NotFoundException si user inexistant', async () => {
    await expect(
      service.renew('00000000-0000-0000-0000-000000000000', {}, null),
    ).rejects.toThrow(/introuvable/i);
  });
});
```

If the `overrideProvider(...)` pattern doesn't work with your NestJS version (some emit "Token not found"), use this simpler `Test.createTestingModule` setup instead:

```ts
import { InvitationMailService } from './invitation-mail.service';
import { ConfigService } from '@nestjs/config';

const moduleRef = await Test.createTestingModule({
  providers: [
    UsersService,
    { provide: DB_PROVIDER, useValue: db },
    { provide: InvitationMailService, useValue: { sendInvitation: async () => false } },
    { provide: ConfigService, useValue: { get: () => 'http://localhost:3000' } },
  ],
}).compile();
```

Use this second form — it matches NestJS's class-token DI convention used elsewhere in the codebase.

- [ ] **Step 3: Run test #1 to confirm it fails (method not defined)**

```bash
cd /root/ECOI_backend
pnpm test -- users.service.spec.ts -t "renew\\(\\) throws NotFoundException"
```

Expected: FAIL — `service.renew is not a function` OR `Cannot read properties of undefined`.

- [ ] **Step 4: Implement the minimal `renew()` to make test #1 pass**

In `src/modules/users/users.service.ts`, add this method to the `UsersService` class (place it AFTER the existing `update()` method, BEFORE `softDelete()`):

```ts
async renew(id: string, dto: import('./dto/renew-user.dto').RenewUserDto, actorId: string | null) {
  const target = await this.findById(id);
  if (!target) {
    throw new NotFoundException(`User ${id} introuvable`);
  }
  // Stub — will be completed in Step 6
  return { invitation: null as any, inviteUrl: '', emailSent: false };
}
```

- [ ] **Step 5: Run test #1 — should PASS now**

```bash
cd /root/ECOI_backend
pnpm test -- users.service.spec.ts -t "renew\\(\\) throws NotFoundException"
```

Expected: PASS.

- [ ] **Step 6: Write failing test #2 — full renew flow**

Add inside the `describe('UsersService — renew', ...)` block:

```ts
it('renew() reset les credentials et crée une invitation avec targetUserId', async () => {
  const actor = await seedUser(db, { email: 'admin@t.lo', role: 'admin' });
  const target = await seedUser(db, { email: 'old@t.lo', name: 'Old', role: 'setter' });

  // Simule des credentials better-auth + une session active sur ce user
  await db.insert(accounts).values({
    id: 'acc-test-1',
    userId: target.id,
    accountId: target.email,
    providerId: 'credential',
    password: 'hashed-stub',
  });
  await db.insert(sessions).values({
    id: 'sess-test-1',
    userId: target.id,
    token: 'tok-1',
    expiresAt: new Date(Date.now() + 86400_000),
  });

  const result = await service.renew(
    target.id,
    { email: 'new@t.lo', name: 'NewName' },
    actor.id,
  );

  // 1. User updated
  const refreshed = await service.findById(target.id);
  expect(refreshed!.email).toBe('new@t.lo');
  expect(refreshed!.name).toBe('NewName');
  expect(refreshed!.emailVerified).toBe(false);
  expect(refreshed!.active).toBe(true);

  // 2. Credentials gone
  const remainingAccounts = await db.select().from(accounts).where(eq(accounts.userId, target.id));
  expect(remainingAccounts).toHaveLength(0);
  const remainingSessions = await db.select().from(sessions).where(eq(sessions.userId, target.id));
  expect(remainingSessions).toHaveLength(0);

  // 3. Invitation created with targetUserId
  expect(result.invitation.targetUserId).toBe(target.id);
  expect(result.invitation.status).toBe('pending');
  expect(result.invitation.email).toBe('new@t.lo');
  expect(result.inviteUrl).toMatch(/accept-invitation\?token=/);
});
```

You'll need to import `accounts`, `sessions`, `eq` at the top of the spec file if not already there:
```ts
import { accounts, sessions } from '../../db/schema';
import { eq } from 'drizzle-orm';
```

- [ ] **Step 7: Run test #2 to confirm it fails**

```bash
cd /root/ECOI_backend
pnpm test -- users.service.spec.ts -t "renew\\(\\) reset les credentials"
```

Expected: FAIL — likely `Cannot read properties of null (reading 'targetUserId')` or similar (the stub returns `null as any`).

- [ ] **Step 8: Implement the full `renew()`**

Replace the stub `renew()` in `src/modules/users/users.service.ts` with:

```ts
async renew(id: string, dto: import('./dto/renew-user.dto').RenewUserDto, actorId: string | null) {
  const target = await this.findById(id);
  if (!target) {
    throw new NotFoundException(`User ${id} introuvable`);
  }

  const newEmail = dto.email?.trim().toLowerCase() ?? target.email;
  if (newEmail !== target.email) {
    const collision = await this.findByEmail(newEmail);
    if (collision && collision.id !== id) {
      throw new ConflictException(`Email ${newEmail} déjà utilisé`);
    }
  }

  const now = new Date();
  const nextName = dto.name ?? target.name;
  const nextPhone = dto.phone !== undefined ? dto.phone : target.phone;
  const nextRole = dto.role ?? target.role;
  const nextTeam = dto.team !== undefined ? dto.team : target.team;

  await this.db
    .update(users)
    .set({
      email: newEmail,
      name: nextName,
      phone: nextPhone,
      role: nextRole,
      team: nextTeam,
      active: true,
      emailVerified: false,
      updatedAt: now,
    })
    .where(eq(users.id, id));

  // Wipe better-auth credentials + active sessions for this user
  await this.db.delete(accounts).where(eq(accounts.userId, id));
  await this.db.delete(sessions).where(eq(sessions.userId, id));

  // Revoke any pending invitation already pointing to this user
  await this.db
    .update(userInvitations)
    .set({ status: 'revoked', updatedAt: now })
    .where(
      and(
        eq(userInvitations.targetUserId, id),
        eq(userInvitations.status, 'pending'),
      ),
    );

  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashInvitationToken(token);

  const [invitation] = await this.db
    .insert(userInvitations)
    .values({
      email: newEmail,
      name: nextName,
      phone: nextPhone,
      role: nextRole,
      team: nextTeam,
      tokenHash,
      invitedById: actorId,
      expiresAt,
      targetUserId: id,
    })
    .returning();

  const inviteUrl = this.buildInviteUrl(token);
  const emailSent = await this.invitationMail.sendInvitation({
    to: newEmail,
    name: nextName,
    role: nextRole,
    inviteUrl,
  });

  return { invitation, inviteUrl, emailSent };
}
```

The import for the DTO type: at the top of users.service.ts, the import already uses inline `import('./dto/renew-user.dto').RenewUserDto`. To be cleaner, add a named import at the top:

```ts
import type { RenewUserDto } from './dto/renew-user.dto';
```
And replace the `import(...).RenewUserDto` inline reference in the method signature with just `RenewUserDto`.

- [ ] **Step 9: Run test #2 — should PASS**

```bash
cd /root/ECOI_backend
pnpm test -- users.service.spec.ts -t "renew\\(\\) reset les credentials"
```

Expected: PASS.

- [ ] **Step 10: Write failing test #3 — email collision**

Add inside the `describe('UsersService — renew', ...)` block:

```ts
it('renew() throws ConflictException si le nouvel email est pris par un autre user', async () => {
  const a = await seedUser(db, { email: 'a@t.lo' });
  await seedUser(db, { email: 'b@t.lo' });
  await expect(
    service.renew(a.id, { email: 'b@t.lo' }, null),
  ).rejects.toThrow(/déjà utilisé/i);
});
```

- [ ] **Step 11: Run test #3 — should PASS already (the collision check is implemented)**

```bash
cd /root/ECOI_backend
pnpm test -- users.service.spec.ts -t "renew\\(\\) throws ConflictException"
```

Expected: PASS.

- [ ] **Step 12: Run the full users test suite to confirm nothing else regressed**

```bash
cd /root/ECOI_backend
pnpm test -- users.service.spec
```

Expected: ALL tests pass.

- [ ] **Step 13: Commit**

```bash
cd /root/ECOI_backend
git add src/modules/users/dto/renew-user.dto.ts src/modules/users/users.service.ts src/modules/users/users.service.spec.ts
git commit -m "feat(users): add renew() service method

Resets better-auth credentials and emits a new invitation pointing to
the existing user row via target_user_id. FK history (leads, RDV,
calls assigned to this user) is preserved."
```

---

## Phase 5 — Backend: `acceptInvitation()` handles renewal

### Task 6: Branch `acceptInvitation()` on `targetUserId`

**Files:**
- Modify: `/root/ECOI_backend/src/modules/users/users.service.ts`
- Modify: `/root/ECOI_backend/src/modules/users/users.service.spec.ts`

- [ ] **Step 1: Write failing test — acceptInvitation with targetUserId sets password on existing user**

Add a new `describe` block to `users.service.spec.ts` AFTER the renew describe block:

```ts
describe('UsersService — acceptInvitation renewal flow', () => {
  const { db, pool } = createTestDb();
  let service: UsersService;

  beforeAll(async () => {
    const { InvitationMailService } = require('./invitation-mail.service');
    const { ConfigService } = require('@nestjs/config');
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DB_PROVIDER, useValue: db },
        { provide: InvitationMailService, useValue: { sendInvitation: async () => false } },
        { provide: ConfigService, useValue: { get: () => 'http://localhost:3000' } },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  beforeEach(() => truncateAll(pool));
  afterAll(() => pool.end());

  it('acceptInvitation() avec targetUserId set password sans créer un doublon user', async () => {
    // Seed a user that simulates an Airtable import without credentials
    const target = await seedUser(db, { email: 'import@t.lo', name: 'Imported' });
    const usersBefore = await service.findAll();
    expect(usersBefore.map((u) => u.id)).toContain(target.id);

    // Generate an invitation with targetUserId pointing at the existing user
    const renewResult = await service.renew(target.id, {}, null);
    // The plaintext token isn't returned (only the URL). Extract from URL:
    const token = new URL(renewResult.inviteUrl).searchParams.get('token')!;

    await service.acceptInvitation({ token, password: 'StrongPass123!' });

    // Same user row, no doublon
    const usersAfter = await service.findAll();
    expect(usersAfter.filter((u) => u.email === 'import@t.lo')).toHaveLength(1);
    const refreshed = await service.findById(target.id);
    expect(refreshed!.id).toBe(target.id); // ID unchanged
    expect(refreshed!.emailVerified).toBe(true);
    expect(refreshed!.active).toBe(true);
  });
});
```

**Note:** the `buildInviteUrl` produces a `#/accept-invitation?token=...` hash-route URL. `new URL(...).searchParams` doesn't parse hash-fragment params. Use this alternative extraction:

```ts
const token = renewResult.inviteUrl.match(/token=([^&]+)/)![1];
```

Use this match-based extraction in the test.

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /root/ECOI_backend
pnpm test -- users.service.spec.ts -t "acceptInvitation\\(\\) avec targetUserId"
```

Expected: FAIL — likely `auth.api.signUpEmail` rejects because a user with this email already exists (the "behavior to validate" flagged in the spec).

**Observe carefully what error is thrown.** Three outcomes possible:
1. `signUpEmail` errors with "user already exists" → see Step 3 alternative implementation.
2. `signUpEmail` succeeds and creates a duplicate `users` row with a different ID → see Step 3 alternative.
3. `signUpEmail` succeeds and reuses the existing row → test should pass but `emailVerified` may still be false. Step 3 still required for the post-update.

Record the actual error/behavior in this step output before proceeding.

- [ ] **Step 3: Modify `acceptInvitation()` to handle the renewal branch**

In `src/modules/users/users.service.ts`, find the existing `acceptInvitation()` method. Locate the section AFTER the validation checks (expiry, status, etc.) — specifically where the code currently calls `findByEmail` then `auth.api.signUpEmail`:

```ts
const existing = await this.findByEmail(invitation.email);
if (existing) {
  throw new ConflictException(`Email ${invitation.email} déjà utilisé`);
}

await auth.api.signUpEmail({ ... });
// ... rest of the new user flow
```

Insert the renewal branch BEFORE that block:

```ts
// Renewal branch: invitation targets an existing user → set password on that user
if (invitation.targetUserId) {
  const target = await this.findById(invitation.targetUserId);
  if (!target) {
    throw new NotFoundException('Utilisateur cible introuvable');
  }

  // The user row already exists. We need better-auth to create just an `accounts`
  // row (password credential) for this user. The renew() flow has already wiped
  // any prior `accounts`/`sessions` rows, so there's no collision risk.
  //
  // Strategy: insert the `accounts` row directly using better-auth's password
  // hasher to keep compatibility with future better-auth versions.
  const ctx = await (auth as any).$context;
  const hashed = await ctx.password.hash(dto.password);
  await this.db.insert(accounts).values({
    id: randomBytes(16).toString('hex'),
    userId: target.id,
    accountId: target.email,
    providerId: 'credential',
    password: hashed,
  });

  await this.db
    .update(users)
    .set({
      emailVerified: true,
      active: true,
      updatedAt: now,
    })
    .where(eq(users.id, target.id));

  await this.db
    .update(userInvitations)
    .set({
      status: 'accepted',
      acceptedUserId: target.id,
      acceptedAt: now,
      updatedAt: now,
    })
    .where(eq(userInvitations.id, invitation.id));

  const refreshed = await this.findById(target.id);
  return refreshed!;
}
```

**Note on `auth.$context`**: better-auth exposes the password hasher via the `$context` property. If `auth.$context` is not available on your better-auth version, replace the `ctx.password.hash(dto.password)` line with a direct bcrypt call:

```ts
const bcrypt = await import('bcrypt');
const hashed = await bcrypt.hash(dto.password, 10);
```

(install bcrypt if missing: `pnpm add bcrypt && pnpm add -D @types/bcrypt`).

**Imports to add at top of file:**
```ts
import { randomBytes } from 'node:crypto';
```
(may already be present — check)

- [ ] **Step 4: Run the renewal test again**

```bash
cd /root/ECOI_backend
pnpm test -- users.service.spec.ts -t "acceptInvitation\\(\\) avec targetUserId"
```

Expected: PASS.

If it fails because `auth.$context` is undefined, switch to the bcrypt fallback noted in Step 3. Re-run.

- [ ] **Step 5: Manual end-to-end verification of password works**

Add this test inside the same describe block to confirm the new password actually authenticates:

```ts
it('le nouveau mot de passe permet effectivement de se connecter', async () => {
  const target = await seedUser(db, { email: 'verify@t.lo', name: 'V' });
  const renewResult = await service.renew(target.id, {}, null);
  const token = renewResult.inviteUrl.match(/token=([^&]+)/)![1];
  await service.acceptInvitation({ token, password: 'VeryStrong42!' });

  // Try signing in via better-auth
  const signIn = await auth.api.signInEmail({
    body: { email: 'verify@t.lo', password: 'VeryStrong42!' },
    asResponse: false,
  } as any);
  expect(signIn).toBeDefined();
  // signIn shape: { user, session } or similar — adapt based on better-auth version.
  expect((signIn as any).user?.id).toBe(target.id);
});
```

Import `auth` at the top of the spec if needed:
```ts
import { auth } from '../../auth/auth.config';
```

Run:
```bash
cd /root/ECOI_backend
pnpm test -- users.service.spec.ts -t "le nouveau mot de passe permet"
```

Expected: PASS.

If this fails, the password hash format isn't compatible with better-auth's signin verification. In that case, REVERT to using `auth.api.signUpEmail` but FIRST DELETE the existing `users` row (renew handles cleanup of accounts/sessions, but the users row stays — better-auth might choke). Discuss with maintainer before proceeding.

- [ ] **Step 6: Verify the regular invitation flow still works**

Run the existing invite test (or write one if absent):

```bash
cd /root/ECOI_backend
pnpm test -- users.service.spec
```

Expected: ALL tests pass (renewal + classic invitation).

- [ ] **Step 7: Commit**

```bash
cd /root/ECOI_backend
git add src/modules/users/users.service.ts src/modules/users/users.service.spec.ts
git commit -m "feat(users): acceptInvitation supports renewal via targetUserId

When invitation has targetUserId set, set password directly on the
existing user row instead of creating a new one. Preserves all FK
relationships (leads.assignedToId, rdv.commercialId, etc.)."
```

---

## Phase 6 — Backend: Controller endpoint and DTO response

### Task 7: Add `POST /users/:id/renew` and expose `targetUserId` in `InvitationResponse`

**Files:**
- Modify: `/root/ECOI_backend/src/modules/users/dto/invitation-response.dto.ts`
- Modify: `/root/ECOI_backend/src/modules/users/users.controller.ts`
- Modify: `/root/ECOI_backend/src/modules/users/users.controller.spec.ts`

- [ ] **Step 1: Extend `InvitationResponse` DTO with `targetUserId`**

In `src/modules/users/dto/invitation-response.dto.ts`, update the type:

```ts
export type InvitationResponse = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: 'admin' | 'setter' | 'commercial' | 'delivrabilite';
  team: 'setting' | 'closing' | 'admin' | 'delivrabilite' | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  targetUserId: string | null;
};
```

Update `toInvitationResponse()` to accept and return `targetUserId`. Replace the function with:

```ts
export function toInvitationResponse(row: {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: 'admin' | 'setter' | 'commercial' | 'delivrabilite';
  team: 'setting' | 'closing' | 'admin' | 'delivrabilite' | null;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
  targetUserId: string | null;
}): InvitationResponse {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    role: row.role,
    team: row.team,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    targetUserId: row.targetUserId,
  };
}
```

- [ ] **Step 2: Add the `renew` controller method**

In `src/modules/users/users.controller.ts`, add this import at the top:
```ts
import { RenewUserDto } from './dto/renew-user.dto';
```

Then add this method to `UsersController` (place it AFTER `update()` and BEFORE `remove()`):

```ts
@Post(':id/renew')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
@Audit({ entityType: 'user', action: 'renew' })
async renew(
  @Param('id', ParseUUIDPipe) id: string,
  @Body(new ZodValidationPipe()) dto: RenewUserDto,
  @CurrentUser() session: SessionUser,
): Promise<{ user: UserResponse; inviteUrl: string; emailSent: boolean }> {
  const { inviteUrl, emailSent } = await this.users.renew(id, dto, session.id);
  const refreshed = await this.users.findById(id);
  if (!refreshed) {
    // Defensive: shouldn't happen because renew() throws if user not found.
    throw new NotFoundException(`User ${id} introuvable`);
  }
  return {
    user: toUserResponse(refreshed),
    inviteUrl,
    emailSent,
  };
}
```

- [ ] **Step 3: Type check the backend**

```bash
cd /root/ECOI_backend
npx tsc --noEmit
```

Expected: no new errors. If `InvitationResponse` callers fail due to the new required field, search-replace to ensure `toInvitationResponse` is always called with a row that has `targetUserId` (the DB row already has it after migration).

- [ ] **Step 4: Add a controller integration test for the endpoint**

In `src/modules/users/users.controller.spec.ts`, add a test (or new describe block) that hits `POST /users/:id/renew` and asserts the response shape. Copy the testing pattern from existing controller tests in the file. The test should:
1. Seed an admin user, set session to that admin.
2. Seed a target user.
3. Call `controller.renew(target.id, { name: 'NewName' }, adminSession)`.
4. Assert response has `user`, `inviteUrl` (string), `emailSent` (boolean).

If the existing controller test file doesn't have a clean pattern for this (e.g., requires full Nest HTTP harness), skip this step — the service tests already cover the logic. Document the skip in the commit message.

- [ ] **Step 5: Run all users tests**

```bash
cd /root/ECOI_backend
pnpm test -- users
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /root/ECOI_backend
git add src/modules/users/dto/invitation-response.dto.ts src/modules/users/users.controller.ts src/modules/users/users.controller.spec.ts
git commit -m "feat(users): POST /users/:id/renew endpoint

Admin-only endpoint to regenerate a password-creation link for an
existing user. Returns the inviteUrl so the admin can copy it from
the UI even if the email send fails."
```

---

## Phase 7 — Frontend: API helpers + types

### Task 8: Add `renewUser`, `updateUser`, `deleteUser` to hooks.ts and extend types

**Files:**
- Modify: `/root/ECOI_frontend/src/lib/types.ts`
- Modify: `/root/ECOI_frontend/src/lib/hooks.ts`

- [ ] **Step 1: Read current `InvitationResponse` type and extend it**

Open `src/lib/types.ts` and find the `InvitationResponse` type. Add `targetUserId: string | null` to the type. The exact location depends on the file structure — search for `export type InvitationResponse`. The shape must match the backend DTO from Phase 6.

Example modification — if the current shape is:
```ts
export type InvitationResponse = {
  id: string
  email: string
  // ...
  acceptedAt: string | null
}
```
Add the field:
```ts
export type InvitationResponse = {
  id: string
  email: string
  // ...
  acceptedAt: string | null
  targetUserId: string | null
}
```

- [ ] **Step 2: Add the three new functions to hooks.ts**

In `src/lib/hooks.ts`, find the existing `acceptInvitation` function (around line 317). AFTER it, add the following three exports. Place them in the `// ─── Users ─────────────────────────────────────────────────` section (before the Analytics section starts):

```ts
export type UpdateUserPayload = {
  name?: string
  phone?: string | null
  role?: UserResponse['role']
  team?: UserResponse['team']
  active?: boolean
}

export async function updateUser(id: string, input: UpdateUserPayload): Promise<UserResponse> {
  return api<UserResponse>(`/users/${id}`, { method: 'PATCH', body: input })
}

export type RenewUserPayload = {
  email?: string
  name?: string
  phone?: string | null
  role?: UserResponse['role']
  team?: UserResponse['team']
}

export type RenewUserResponse = {
  user: UserResponse
  inviteUrl: string
  emailSent: boolean
}

export async function renewUser(id: string, input: RenewUserPayload): Promise<RenewUserResponse> {
  return api<RenewUserResponse>(`/users/${id}/renew`, { method: 'POST', body: input })
}

export async function deleteUser(id: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/users/${id}`, { method: 'DELETE' })
}
```

- [ ] **Step 3: Type check the frontend**

```bash
cd /root/ECOI_frontend
npx tsc --noEmit
```

Expected: no new errors in `hooks.ts` or `types.ts`.

- [ ] **Step 4: Commit**

```bash
cd /root/ECOI_frontend
git add src/lib/types.ts src/lib/hooks.ts
git commit -m "feat(api): add updateUser, renewUser, deleteUser helpers"
```

---

## Phase 8 — Frontend: UserEditModal component

### Task 9: Build the `UserEditModal` component

**Files:**
- Create: `/root/ECOI_frontend/src/components/UserEditModal.tsx`

- [ ] **Step 1: Read an existing modal in the codebase to match the style**

Open `src/pages/Settings.tsx` and read the `InviteModal` function (around line 152). Note:
- Background/overlay pattern
- Form field components (`Input`, `Select` if used)
- Loading state pattern (`saving`, `message`, `error`)
- Close-on-success behavior

This is the reference style — match it.

- [ ] **Step 2: Create the component file**

Write to `/root/ECOI_frontend/src/components/UserEditModal.tsx`:

```tsx
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from './Icon'
import { Spinner } from './Spinner'
import { deleteUser, renewUser, updateUser } from '../lib/hooks'
import { notifyClipboardCopied } from '../lib/clipboardToast'
import type { InvitationResponse, Role, Team, UserResponse } from '../lib/types'

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'setter', label: 'Setter' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'admin', label: 'Admin' },
  { value: 'delivrabilite', label: 'Délivrabilité' },
]

const TEAM_BY_ROLE: Record<Role, NonNullable<Team>> = {
  setter: 'setting',
  commercial: 'closing',
  admin: 'admin',
  delivrabilite: 'delivrabilite',
}

type Mode = 'edit' | 'renewed'

type Props = {
  user: UserResponse
  pendingInvitation: InvitationResponse | null
  onClose: () => void
  onChanged: () => void
}

export function UserEditModal({ user, pendingInvitation, onClose, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>('edit')
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [role, setRole] = useState<Role>(user.role)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRenew, setConfirmRenew] = useState(false)
  const [renewedUrl, setRenewedUrl] = useState<string>('')
  const [renewedEmailSent, setRenewedEmailSent] = useState(false)

  const accountStatus = computeAccountStatus(user, pendingInvitation)

  async function onSubmitEdit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const patch: Parameters<typeof updateUser>[1] = {}
      if (name !== user.name) patch.name = name
      if (phone !== (user.phone ?? '')) patch.phone = phone.trim() === '' ? null : phone.trim()
      if (role !== user.role) {
        patch.role = role
        patch.team = TEAM_BY_ROLE[role]
      }
      // Email is changed via the renew flow only (it requires resetting the password).
      // Reject email change from this submit:
      if (email !== user.email) {
        throw new Error("Pour changer l'email, utilise 'Renouveler le compte' (réinitialise le mot de passe).")
      }
      if (Object.keys(patch).length > 0) {
        await updateUser(user.id, patch)
      }
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setSaving(false)
    }
  }

  async function doRenew() {
    setSaving(true)
    setError(null)
    try {
      const payload: Parameters<typeof renewUser>[1] = {}
      if (name !== user.name) payload.name = name
      if (email !== user.email) payload.email = email
      if (phone !== (user.phone ?? '')) payload.phone = phone.trim() === '' ? null : phone.trim()
      if (role !== user.role) {
        payload.role = role
        payload.team = TEAM_BY_ROLE[role]
      }
      const res = await renewUser(user.id, payload)
      setRenewedUrl(res.inviteUrl)
      setRenewedEmailSent(res.emailSent)
      setMode('renewed')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setSaving(false)
      setConfirmRenew(false)
    }
  }

  async function doDelete() {
    setSaving(true)
    setError(null)
    try {
      await deleteUser(user.id)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      setSaving(false)
      setConfirmDelete(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(renewedUrl)
      notifyClipboardCopied({ message: "Lien d'invitation copié" })
    } catch {
      // navigator.clipboard not available — silent fallback
    }
  }

  return (
    <div className="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="font-bold text-lg">Modifier l'utilisateur</h2>
          <button onClick={onClose} className="p-1 hover:bg-or-tint rounded-lg" aria-label="Fermer">
            <Icon name="x" size={16} />
          </button>
        </div>

        {mode === 'renewed' ? (
          <RenewedView
            inviteUrl={renewedUrl}
            emailSent={renewedEmailSent}
            targetEmail={email}
            onCopy={copyLink}
            onClose={onClose}
          />
        ) : (
          <>
            <div className="px-6 py-4 border-b border-line-soft">
              <div className="text-[10px] font-bold text-faint uppercase tracking-widest mb-2">STATUT COMPTE</div>
              <AccountStatusBadge status={accountStatus} />
            </div>

            <form onSubmit={onSubmitEdit} className="px-6 py-4 space-y-3">
              <LabeledInput label="NOM" value={name} onChange={setName} required />
              <LabeledInput label="EMAIL" value={email} onChange={setEmail} type="email" required />
              <LabeledInput label="TÉLÉPHONE" value={phone} onChange={setPhone} placeholder="+262 692 ..." />
              <div>
                <div className="text-[10px] font-bold text-faint uppercase tracking-widest mb-1">RÔLE</div>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="w-full bg-white border border-line rounded px-2 py-1.5 text-sm"
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {error && <div className="text-xs text-rouille bg-rouille-tint/40 rounded p-2">{error}</div>}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={onClose} disabled={saving} className="text-xs font-semibold text-faint hover:underline disabled:opacity-50">Annuler</button>
                <button type="submit" disabled={saving} className="btn-primary px-4 py-2 rounded-xl text-sm disabled:opacity-60 flex items-center gap-2">
                  {saving && <Spinner size={14} stroke={2} />}
                  Enregistrer
                </button>
              </div>
            </form>

            <div className="px-6 py-4 border-t border-line bg-or-tint/30 space-y-3">
              <div className="text-[10px] font-bold text-faint uppercase tracking-widest">ZONE DANGEREUSE</div>

              <div className="space-y-2">
                {!confirmRenew ? (
                  <button
                    onClick={() => setConfirmRenew(true)}
                    disabled={saving}
                    className="w-full text-left rounded-xl border border-cuivre bg-white p-3 hover:bg-cuivre-tint/30 disabled:opacity-50"
                  >
                    <div className="font-semibold text-sm flex items-center gap-2"><Icon name="refresh-cw" size={14} /> Renouveler le compte</div>
                    <div className="text-xs text-muted mt-1">Régénère un lien de création de mot de passe. L'utilisateur garde tous ses leads et RDV.</div>
                  </button>
                ) : (
                  <div className="rounded-xl border border-cuivre bg-white p-3">
                    <div className="text-sm font-semibold mb-2">Confirmer le renouvellement ?</div>
                    <div className="text-xs text-muted mb-3">Le mot de passe actuel sera invalidé. Un nouveau lien sera généré.</div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setConfirmRenew(false)} disabled={saving} className="text-xs text-faint">Annuler</button>
                      <button onClick={doRenew} disabled={saving} className="btn-primary px-3 py-1.5 rounded-lg text-xs disabled:opacity-60 flex items-center gap-2">
                        {saving && <Spinner size={12} stroke={2} />}
                        Confirmer
                      </button>
                    </div>
                  </div>
                )}

                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    disabled={saving}
                    className="w-full text-left rounded-xl border border-rouille bg-white p-3 hover:bg-rouille-tint/30 disabled:opacity-50"
                  >
                    <div className="font-semibold text-sm text-rouille flex items-center gap-2"><Icon name="trash" size={14} /> Supprimer l'utilisateur</div>
                    <div className="text-xs text-muted mt-1">Désactive le compte. Les leads, RDV et appels restent associés à l'historique.</div>
                  </button>
                ) : (
                  <div className="rounded-xl border border-rouille bg-white p-3">
                    <div className="text-sm font-semibold mb-2">Supprimer {user.name} ?</div>
                    <div className="text-xs text-muted mb-3">L'utilisateur ne pourra plus se connecter. L'historique reste intact.</div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setConfirmDelete(false)} disabled={saving} className="text-xs text-faint">Annuler</button>
                      <button onClick={doDelete} disabled={saving} className="bg-rouille text-white px-3 py-1.5 rounded-lg text-xs disabled:opacity-60 flex items-center gap-2">
                        {saving && <Spinner size={12} stroke={2} />}
                        Supprimer définitivement
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function RenewedView({
  inviteUrl,
  emailSent,
  targetEmail,
  onCopy,
  onClose,
}: {
  inviteUrl: string
  emailSent: boolean
  targetEmail: string
  onCopy: () => void
  onClose: () => void
}) {
  return (
    <div className="px-6 py-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-success-tint text-success flex items-center justify-center font-bold">✓</div>
        <div>
          <div className="font-bold text-base">Compte renouvelé</div>
          <div className="text-xs text-muted">Le mot de passe précédent est invalidé.</div>
        </div>
      </div>

      <div>
        <div className="text-[10px] font-bold text-faint uppercase tracking-widest mb-1">LIEN DE CRÉATION DE MOT DE PASSE</div>
        <div className="flex items-stretch gap-2">
          <input
            value={inviteUrl}
            readOnly
            onClick={(e) => e.currentTarget.select()}
            className="flex-grow bg-white border border-line rounded px-2 py-1.5 text-xs font-mono"
          />
          <button onClick={onCopy} className="btn-primary px-3 py-1.5 rounded-lg text-xs flex items-center gap-1">
            <Icon name="copy" size={12} /> Copier
          </button>
        </div>
      </div>

      <div className={`text-xs rounded p-2 ${emailSent ? 'bg-success-tint text-success' : 'bg-cuivre-tint text-cuivre'}`}>
        {emailSent
          ? `Email envoyé à ${targetEmail}.`
          : `Email non envoyé — transmets le lien à ${targetEmail} manuellement (WhatsApp, SMS, etc.).`}
      </div>

      <div className="flex justify-end pt-2">
        <button onClick={onClose} className="btn-primary px-4 py-2 rounded-xl text-sm">Fermer</button>
      </div>
    </div>
  )
}

type AccountStatus = 'complete' | 'pending' | 'imported'

function computeAccountStatus(user: UserResponse, invitation: InvitationResponse | null): AccountStatus {
  if (user.lastLoginAt) return 'complete'
  if (invitation && invitation.status === 'pending') return 'pending'
  return 'imported'
}

function AccountStatusBadge({ status }: { status: AccountStatus }) {
  if (status === 'complete') return <span className="status-badge bg-success-tint text-success">✓ Compte complet — peut se connecter</span>
  if (status === 'pending') return <span className="status-badge bg-cuivre-tint text-cuivre">⏳ En attente d'invitation</span>
  return <span className="status-badge bg-rouille-tint text-rouille">⚠️ Importé Airtable, jamais activé</span>
}

function LabeledInput({
  label, value, onChange, type = 'text', placeholder, required = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <div>
      <div className="text-[10px] font-bold text-faint uppercase tracking-widest mb-1">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full bg-white border border-line rounded px-2 py-1.5 text-sm"
      />
    </div>
  )
}
```

- [ ] **Step 3: Verify icons used exist**

The component uses Icon names: `x`, `refresh-cw`, `trash`, `copy`. Run:
```bash
grep -n "'x'\|'refresh-cw'\|'trash'\|'copy'" /root/ECOI_frontend/src/components/Icon.tsx
```

If any icon name doesn't appear, open `Icon.tsx`, find the `IconName` type union, and either:
- Find the closest substitute (e.g., `'edit'` instead of `'refresh-cw'`) and update the component, OR
- Add a new icon entry in Icon.tsx using an existing SVG pattern.

If `refresh-cw` is missing, use `'edit'` (already exists in the codebase). If `trash` is missing, use `'x'`. If `copy` is missing, use `'edit'`.

- [ ] **Step 4: Verify `UserResponse.lastLoginAt` exists in the type**

```bash
grep -n "lastLoginAt" /root/ECOI_frontend/src/lib/types.ts
```

Expected: at least one match. If missing, add it to `UserResponse`:
```ts
lastLoginAt: string | null
```

- [ ] **Step 5: Type check**

```bash
cd /root/ECOI_frontend
npx tsc --noEmit
```

Expected: no errors in `UserEditModal.tsx`.

- [ ] **Step 6: Commit**

```bash
cd /root/ECOI_frontend
git add src/components/UserEditModal.tsx
git commit -m "feat(settings): UserEditModal component

Admin modal with three sections: account status badge, editable
fields (name/email/phone/role), and danger zone (renew + delete)."
```

---

## Phase 9 — Frontend: Wire UserEditModal into Settings

### Task 10: Make `UserRow` open the modal on click

**Files:**
- Modify: `/root/ECOI_frontend/src/pages/Settings.tsx`

- [ ] **Step 1: Add state and `pendingInvitationByUserId` map to `SettingsAdmin`**

Open `src/pages/Settings.tsx`. Find the `SettingsAdmin` function. Add an import at the top:

```ts
import { UserEditModal } from '../components/UserEditModal'
```

Inside `SettingsAdmin`, after the existing `useState` declarations, add:

```ts
const [editingUser, setEditingUser] = useState<UserResponse | null>(null)

const pendingInvitationByUserId = useMemo(() => {
  const map = new Map<string, InvitationResponse>()
  for (const inv of invitations ?? []) {
    if (inv.status === 'pending' && inv.targetUserId) {
      map.set(inv.targetUserId, inv)
    }
  }
  return map
}, [invitations])
```

- [ ] **Step 2: Pass `onEdit` to `UserRow`**

Change the line:
```tsx
<tbody>{team.map((m) => <UserRow key={m.id} user={m} />)}</tbody>
```
to:
```tsx
<tbody>{team.map((m) => <UserRow key={m.id} user={m} onEdit={setEditingUser} />)}</tbody>
```

- [ ] **Step 3: Update `UserRow` signature**

Find the `UserRow` function (around line 236). Change its signature from:
```tsx
function UserRow({ user }: { user: UserResponse }) {
```
to:
```tsx
function UserRow({ user, onEdit }: { user: UserResponse; onEdit: (u: UserResponse) => void }) {
```

Then update the "Modifier" button. Find:
```tsx
<td className="px-3 py-3 text-right"><button className="text-xs text-muted hover:text-text font-semibold">Modifier</button></td>
```
Replace with:
```tsx
<td className="px-3 py-3 text-right"><button onClick={() => onEdit(user)} className="text-xs text-muted hover:text-text font-semibold">Modifier</button></td>
```

- [ ] **Step 4: Render the modal**

Find the existing `inviteOpen` conditional block at the bottom of `SettingsAdmin`:
```tsx
{inviteOpen && (
  <InviteModal ... />
)}
```

AFTER it (still inside the `<AppShell>`), add:
```tsx
{editingUser && (
  <UserEditModal
    user={editingUser}
    pendingInvitation={pendingInvitationByUserId.get(editingUser.id) ?? null}
    onClose={() => setEditingUser(null)}
    onChanged={() => {
      refetchUsers()
      refetchInvitations()
    }}
  />
)}
```

- [ ] **Step 5: Type check the frontend**

```bash
cd /root/ECOI_frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Start the dev server and smoke-test**

```bash
cd /root/ECOI_frontend
npm run dev
```

In a browser (admin account):
1. Navigate to Settings.
2. Click "Modifier" on any user → modal opens with account status badge.
3. Change the name → click "Enregistrer" → modal closes, name updates in the table.
4. Click "Modifier" again → click "Renouveler le compte" → "Confirmer" → see the renewed view with the link.
5. Click "Copier" → see toast.
6. Close. Click "Modifier" on another user → click "Supprimer" → "Confirmer" → user disappears from the list.

If any step fails, fix the underlying issue before committing.

- [ ] **Step 7: Commit**

```bash
cd /root/ECOI_frontend
git add src/pages/Settings.tsx
git commit -m "feat(settings): wire UserRow to UserEditModal

Click on Modifier opens the modal with edit / renew / delete actions."
```

---

## Phase 10 — End-to-end UAT

### Task 11: Manual UAT — Lead unrestricted edit

- [ ] **Step 1: Setter scenario — modify revenuFiscal**

1. Sign in as a setter (non-admin) account.
2. Open any lead from the leads list.
3. Click the "Modifier" button (top right of Infos tab).
4. Confirm the inputs "TYPE LOGEMENT" and "REVENU FISCAL" are present.
5. Enter `32000` in Revenu fiscal, click "Enregistrer".
6. Verify: no error, the field switches back to read-only mode showing `32 000`.
7. Refresh the page → value persists.

Expected: success. If error, capture the screenshot + browser console + backend log line and stop.

- [ ] **Step 2: Setter scenario — odd status transition**

1. Same account.
2. Find or create a lead currently in status `signe`.
3. Open the lead, click Modifier, change STATUT to `nouveau`, save.
4. Verify: no "Transition de statut interdite" error.

Expected: success.

### Task 12: Manual UAT — User management

- [ ] **Step 1: Admin scenario — edit a user's name**

1. Sign in as admin.
2. Go to Settings → click Modifier on any user.
3. Change the name → Enregistrer → modal closes → table shows new name.

- [ ] **Step 2: Admin scenario — renew an Airtable-imported user**

1. Identify a user imported from Airtable (no `lastLoginAt`, never logged in).
2. Note: their user ID, their assigned leads count. Run:
   ```bash
   psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM leads WHERE assigned_to_id = 'THE_USER_ID' OR setter_id = 'THE_USER_ID';"
   ```
3. Open the user in the modal. Account status badge should read "Importé Airtable, jamais activé".
4. Click "Renouveler le compte" → Confirmer.
5. Copy the `inviteUrl` displayed.
6. Open the link in a private/incognito browser window.
7. Enter a new password (twice if the AcceptInvitation form requires it) → submit.
8. Try logging in with that password → should succeed.
9. Re-run the SQL count from step 2 with the same user ID → count must be unchanged.

Expected: all steps succeed. The leads/RDV count is preserved.

- [ ] **Step 3: Admin scenario — delete a user**

1. Create a throwaway user via Inviter (don't accept the invitation).
2. Open the user in the modal → click Supprimer → Confirmer.
3. Verify: user disappears from the table.
4. Run:
   ```bash
   psql "$DATABASE_URL" -c "SELECT id, email, active, deleted_at FROM users WHERE email = 'throwaway@t.lo';"
   ```
   Expected: `active = false`, `deleted_at` is set.

### Task 13: Final cleanup commit

- [ ] **Step 1: Run all backend tests one last time**

```bash
cd /root/ECOI_backend
pnpm test
```

Expected: all green. If any test fails, fix it before declaring done.

- [ ] **Step 2: Run frontend type check + lint**

```bash
cd /root/ECOI_frontend
npx tsc --noEmit
npm run lint 2>&1 || true
```

Fix any errors directly attributable to this work.

- [ ] **Step 3: Confirm the spec's "Critères de succès" checklist**

Open `/root/ECOI_frontend/docs/superpowers/specs/2026-05-14-leads-edit-unrestricted-user-mgmt-design.md`, scroll to "Critères de succès", and mentally tick each item:

- [ ] Setter peut sauvegarder `revenuFiscal` et `typeLogement` depuis le sidebar lead.
- [ ] Setter peut faire toutes les transitions de statut sans erreur backend.
- [ ] Admin peut ouvrir un popup sur n'importe quel user depuis Settings.
- [ ] Admin peut éditer nom/email/téléphone/rôle/team et sauvegarder.
- [ ] Admin peut cliquer "Renouveler le compte" et obtenir un lien fonctionnel.
- [ ] L'user clique sur ce lien, set un password, et se connecte avec son user.id historique inchangé.
- [ ] Les leads et RDV de ce user restent assignés à user.id après renouvellement.
- [ ] Admin peut soft-delete un user avec confirmation.

If any item is not satisfied, return to the relevant Phase and fix.

- [ ] **Step 4: Sign-off**

Report to the user: "Implementation complete. All 8 success criteria verified manually."

---

## Risks and follow-ups

1. **better-auth `auth.$context.password.hash`** : if this API surface doesn't exist in the installed version, Phase 5 Step 3 includes a bcrypt fallback. Document which path was used in the commit message.

2. **Email change without renewal** : the edit form refuses to submit an email change (force "renouveler le compte"). This is intentional — changing email on an account with active credentials would break the user's password login. Renewal is the only path for email change.

3. **Soft-deleted users in `userMap`** : after a user is soft-deleted, the frontend `userMap` (built from `GET /users`) no longer includes them. Lead sidebar will show empty setter/commercial names for old assignments. Acceptable per spec; can be improved later by exposing a "include deleted" query param on `GET /users`.
