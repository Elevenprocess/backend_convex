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

  it("refus : nom vide, fin avant début ; sans tag ni statut = lien webhook seul", async () => {
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    const as = asUser(t, admin);
    await expect(as.mutation(api.promotions.create, { ...BASE, name: " " })).rejects.toThrow(/nom/i);
    await expect(as.mutation(api.promotions.create, { ...BASE, startDay: "2026-11-30" })).rejects.toThrow(/fin/i);
    const id = await as.mutation(api.promotions.create, { ...BASE, tag: undefined });
    const promo = await t.run((ctx) => ctx.db.get(id));
    expect(promo?.webhookKey).toMatch(/^[0-9a-f]{32}$/);
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

  it("update : un champ vidé disparaît, l'activité est journalisée", async () => {
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    const as = asUser(t, admin);
    const id = await as.mutation(api.promotions.create, BASE);
    await as.mutation(api.promotions.update, { id, ...BASE, offer: "" });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.offer).toBeUndefined();
    expect(row?.createdBy).toBe(admin);
    const logs = await t.run((ctx) => ctx.db.query("activityLog").collect());
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["promotion.created", "promotion.updated"]));
  });
});
