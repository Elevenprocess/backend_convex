import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

// Toutes les dates « récentes » tombent dans la fenêtre courte (lecture par index)
// ET dans la fenêtre longue (scan) ; « OLD » reste hors des deux. Les deux chemins
// doivent donc rendre exactement les mêmes chiffres.
const NOW = Date.now();
const DAY = 86_400_000;
const OLD = NOW - 200 * DAY;
const SHORT = { from: new Date(NOW - DAY).toISOString(), to: new Date(NOW + DAY).toISOString() };
const LONG = { from: new Date(NOW - 45 * DAY).toISOString(), to: new Date(NOW + 45 * DAY).toISOString() };

async function seed(t: ReturnType<typeof makeT>) {
  const adminId = await insertUser(t, { role: "admin" });
  const setterId = await insertUser(t, { role: "setter", email: "s@e.fr", name: "Setter Un" });
  const comId = await insertUser(t, { role: "commercial", email: "c@e.fr", name: "Com" });
  await t.run(async (ctx: any) => {
    const lead = (extra: Record<string, unknown>) =>
      ctx.db.insert("leads", { source: "ghl", status: "nouveau", firstName: "L", createdAt: OLD, ...extra });
    const rdv = (leadId: unknown, extra: Record<string, unknown>) =>
      ctx.db.insert("rdv", { leadId, commercialId: comId, locationType: "domicile", status: "planifie", scheduledAt: NOW, ...extra });

    await lead({ createdAt: undefined }); // ligne live : date = _creationTime
    await lead({ createdAt: NOW, deletedAt: NOW }); // supprimé : jamais compté
    await lead({ status: "pas_de_reponse", lastContactAt: NOW, setterId }); // actif par lastContactAt
    const called = await lead({ status: "qualifie", setterId }); // actif par son appel seulement
    await ctx.db.insert("callLogs", { leadId: called, setterId, calledAt: NOW, result: "joint" });
    await lead({ status: "pas_de_reponse", lastContactAt: OLD }); // inactif : absent

    // Lead hors période, 1er RDV aujourd'hui : qualification créditée à son setter.
    await rdv(await lead({ status: "rdv_pris", setterId }), { createdAt: NOW });
    // 1er RDV ancien : le RDV du jour n'est pas une nouvelle qualification.
    const reprise = await lead({ status: "rdv_pris", setterId });
    await rdv(reprise, { createdAt: OLD, scheduledAt: OLD });
    await rdv(reprise, { createdAt: NOW });
    // RDV ancien mais planifié aujourd'hui : dans la période, pas une qualification.
    await rdv(await lead({ status: "rdv_pris" }), { createdAt: OLD, scheduledAt: NOW });
    // Import historique : exclu des qualifications.
    await rdv(await lead({ source: "airtable_migration", status: "signe" }), { createdAt: NOW });
    // RDV supprimé.
    await rdv(await lead({ status: "rdv_pris" }), { createdAt: NOW, deletedAt: NOW });
  });
  return { adminId, setterId };
}

const summaryOf = (t: ReturnType<typeof makeT>, adminId: any, range: { from: string; to: string }) =>
  asUser(t, adminId).query(api.analytics.summary, { now: NOW, ...range });
const funnelOf = (t: ReturnType<typeof makeT>, adminId: any, range: { from: string; to: string }) =>
  asUser(t, adminId).query(api.analytics.funnel, { now: NOW, ...range });

test("summary : les bons leads et RDV sont retenus sur une période courte", async () => {
  const t = makeT();
  const { adminId, setterId } = await seed(t);
  const { admin } = await summaryOf(t, adminId, SHORT);
  expect(admin!.newLeads).toBe(1); // ligne live seule
  expect(admin!.loggedCalls).toBe(1);
  expect(admin!.classified).toBe(2); // lastContactAt + appel
  expect(admin!.qualified).toBe(1); // le seul 1er RDV du jour
  expect(admin!.scheduledRdv).toBe(4); // supprimé et RDV ancien exclus
  const row = admin!.setters.find((r: any) => r.id === setterId)!;
  expect(row.qualified).toBe(1);
  expect(row.calls).toBe(1);
});

test("summary et funnel : lecture par index et scan complet donnent les mêmes chiffres", async () => {
  const t = makeT();
  const { adminId } = await seed(t);
  const strip = ({ generatedAt: _g, range: _r, days: _d, ...rest }: any) => rest;
  const series = ({ dailyEvolution: _e, hourlyCalls: _h, ...rest }: any) => rest;
  const short = await summaryOf(t, adminId, SHORT);
  const long = await summaryOf(t, adminId, LONG);
  expect(series(long.admin)).toEqual(series(short.admin));
  const fShort = strip(await funnelOf(t, adminId, SHORT));
  const fLong = strip(await funnelOf(t, adminId, LONG));
  expect(fLong.totals).toEqual(fShort.totals);
  expect(fLong.sectors).toEqual(fShort.sectors);
  expect(fLong.setterComparison).toEqual(fShort.setterComparison);
});
