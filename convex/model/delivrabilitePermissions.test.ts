import { expect, test } from "vitest";
import { makeT } from "../test.kit";
import { normalizeRole, can, canEditStep, visibleClientIds } from "./delivrabilitePermissions";

test("normalizeRole : delivrabilite deprecated → responsable_technique, hors module → null", () => {
  expect(normalizeRole("delivrabilite")).toBe("responsable_technique");
  expect(normalizeRole("responsable_technique")).toBe("responsable_technique");
  expect(normalizeRole("back_office")).toBe("back_office");
  expect(normalizeRole("admin")).toBe("admin");
  expect(normalizeRole("technicien")).toBe("technicien");
  expect(normalizeRole("commercial")).toBe("commercial");
  expect(normalizeRole("commercial_lead")).toBe("commercial");
  expect(normalizeRole("setter")).toBeNull();
  expect(normalizeRole("finances")).toBeNull();
});

test("can : rôles module full write, commercial view seul, technicien terrain", () => {
  for (const r of ["admin", "responsable_technique", "back_office", "delivrabilite"]) {
    for (const a of ["view", "edit", "assign", "resolve_problem", "cancel_sale"] as const) {
      expect(can(r, a, "dp")).toBe(true);
    }
  }
  expect(can("commercial", "view")).toBe(true);
  expect(can("commercial", "edit", "vt")).toBe(false);
  expect(can("technicien", "view")).toBe(true);
  expect(can("technicien", "edit", "vt")).toBe(true);
  expect(can("technicien", "edit", "installation")).toBe(true);
  expect(can("technicien", "edit", "dp")).toBe(false);
  expect(can("technicien", "edit")).toBe(false); // sans phase
  expect(can("technicien", "assign")).toBe(false);
  expect(can("technicien", "resolve_problem", "vt")).toBe(false);
  expect(can("technicien", "cancel_sale")).toBe(false);
  expect(can("setter", "view")).toBe(false);
});

test("canEditStep : scope technicien = technicienVtId du dossier", () => {
  const tech = { _id: "u1" as any, role: "technicien" };
  expect(canEditStep(tech, { phase: "vt", clientTechnicienVtId: "u1" as any })).toBe(true);
  expect(canEditStep(tech, { phase: "vt", clientTechnicienVtId: "u2" as any })).toBe(false);
  expect(canEditStep(tech, { phase: "vt", clientTechnicienVtId: null })).toBe(false);
  const bo = { _id: "u9" as any, role: "back_office" };
  expect(canEditStep(bo, { phase: "dp", clientTechnicienVtId: null })).toBe(true);
});

test("visibleClientIds : technicien scopé, commercial scopé à ses leads, autres null", async () => {
  const t = makeT();
  const ids = await t.run(async (ctx: any) => {
    const techId = await ctx.db.insert("users", { email: "t@e.fr", name: "T", role: "technicien", active: true });
    const comId = await ctx.db.insert("users", { email: "c@e.fr", name: "C", role: "commercial", active: true });
    const lead1 = await ctx.db.insert("leads", { source: "manual", status: "signe", assignedToId: comId });
    const lead2 = await ctx.db.insert("leads", { source: "manual", status: "signe" });
    const c1 = await ctx.db.insert("clients", { leadId: lead1, technicienVtId: techId, statusGlobal: "vt_a_faire", currentPhase: "vt", blocked: false });
    const c2 = await ctx.db.insert("clients", { leadId: lead2, statusGlobal: "vt_a_faire", currentPhase: "vt", blocked: false });
    return { techId, comId, c1, c2 };
  });
  await t.run(async (ctx: any) => {
    const tech = await ctx.db.get(ids.techId);
    const setTech = await visibleClientIds(ctx, tech);
    expect(setTech).not.toBeNull();
    expect([...setTech!]).toEqual([ids.c1]);

    const com = await ctx.db.get(ids.comId);
    const setCom = await visibleClientIds(ctx, com);
    expect([...setCom!]).toEqual([ids.c1]);

    const admin = await ctx.db.insert("users", { email: "a@e.fr", name: "A", role: "admin", active: true });
    expect(await visibleClientIds(ctx, (await ctx.db.get(admin))!)).toBeNull();
    const cl = await ctx.db.insert("users", { email: "cl@e.fr", name: "CL", role: "commercial_lead", active: true });
    expect(await visibleClientIds(ctx, (await ctx.db.get(cl))!)).toBeNull();
  });
});
