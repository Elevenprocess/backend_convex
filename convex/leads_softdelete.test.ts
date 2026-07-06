import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

describe("leads.softDelete", () => {
  it("admin supprime → deletedAt posé, exclu de get/list", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "manual", status: "nouveau", firstName: "Z" }));

    await asUser(t, adminId).mutation(api.leads.softDelete, { leadId });

    expect((await t.run((ctx) => ctx.db.get(leadId)))?.deletedAt).toBeGreaterThan(0);
    expect(await asUser(t, adminId).query(api.leads.get, { leadId })).toBeNull();
    const page = await asUser(t, adminId).query(api.leads.list, { paginationOpts: { numItems: 50, cursor: null } });
    expect(page.page.find((l) => l._id === leadId)).toBeUndefined();
  });

  it("non-admin refusé ; lead déjà supprimé → throw", async () => {
    const t = makeT();
    const setterId = await insertUser(t, { role: "setter" });
    const adminId = await insertUser(t, { role: "admin" });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "manual", status: "nouveau" }));
    await expect(asUser(t, setterId).mutation(api.leads.softDelete, { leadId })).rejects.toThrow();
    await asUser(t, adminId).mutation(api.leads.softDelete, { leadId });
    await expect(asUser(t, adminId).mutation(api.leads.softDelete, { leadId })).rejects.toThrow();
  });
});
