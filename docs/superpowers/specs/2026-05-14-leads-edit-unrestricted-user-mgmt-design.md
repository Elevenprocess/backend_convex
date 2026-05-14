# Spec — Setters tous droits sur leads + Gestion users admin

**Date** : 2026-05-14
**Auteur** : Erwan
**Repos touchés** : `ECOI_backend`, `ECOI_frontend`
**Statut** : Validé, prêt pour planning

## Contexte

Deux problèmes liés à la gestion des permissions :

1. **Setters bloqués sur les leads** : un setter qui tente de modifier le champ `revenuFiscal` (ou de faire une transition de statut non standard) reçoit une erreur. La logique RBAC actuelle force certains champs/transitions à passer par un admin. Côté usage interne ECOI, cette protection génère plus de friction que de valeur — on veut que les setters soient égaux aux admins sur les leads.

2. **Pas de gestion users admin** : le bouton "Modifier" dans `Settings.tsx > UserRow` n'a pas d'onClick. L'admin ne peut ni éditer un user, ni le supprimer, ni régénérer un lien d'invitation. Bloquant pour les users importés depuis Airtable qui n'ont jamais de credentials better-auth — actuellement aucun moyen de leur fournir un mot de passe sans intervention DB manuelle.

## Objectifs

- Setter peut modifier **tous** les champs d'un lead, faire **toutes** les transitions de statut.
- Admin peut, depuis Settings, ouvrir un popup par user pour : éditer ses infos, renouveler son compte (nouveau lien de création de mot de passe), supprimer le compte.
- Le renouvellement conserve **toutes les associations** : leads, RDV, appels du user restent rattachés au même `user.id`.

## Non-objectifs

- Pas de système de permissions granulaires (champ par champ). On simplifie, on ne complexifie pas.
- Pas de gestion de mots de passe oubliés côté self-service user (reset password classique). Le renouvellement est admin-initiated uniquement.
- Pas de réaffectation automatique des leads lors d'une suppression. L'historique reste mais le user supprimé reste référencé par les FK.

---

## Change 1 — Lead edit unrestricted

### Backend

**`src/modules/leads/leads.service.ts`**

- Supprimer la constante `ALLOWED_TRANSITIONS` (lignes 25-36).
- Supprimer le bloc de validation de transition dans `update()` (lignes 143-151).
- Retirer le paramètre `ctx` (et son type `{ actorRole?: ActorContext['role'] }`) de la signature de `update()`.

**`src/modules/leads/leads.controller.ts`**

- Ligne 76 : `this.svc.update(id, dto, { actorRole: session.role })` → `this.svc.update(id, dto)`.
- Retirer le `@CurrentUser() session: SessionUser` du handler `update()` s'il n'est plus utilisé ailleurs (vérifier — il sert peut-être à l'AuditInterceptor).

**Tests à adapter**

- `leads.service.spec.ts` : retirer les tests qui vérifient un throw `BadRequestException` sur transition interdite.
- `leads.controller.spec.ts` : retirer toute assertion équivalente. Ajouter un test "setter peut PATCH revenuFiscal sur n'importe quel lead sans erreur".

### Frontend

**`src/components/SplitPanel.tsx` — `InfosTab`**

Type `InfosEditable` (autour de la ligne 240) — passer de 8 à 10 champs :

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
  typeLogement: string      // NEW
  revenuFiscal: string      // NEW (string pour input, parse au save)
}
```

`leadToInfosForm()` ajoute :
```ts
typeLogement: cleanField(lead.typeLogement) ?? '',
revenuFiscal: lead.revenuFiscal?.toString() ?? '',
```

Vue read-only (lignes 312-323) — ajouter après VILLE :
```tsx
<Field label="TYPE LOGEMENT" value={fieldOrDash(lead.typeLogement)} />
<Field label="REVENU FISCAL" value={lead.revenuFiscal != null ? lead.revenuFiscal.toLocaleString('fr-FR') : '—'} />
```

Vue édition (lignes 347-365) — ajouter après VILLE et avant STATUT :
```tsx
<EditableField label="TYPE LOGEMENT" value={form.typeLogement}
  onChange={(v) => setForm((f) => ({ ...f, typeLogement: v }))} />
<EditableField label="REVENU FISCAL" value={form.revenuFiscal}
  onChange={(v) => setForm((f) => ({ ...f, revenuFiscal: v }))}
  placeholder="ex: 25000" />
