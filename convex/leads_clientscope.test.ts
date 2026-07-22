import { expect, test } from "vitest";
import { makeT } from "./test.kit";
import { api } from "./_generated/api";
import { asUser, insertUser } from "./test.helpers";

// scope=clients (page Clients) — port du legacy NestJS : chemin positif RDV
// planifié → devis (stage exact), filet de secours pour les leads sans stage.

async function seed(t: ReturnType<typeof makeT>) {
  const adminId = await insertUser(t, { role: "admin" });
  const mk = (fields: Record<string, unknown>) =>
    t.run(async (ctx) =>
      ctx.db.insert("leads", { source: "ghl", status: "nouveau", createdAt: Date.now(), ...fields } as any),
    );
  return { adminId, mk };
}

async function clientPage(t: ReturnType<typeof makeT>, adminId: any) {
  const res = await asUser(t, adminId).query(api.leads.listEnriched, {
    scope: "clients",
    now: Date.now(),
    paginationOpts: { numItems: 50, cursor: null },
  });
  return res.page.map((l: any) => l.firstName);
}

test("scope=clients : stages du chemin positif inclus, hors-chemin exclus", async () => {
  const t = makeT();
  const { adminId, mk } = await seed(t);
  await mk({ firstName: "Planifie", status: "rdv_pris", ghlStageName: "5. RDV Planifié 📅" });
  await mk({ firstName: "Signe", status: "signe", ghlStageName: "11. Devis Signé ✍️" });
  await mk({ firstName: "DevisPerdu", status: "perdu", ghlStageName: "12. Devis Perdu 💔" });
  await mk({ firstName: "NoShow", status: "perdu", ghlStageName: "🙅‍♂️ (BIS) No-Show" });
  await mk({ firstName: "Nouveau", status: "nouveau", ghlStageName: "0. Nouveaux Prospects 🌱" });
  await mk({ firstName: "Relance", status: "perdu", ghlStageName: "9. Relance Long Terme ⏳" });

  const names = await clientPage(t, adminId);
  expect(names).toContain("Planifie");
  expect(names).toContain("Signe");
  expect(names).toContain("DevisPerdu");
  expect(names).not.toContain("NoShow");
  expect(names).not.toContain("Nouveau");
  expect(names).not.toContain("Relance");
});

test("scope=clients : filets de secours pour les leads sans stage GHL", async () => {
  const t = makeT();
  const { adminId, mk } = await seed(t);
  // Lead manuel au statut visible → inclus.
  await mk({ firstName: "ManuelSigne", source: "manual", status: "signe" });
  // Lead sans stage avec un RDV → inclus même si le statut n'a pas suivi.
  const avecRdv = await mk({ firstName: "AvecRdv", status: "qualifie" });
  await t.run(async (ctx) =>
    ctx.db.insert("rdv", { leadId: avecRdv, locationType: "domicile", status: "planifie", scheduledAt: Date.now(), createdAt: Date.now() } as any),
  );
  // Lead sans stage, sans RDV ni devis, statut setter → exclu.
  await mk({ firstName: "SansRien", status: "a_rappeler" });

  const names = await clientPage(t, adminId);
  expect(names).toContain("ManuelSigne");
  expect(names).toContain("AvecRdv");
  expect(names).not.toContain("SansRien");
});
