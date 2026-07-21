import { afterEach, expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { insertUser } from "./test.helpers";
import { verifyDebriefToken } from "./model/debriefLinkToken";

const NOW = Date.UTC(2026, 6, 21, 12, 0);
const HIER = NOW - 20 * 60 * 60 * 1000;

afterEach(() => {
  delete process.env.HERMES_API_KEY;
  delete process.env.DEBRIEF_LINK_SECRET;
  delete process.env.FRONTEND_URL;
});

function arm() {
  process.env.HERMES_API_KEY = "cle-hermes";
  process.env.DEBRIEF_LINK_SECRET = "secret-test";
}

async function seedRdv(
  t: ReturnType<typeof makeT>,
  fields: Record<string, unknown> = {},
  lead: Record<string, unknown> = {},
) {
  return await t.run(async (ctx: any) => {
    const comId =
      fields.commercialId ??
      (await ctx.db.insert("users", {
        email: "c@e.fr",
        name: "Com Un",
        role: "commercial",
        active: true,
        phone: "+262692000001",
      }));
    const leadId = await ctx.db.insert("leads", {
      source: "manual",
      status: "rdv_pris",
      firstName: "Léa",
      lastName: "Martin",
      city: "Saint-Pierre",
      ...lead,
    });
    const rdvId = await ctx.db.insert("rdv", {
      leadId,
      commercialId: comId,
      scheduledAt: HIER,
      locationType: "domicile",
      status: "honore",
      ...fields,
    });
    return { rdvId, comId, leadId };
  });
}

test("due refuse sans HERMES_API_KEY configurée (fail-closed)", async () => {
  const t = makeT();
  await expect(t.action(api.hermesDebrief.due, { apiKey: "x", now: NOW })).rejects.toThrow(
    "HERMES_API_KEY non configuré",
  );
});

test("due refuse une clé invalide", async () => {
  arm();
  const t = makeT();
  await expect(t.action(api.hermesDebrief.due, { apiKey: "mauvaise", now: NOW })).rejects.toThrow(
    "Clé Hermes invalide",
  );
});

test("due liste les RDV passés non débriefés avec lien magique et téléphone", async () => {
  arm();
  const t = makeT();
  const { rdvId } = await seedRdv(t);
  const rows = await t.action(api.hermesDebrief.due, { apiKey: "cle-hermes", now: NOW });
  expect(rows).toHaveLength(1);
  expect(rows[0].rdvId).toBe(rdvId);
  expect(rows[0].commercial).toMatchObject({ name: "Com Un", phone: "+262692000001" });
  expect(rows[0].lead).toMatchObject({ firstName: "Léa", city: "Saint-Pierre" });
  expect(rows[0].link).toContain("https://velora.electroconceptoi.com/#/debrief/");
  const token = decodeURIComponent(rows[0].link.split("/#/debrief/")[1]);
  const verified = await verifyDebriefToken(token, "secret-test");
  expect(verified?.rdvId).toBe(rdvId);
});

test("due exclut remplis, déjà notifiés, annulés/reportés, futurs et hors fenêtre", async () => {
  arm();
  const t = makeT();
  await seedRdv(t, { debriefFilledAt: NOW - 1 });
  await seedRdv(t, { debriefNotifiedAt: NOW - 1 });
  await seedRdv(t, { status: "annule" });
  await seedRdv(t, { status: "reporte" });
  await seedRdv(t, { scheduledAt: NOW + 86_400_000 });
  await seedRdv(t, { scheduledAt: NOW - 10 * 86_400_000 });
  const rows = await t.action(api.hermesDebrief.due, { apiKey: "cle-hermes", now: NOW });
  expect(rows).toHaveLength(0);
});

test("due exclut commercial inactif ou absent", async () => {
  arm();
  const t = makeT();
  const inactif = await insertUser(t, { role: "commercial", active: false });
  await seedRdv(t, { commercialId: inactif });
  await seedRdv(t, { commercialId: undefined });
  const rows = await t.action(api.hermesDebrief.due, { apiKey: "cle-hermes", now: NOW });
  expect(rows).toHaveLength(0);
});

test("markSent acquitte (anti-doublon) puis due ne rend plus le RDV", async () => {
  arm();
  const t = makeT();
  const { rdvId } = await seedRdv(t);
  await t.mutation(api.hermesDebrief.markSent, { apiKey: "cle-hermes", rdvId });
  const stamped = await t.run((ctx: any) => ctx.db.get(rdvId));
  expect(stamped.debriefNotifiedAt).toBeDefined();
  // Idempotent : le second acquittement ne re-stampe pas.
  await t.mutation(api.hermesDebrief.markSent, { apiKey: "cle-hermes", rdvId });
  const again = await t.run((ctx: any) => ctx.db.get(rdvId));
  expect(again.debriefNotifiedAt).toBe(stamped.debriefNotifiedAt);
  const rows = await t.action(api.hermesDebrief.due, { apiKey: "cle-hermes", now: NOW });
  expect(rows).toHaveLength(0);
});

test("markSent refuse une clé invalide", async () => {
  arm();
  const t = makeT();
  const { rdvId } = await seedRdv(t);
  await expect(t.mutation(api.hermesDebrief.markSent, { apiKey: "x", rdvId })).rejects.toThrow(
    "Clé Hermes invalide",
  );
});
