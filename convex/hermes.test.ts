import { afterEach, expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { insertUser } from "./test.helpers";

const NOW = Date.UTC(2026, 6, 3, 12, 0);
const T = Date.UTC(2026, 6, 2, 8, 0);

afterEach(() => {
  delete process.env.HERMES_API_KEY;
});

async function seed(t: ReturnType<typeof makeT>) {
  const setterId = await insertUser(t, { role: "setter", email: "s@e.fr", name: "Setter Un" });
  const comId = await insertUser(t, { role: "commercial", email: "c@e.fr", name: "Com Un" });
  await t.run(async (ctx: any) => {
    const leadId = await ctx.db.insert("leads", {
      source: "manual",
      status: "signe",
      firstName: "Léa",
      lastName: "Martin",
      city: "Pau",
      setterId,
      lastContactAt: T,
    });
    await ctx.db.insert("callLogs", { leadId, setterId, calledAt: T, result: "joint" });
    await ctx.db.insert("rdv", {
      leadId,
      commercialId: comId,
      scheduledAt: T,
      locationType: "domicile",
      status: "honore",
      result: "signe",
      montantTotal: 12000,
    });
    await ctx.db.insert("rdv", {
      leadId,
      scheduledAt: T,
      locationType: "domicile",
      status: "annule",
      deletedAt: NOW,
    });
  });
}

test("kpis refuse sans HERMES_API_KEY configurée (fail-closed)", async () => {
  const t = makeT();
  await expect(
    t.query(api.hermes.kpis, { apiKey: "x", now: NOW }),
  ).rejects.toThrow("HERMES_API_KEY non configuré");
});

test("kpis refuse une clé invalide", async () => {
  process.env.HERMES_API_KEY = "bonne-cle";
  const t = makeT();
  await expect(
    t.query(api.hermes.kpis, { apiKey: "mauvaise", now: NOW }),
  ).rejects.toThrow("Clé Hermes invalide");
});

test("kpis renvoie la vue admin sans utilisateur connecté", async () => {
  process.env.HERMES_API_KEY = "bonne-cle";
  const t = makeT();
  await seed(t);
  const out = await t.query(api.hermes.kpis, { apiKey: "bonne-cle", now: NOW, days: 30 });
  expect(out.engine).toBe("hermes-service");
  expect(out.range.days).toBe(30);
  expect(out.admin).not.toBeNull();
});

test("kpis renvoie les mêmes agrégats que analytics.summary admin", async () => {
  process.env.HERMES_API_KEY = "bonne-cle";
  const t = makeT();
  await seed(t);
  const adminId = await insertUser(t, { role: "admin", email: "a@e.fr" });
  const { asUser } = await import("./test.helpers");
  const ref = await asUser(t, adminId).query(api.analytics.summary, { now: NOW, days: 30 });
  const out = await t.query(api.hermes.kpis, { apiKey: "bonne-cle", now: NOW, days: 30 });
  expect(out.admin).toEqual(ref.admin);
});

test("rdvList liste les RDV avec résumé lead, hors supprimés", async () => {
  process.env.HERMES_API_KEY = "bonne-cle";
  const t = makeT();
  await seed(t);
  const rows = await t.query(api.hermes.rdvList, { apiKey: "bonne-cle" });
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("honore");
  expect(rows[0].montantTotal).toBe(12000);
  expect(rows[0].lead?.firstName).toBe("Léa");
});

test("rdvList filtre par statut et refuse sans clé", async () => {
  process.env.HERMES_API_KEY = "bonne-cle";
  const t = makeT();
  await seed(t);
  const none = await t.query(api.hermes.rdvList, { apiKey: "bonne-cle", status: "planifie" });
  expect(none).toHaveLength(0);
  await expect(t.query(api.hermes.rdvList, { apiKey: "nope" })).rejects.toThrow("Clé Hermes invalide");
});