```

`save()` (lignes 270-299) — pour `revenuFiscal`, parser via `parseRevenuFiscal` (existe déjà ligne 1345) au lieu d'envoyer la string. Si parse throw, l'erreur est attrapée et affichée dans le bandeau d'erreur existant (`setError(e.message)`).

```ts
// Dans save(), avant la boucle Object.keys(form) :
let revenuFiscalParsed: number | null | undefined = undefined
if (form.revenuFiscal !== initial.revenuFiscal) {
  revenuFiscalParsed = parseRevenuFiscal(form.revenuFiscal)
}
// Dans la boucle, traitement spécial pour revenuFiscal :
if (key === 'revenuFiscal') {
  if (revenuFiscalParsed !== undefined) patch.revenuFiscal = revenuFiscalParsed
  continue
}
```

---

## Change 2 — Gestion users admin

### Backend

**Migration Drizzle** — ajouter une colonne nullable à `userInvitations` :

```ts
// db/schema.ts → table userInvitations
targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
```

Migration générée via `pnpm drizzle-kit generate` puis appliquée.

**`src/modules/users/dto/renew-user.dto.ts`** (nouveau fichier) :

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const renewUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  role: z.enum(['admin', 'setter', 'commercial', 'delivrabilite']).optional(),
  team: z.enum(['setting', 'closing', 'admin', 'delivrabilite']).optional().nullable(),
});

export class RenewUserDto extends createZodDto(renewUserSchema) {}
```

**`src/modules/users/users.service.ts`** — nouvelle méthode `renew()` :

```ts
async renew(id: string, dto: RenewUserDto, actorId: string | null) {
  const target = await this.findById(id);
  if (!target) throw new NotFoundException(`User ${id} introuvable`);

  const newEmail = dto.email?.trim().toLowerCase() ?? target.email;
  if (newEmail !== target.email) {
    const collision = await this.findByEmail(newEmail);
    if (collision && collision.id !== id) {
      throw new ConflictException(`Email ${newEmail} déjà utilisé`);
    }
  }

  const now = new Date();
  await this.db.update(users).set({
    email: newEmail,
    name: dto.name ?? target.name,
    phone: dto.phone !== undefined ? dto.phone : target.phone,
    role: dto.role ?? target.role,
    team: dto.team !== undefined ? dto.team : target.team,
    active: true,
    emailVerified: false,
    updatedAt: now,
  }).where(eq(users.id, id));

  // Reset better-auth credentials. Tables : account, session (schéma better-auth).
  await this.db.delete(account).where(eq(account.userId, id));
  await this.db.delete(session).where(eq(session.userId, id));

  // Révoque les invitations pending pour cet user
  await this.db.update(userInvitations)
    .set({ status: 'revoked', updatedAt: now })
    .where(and(
      eq(userInvitations.targetUserId, id),
      eq(userInvitations.status, 'pending'),
    ));

  // Génère la nouvelle invitation
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashInvitationToken(token);

  const [invitation] = await this.db.insert(userInvitations).values({
    email: newEmail,
    name: dto.name ?? target.name,
    phone: dto.phone !== undefined ? dto.phone : target.phone,
    role: dto.role ?? target.role,
    team: dto.team !== undefined ? dto.team : target.team,
    tokenHash,
    invitedById: actorId,
    expiresAt,
    targetUserId: id,
  }).returning();

  const inviteUrl = this.buildInviteUrl(token);
  const emailSent = await this.invitationMail.sendInvitation({
    to: newEmail,
    name: invitation.name,
    role: invitation.role,
    inviteUrl,
  });

  return { invitation, inviteUrl, emailSent };
}
```

**`src/modules/users/users.service.ts`** — `acceptInvitation()` modifié pour brancher sur `targetUserId` :

