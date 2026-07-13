import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function seed(t: ReturnType<typeof makeT>) {
  const eric = await insertUser(t, { role: "setter", name: "Eric", email: "eric@ecoi.fr" });
  const ony = await insertUser(t, { role: "setter", name: "Ony", email: "ony@ecoi.fr" });
  const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "manual", status: "nouveau" } as never));
  return { eric, ony, leadId };
}

describe("leadPresence", () => {
  it("touch → visible dans list avec le nom du setter ; release → disparaît", async () => {
    const t = makeT();
    const { eric, ony, leadId } = await seed(t);

    await asUser(t, eric).mutation(api.leadPresence.touch, { leadId });
    const seenByOny = await asUser(t, ony).query(api.leadPresence.list, {});
    expect(seenByOny).toHaveLength(1);
    expect(seenByOny[0]).toMatchObject({ leadId, userId: eric, userName: "Eric" });

    await asUser(t, eric).mutation(api.leadPresence.release, {});
    expect(await asUser(t, ony).query(api.leadPresence.list, {})).toHaveLength(0);
  });

  it("une seule ligne par utilisateur : changer de lead déplace le verrou", async () => {
    const t = makeT();
    const { eric, ony, leadId } = await seed(t);
    const lead2 = await t.run((ctx) => ctx.db.insert("leads", { source: "manual", status: "nouveau" } as never));

    await asUser(t, eric).mutation(api.leadPresence.touch, { leadId });
    await asUser(t, eric).mutation(api.leadPresence.touch, { leadId: lead2 });
    const locks = await asUser(t, ony).query(api.leadPresence.list, {});
    expect(locks).toHaveLength(1);
    expect(locks[0].leadId).toBe(lead2);
  });

  it("verrou expiré (TTL dépassé) → filtré de list et purgé par touch", async () => {
    const t = makeT();
    const { eric, ony, leadId } = await seed(t);
    // Ligne expirée insérée directement (simule un onglet crashé il y a > 60 s).
    await t.run((ctx) =>
      ctx.db.insert("leadPresence", {
        leadId, userId: ony, userName: "Ony", startedAt: Date.now() - 120_000, expiresAt: Date.now() - 60_000,
      } as never),
    );
    expect(await asUser(t, eric).query(api.leadPresence.list, {})).toHaveLength(0);
    // Le prochain touch nettoie la ligne morte.
    await asUser(t, eric).mutation(api.leadPresence.touch, { leadId });
    const rows = await t.run((ctx) => ctx.db.query("leadPresence").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(eric);
  });
});
