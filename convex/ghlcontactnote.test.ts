import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

describe("ghlContactNote", () => {
  it("noteData : contact GHL depuis externalId, texte du débrief, ghlUserId du commercial", async () => {
    const t = makeT();
    const comId = await insertUser(t, { role: "commercial" });
    await t.run((ctx) => ctx.db.patch(comId, { name: "Laurent C.", ghlUserId: "ghl-u1" }));
    const leadId = await t.run((ctx) =>
      ctx.db.insert("leads", { source: "ghl", externalId: "contact-123", status: "rdv_honore", firstName: "Jean" }),
    );
    const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
      leadId, outcome: "non_vente", nonSaleReason: "pas_interesse", notes: "Rappeler en 2027",
    });
    const data = await t.query(internal.ghlContactNote.noteData, { debriefId });
    expect(data).toMatchObject({ contactExternalId: "contact-123", ghlNoteId: null, ghlUserId: "ghl-u1" });
    expect(data?.body).toContain("Commercial : Laurent C.");
    expect(data?.body).toContain("Motif : Pas intéressé");
    expect(data?.body).toContain("Rappeler en 2027");
  });

  it("noteData : ghlContactId prime ; uuid Postgres seul → null (lead migré sans contact GHL)", async () => {
    const t = makeT();
    const comId = await insertUser(t, { role: "commercial" });
    const migrated = await t.run((ctx) =>
      ctx.db.insert("leads", { source: "ghl", externalId: "0f1e2d3c-4b5a-6978-8899-aabbccddeeff", status: "rdv_honore" }),
    );
    const d1 = await asUser(t, comId).mutation(api.debriefs.createForLead, { leadId: migrated, outcome: "en_reflexion" });
    expect(await t.query(internal.ghlContactNote.noteData, { debriefId: d1 })).toBeNull();
    await t.run((ctx) => ctx.db.patch(migrated, { ghlContactId: "ghl-c9" }));
    const d2 = await t.query(internal.ghlContactNote.noteData, { debriefId: d1 });
    expect(d2?.contactExternalId).toBe("ghl-c9");
  });

  it("pushDebriefNote : no-op (false) sans configuration GHL", async () => {
    const t = makeT();
    delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
    delete process.env.GHL_API_KEY;
    delete process.env.GHL_LOCATION_ID;
    const comId = await insertUser(t, { role: "commercial" });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", externalId: "c1", status: "rdv_honore" }));
    const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, { leadId, outcome: "vente", montantTotal: 1000, financingType: "comptant" });
    expect(await t.action(internal.ghlContactNote.pushDebriefNote, { debriefId })).toBe(false);
  });

  it("markPushed pose ghlNoteId + ghlNotePushedAt → la note suivante est marquée « mis à jour »", async () => {
    const t = makeT();
    const comId = await insertUser(t, { role: "commercial" });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", externalId: "c1", status: "rdv_honore" }));
    const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, { leadId, outcome: "en_reflexion" });
    await t.mutation(internal.ghlContactNote.markPushed, { debriefId, ghlNoteId: "n1", now: 42 });
    const d = await t.run((ctx) => ctx.db.get(debriefId));
    expect(d).toMatchObject({ ghlNoteId: "n1", ghlNotePushedAt: 42 });
    const data = await t.query(internal.ghlContactNote.noteData, { debriefId });
    expect(data).toMatchObject({ ghlNoteId: "n1" });
    expect(data?.body).toContain("(mis à jour)");
  });
});