```ts
async acceptInvitation(dto: AcceptInvitationDto) {
  const tokenHash = hashInvitationToken(dto.token);
  const now = new Date();
  const [invitation] = await this.db.select().from(userInvitations)
    .where(eq(userInvitations.tokenHash, tokenHash)).limit(1);

  if (!invitation) throw new NotFoundException('Invitation introuvable');
  if (invitation.status !== 'pending') throw new BadRequestException('Invitation déjà utilisée ou annulée');
  if (invitation.expiresAt.getTime() < now.getTime()) {
    await this.db.update(userInvitations)
      .set({ status: 'expired', updatedAt: now })
      .where(eq(userInvitations.id, invitation.id));
    throw new BadRequestException('Invitation expirée');
  }

  // Cas renouvellement
  if (invitation.targetUserId) {
    const existing = await this.findById(invitation.targetUserId);
    if (!existing) throw new NotFoundException('Utilisateur cible introuvable');

    // Set password via better-auth. signUpEmail va créer la row `account`
    // pour cet email. Comme on a deleted les `account` rows précédentes dans
    // renew(), il n'y a pas de collision.
    await auth.api.signUpEmail({
      body: {
        email: existing.email,
        password: dto.password,
        name: existing.name,
      },
      asResponse: false,
    } as any);

    // signUpEmail crée potentiellement une 2e row `users`. On la merge avec
    // la ligne existante via UPDATE (l'email étant UNIQUE, la 2e row aura
    // un email différent ou aura été créée sur la même ligne).
    // → Point à valider en phase de recherche : tester le comportement
    // exact de better-auth signUpEmail quand une row users existe déjà
    // pour cet email.

    await this.db.update(users).set({
      emailVerified: true,
      active: true,
      updatedAt: now,
    }).where(eq(users.id, existing.id));

    await this.db.update(userInvitations).set({
      status: 'accepted',
      acceptedUserId: existing.id,
      acceptedAt: now,
      updatedAt: now,
    }).where(eq(userInvitations.id, invitation.id));

    return existing;
  }

  // Cas invitation classique (code actuel inchangé)
  // [...]
}
```

**Point de recherche flaggé** : le comportement de `auth.api.signUpEmail` quand une row `users` existe déjà avec cet email doit être validé. Trois scénarios à tester en phase de plan :
1. Better-auth UPSERT et réutilise la row existante → cas idéal.
2. Better-auth INSERT et crash sur UNIQUE constraint email → on devra utiliser une API interne (`createAccount` ou équivalent).
3. Better-auth crée une nouvelle row avec email modifié → on devra merger manuellement.

Le `gsd-phase-researcher` devra prouver lequel des trois via un test isolé.

**`src/modules/users/users.controller.ts`** — nouvel endpoint :

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
  return {
    user: toUserResponse(refreshed!),
    inviteUrl,
    emailSent,
  };
}
```

`DELETE /users/:id` existe déjà → réutilisé tel quel.

### Frontend

**`src/components/UserEditModal.tsx`** (nouveau fichier) :

Composant qui prend `{ user: UserResponse; pendingInvitation: InvitationResponse | null; onClose: () => void; onChanged: () => void }`.

Trois sections internes :
1. **Statut compte** — badge calculé client-side :
   - `user.lastLoginAt != null` → "✓ Compte complet"
   - `pendingInvitation != null` → "⏳ En attente d'invitation"
   - sinon → "⚠️ Importé Airtable, jamais activé"
2. **Formulaire d'édition** — champs nom, email, téléphone, rôle, team. Bouton "Enregistrer" → `updateUser(id, dto)` → toast + `onChanged()`.
3. **Zone dangereuse** — deux blocs séparés :
   - Bouton "Renouveler le compte" → confirm inline → POST `/users/:id/renew` (envoie les champs édités si modifiés) → bascule la vue du modal en mode "résultat" affichant : statut email envoyé + lien `inviteUrl` avec bouton Copier + bouton "Fermer".
   - Bouton "Supprimer l'utilisateur" → confirm inline → `deleteUser(id)` → toast + close + `onChanged()`.

**`src/pages/Settings.tsx`** — modifications :

- Ajouter state `const [editingUser, setEditingUser] = useState<UserResponse | null>(null)`.
- Construire `const pendingInvitationByUserId = useMemo(() => new Map<string, InvitationResponse>(), [invitations])` qui mappe `invitation.acceptedUserId` ou (mieux pour le cas renouvellement) `invitation.targetUserId` → invitation pending. On a besoin que `InvitationResponse` expose `targetUserId` — ajouter ce champ au DTO de réponse côté backend.
- `UserRow` reçoit `onEdit={() => setEditingUser(user)}`.
- Si `editingUser != null`, rendre `<UserEditModal user={editingUser} pendingInvitation={pendingInvitationByUserId.get(editingUser.id) ?? null} onClose={() => setEditingUser(null)} onChanged={() => { refetchUsers(); refetchInvitations(); }} />`.

**`src/lib/hooks.ts`** — nouvelles fonctions :

```ts
export type RenewUserPayload = {
  email?: string
  name?: string
  phone?: string | null
  role?: Role
  team?: Team
}

export async function renewUser(id: string, dto: RenewUserPayload):
  Promise<{ user: UserResponse; inviteUrl: string; emailSent: boolean }> {
  return apiPost(`/users/${id}/renew`, dto)
}

