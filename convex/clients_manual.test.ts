import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

describe("clients.createManualDossier", () => {
  it("crée lead(manual/signe) + projet + dossier, retourne l'id dossier", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const clientId = await asUser(t, adminId).mutation(api.clients.createManualDossier, {
      firstName: "Marie", lastName: "Hoarau", phone: "0692123456", city: "Saint-Denis",
      montantTotal: 21000, typeFinancement: "comptant", signedAt: 5000,
    });
    const client = await t.run((ctx) => ctx.db.get(clientId));
    expect(client).toMatchObject({ statusGlobal: expect.any(String), montantTotal: 21000, typeFinancement: "comptant" });
    const lead = await t.run((ctx) => ctx.db.get(client!.leadId));
    expect(lead).toMatchObject({ source: "manual", status: "signe", firstName: "Marie", lastName: "Hoarau" });
    const project = await t.run((ctx) => ctx.db.get(client!.projectId!));
    expect(project).toMatchObject({ commercialId: adminId, status: "signe", name: "Projet Marie Hoarau" });
  });

  it("anti-doublon téléphone (9 derniers chiffres) et email → throw", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "qualifie", phone: "+262692123456" }));
    await expect(asUser(t, adminId).mutation(api.clients.createManualDossier, {
      firstName: "A", lastName: "B", phone: "0692123456",
    })).rejects.toThrow();
    await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "qualifie", email: "Dup@Mail.RE" }));
    await expect(asUser(t, adminId).mutation(api.clients.createManualDossier, {
      firstName: "A", lastName: "B", email: "dup@mail.re",
    })).rejects.toThrow();
  });

  it("rôle non autorisé (setter) → refus", async () => {
    const t = makeT();
    const setterId = await insertUser(t, { role: "setter" });
    await expect(asUser(t, setterId).mutation(api.clients.createManualDossier, {
      firstName: "A", lastName: "B",
    })).rejects.toThrow();
  });
});
