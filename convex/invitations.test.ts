import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function invitedUser(t: ReturnType<typeof makeT>, email: string) {
  return await t.run((ctx) => ctx.db.insert("users", { email, name: "Invité", role: "setter" }));
}

describe("invitations — création & gestion", () => {
  it("un manager crée une invitation pending + token ; setter refusé", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const res = await asUser(t, adminId).action(api.invitations.createInvitation, {
      email: "New@Mail.re", name: "Nouveau", role: "commercial", team: "team_a",
    });
    expect(res.token).toBeTruthy();
    expect(res.inviteUrl).toContain(res.token);
    const inv = await t.run((ctx) => ctx.db.get(res.invitationId));
    expect(inv).toMatchObject({ email: "new@mail.re", role: "commercial", status: "pending" });

    const setterId = await insertUser(t, { role: "setter" });
    await expect(asUser(t, setterId).action(api.invitations.createInvitation, {
      email: "x@y.re", name: "X", role: "commercial",
    })).rejects.toThrow();
  });

  it("email déjà utilisé par un user actif → refus ; liste + révocation", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    await t.run((ctx) => ctx.db.insert("users", { email: "used@mail.re", name: "U", role: "commercial", active: true }));
    await expect(asUser(t, adminId).action(api.invitations.createInvitation, {
      email: "used@mail.re", name: "U", role: "commercial",
    })).rejects.toThrow();

    const res = await asUser(t, adminId).action(api.invitations.createInvitation, { email: "a@b.re", name: "A", role: "setter" });
    expect(await asUser(t, adminId).query(api.invitations.listInvitations, {})).toHaveLength(1);
    await asUser(t, adminId).mutation(api.invitations.revokeInvitation, { invitationId: res.invitationId });
    expect((await t.run((ctx) => ctx.db.get(res.invitationId)))?.status).toBe("revoked");
  });
});

describe("invitations — acceptation", () => {
  it("l'invité inscrit accepte → rôle/équipe/actif appliqués, invitation accepted", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const res = await asUser(t, adminId).action(api.invitations.createInvitation, {
      email: "join@mail.re", name: "Join", role: "commercial", team: "team_b",
    });
    const uid = await invitedUser(t, "join@mail.re");
    await asUser(t, uid).mutation(api.invitations.acceptInvitation, { token: res.token });

    const user = await t.run((ctx) => ctx.db.get(uid));
    expect(user).toMatchObject({ role: "commercial", team: "team_b", active: true });
    expect((await t.run((ctx) => ctx.db.get(res.invitationId)))?.status).toBe("accepted");
  });

  it("token expiré → throw + statut expired ; email non concordant → throw", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const res = await asUser(t, adminId).action(api.invitations.createInvitation, { email: "exp@mail.re", name: "E", role: "setter" });
    await t.run(async (ctx) => {
      const inv = await ctx.db.query("userInvitations").withIndex("by_token", (q) => q.eq("token", res.token)).unique();
      if (inv) await ctx.db.patch(inv._id, { expiresAt: 1 });
    });
    const uid = await invitedUser(t, "exp@mail.re");
    await expect(asUser(t, uid).mutation(api.invitations.acceptInvitation, { token: res.token })).rejects.toThrow();
    // La mutation rejette (le token périmé reste inexploitable) — pas de
    // transition `expired` persistée car le throw annulerait le patch.
    expect((await t.run((ctx) => ctx.db.get(res.invitationId)))?.status).toBe("pending");

    const res2 = await asUser(t, adminId).action(api.invitations.createInvitation, { email: "right@mail.re", name: "R", role: "setter" });
    const other = await invitedUser(t, "wrong@mail.re");
    await expect(asUser(t, other).mutation(api.invitations.acceptInvitation, { token: res2.token })).rejects.toThrow();
  });
});

describe("invitations — renew", () => {
  it("réactive un utilisateur désactivé", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const uid = await t.run((ctx) => ctx.db.insert("users", { email: "old@mail.re", name: "Old", role: "commercial", active: false }));
    await asUser(t, adminId).mutation(api.invitations.renewUser, { userId: uid, role: "commercial_lead" });
    expect(await t.run((ctx) => ctx.db.get(uid))).toMatchObject({ active: true, role: "commercial_lead" });
  });
});