export async function deleteUser(id: string): Promise<{ ok: true }> {
  return apiDelete(`/users/${id}`)
}

export async function updateUser(id: string, dto: UpdateUserPayload): Promise<UserResponse> {
  return apiPatch(`/users/${id}`, dto)
}
```

**`src/lib/types.ts`** — étendre `InvitationResponse` avec `targetUserId: string | null`.

---

## Tests

### Backend

**Nouveaux tests `users.service.spec.ts`** :
- `renew()` user inexistant → throws `NotFoundException`.
- `renew()` avec email déjà pris par un autre user → throws `ConflictException`.
- `renew()` succès : crée invitation avec `targetUserId` set, révoque les invitations pending existantes pour ce user, supprime les rows `account` et `session`.
- `acceptInvitation()` avec `invitation.targetUserId` set : ne crée pas de nouvelle row `users`, set le password, marque invitation accepted.
- `acceptInvitation()` sans `targetUserId` : comportement inchangé.

**Tests `leads.service.spec.ts`** :
- Retirer les tests `ALLOWED_TRANSITIONS`.
- Garder les autres tests existants.

**Tests `leads.controller.spec.ts`** :
- Ajouter : "setter peut PATCH revenuFiscal et typeLogement sur un lead → 200".
- Ajouter : "setter peut faire n'importe quelle transition de statut → 200".

### Frontend

Validation manuelle (UAT) :
1. **Setter modifie un lead** : se logger en setter, ouvrir un lead, cliquer Modifier, saisir 32000 dans Revenu fiscal, Enregistrer → vérifier persistence en DB et que la valeur s'affiche en read-only.
2. **Setter change statut** : passer un lead de `signe` à `nouveau` en tant que setter → succès (avant la PR cela était bloqué).
3. **Admin renouvelle un user Airtable** : se logger admin, ouvrir Settings, cliquer Modifier sur un user importé jamais activé, cliquer "Renouveler le compte" → récupérer le lien, l'ouvrir en navigation privée, saisir un mot de passe, vérifier login OK avec ce mot de passe.
4. **Persistence FK** : avant renouvellement, noter le nombre de leads assignés à ce user. Après renouvellement, vérifier que `user.id` n'a pas changé et que la liste de leads assignés est identique.
5. **Admin supprime un user** : confirmer la suppression, vérifier que le user disparaît de la liste mais que les leads/RDV historiques restent (la requête `GET /leads` doit toujours afficher le nom du setter via `userMap` même si le user est soft-deleted — à valider).

---

## Risques et points ouverts

1. **Comportement `auth.api.signUpEmail` sur user existant** : voir point de recherche flaggé section backend. Si le résultat est "Better-auth crash sur UNIQUE constraint", il faudra utiliser une API alternative (à investiguer : `auth.api.setPassword`, ou écriture directe dans la table `account` better-auth).

2. **`userMap` côté frontend après suppression** : si on soft-delete un user, le `GET /users` actuel filtre `deletedAt IS NULL`, donc le `userMap` dans le sidebar lead ne contiendra plus ce user et les noms des setters/commerciaux supprimés s'afficheront vides. Décision : OK pour l'instant (acceptable). À revisiter si UX gênant.

3. **Email change + renouvellement combiné** : si l'admin change l'email ET renouvelle simultanément, le `signUpEmail` au moment de l'acceptation utilisera le **nouvel** email. C'est cohérent mais il faut s'assurer que la verification ordre des UPDATE est correcte (UPDATE users.email AVANT delete account rows).

4. **Race condition theoretical** : entre `findById(targetUserId)` et `signUpEmail` dans `acceptInvitation`, un admin pourrait soft-delete l'user. Acceptable : `signUpEmail` échouera et l'invitation restera pending. Pas de cas critique en pratique.

## Critères de succès

- [ ] Setter peut sauvegarder `revenuFiscal` et `typeLogement` depuis le sidebar lead.
- [ ] Setter peut faire toutes les transitions de statut sans erreur backend.
- [ ] Admin peut ouvrir un popup sur n'importe quel user depuis Settings.
- [ ] Admin peut éditer nom/email/téléphone/rôle/team et sauvegarder.
- [ ] Admin peut cliquer "Renouveler le compte" et obtenir un lien fonctionnel.
- [ ] L'user clique sur ce lien, set un password, et se connecte avec son `user.id` historique inchangé.
- [ ] Les leads et RDV de ce user restent assignés à `user.id` après renouvellement.
- [ ] Admin peut soft-delete un user avec confirmation.
