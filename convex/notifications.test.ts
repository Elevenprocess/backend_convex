import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { createNotification } from "./model/notify";
import { insertAudit } from "./model/audit";

test("createNotification insère et listMine renvoie mes notifications (récentes d'abord)", async () => {
  const t = makeT();
  const uid = await insertUser(t, { role: "finances" });
  const otherId = await insertUser(t, { role: "admin", email: "a@e.fr" });
  await t.run(async (ctx: any) => {
    await createNotification(ctx, { userId: uid, type: "acompte_a_encaisser", title: "N1" });
    await createNotification(ctx, { userId: uid, type: "acompte_a_encaisser", title: "N2" });
    await createNotification(ctx, { userId: otherId, type: "x", title: "PAS À MOI" });
  });
  const mine = await asUser(t, uid).query(api.notifications.listMine, {});
  expect(mine.map((n: any) => n.title)).toEqual(["N2", "N1"]);
});

test("markRead scope propriétaire + unreadOnly", async () => {
  const t = makeT();
  const uid = await insertUser(t, { role: "finances" });
  const otherId = await insertUser(t, { role: "admin", email: "a@e.fr" });
  const nId = await t.run((ctx: any) =>
    createNotification(ctx, { userId: uid, type: "t", title: "N" }),
  );
  await expect(
    asUser(t, otherId).mutation(api.notifications.markRead, { notificationId: nId }),
  ).rejects.toThrow();
  await asUser(t, uid).mutation(api.notifications.markRead, { notificationId: nId });
  const unread = await asUser(t, uid).query(api.notifications.listMine, { unreadOnly: true });
  expect(unread).toHaveLength(0);
});

test("markAllRead marque tout", async () => {
  const t = makeT();
  const uid = await insertUser(t, { role: "finances" });
  await t.run(async (ctx: any) => {
    await createNotification(ctx, { userId: uid, type: "t", title: "N1" });
    await createNotification(ctx, { userId: uid, type: "t", title: "N2" });
  });
  await asUser(t, uid).mutation(api.notifications.markAllRead, {});
  const unread = await asUser(t, uid).query(api.notifications.listMine, { unreadOnly: true });
  expect(unread).toHaveLength(0);
  const all = await asUser(t, uid).query(api.notifications.listMine, {});
  expect(all).toHaveLength(2);
});

test("insertAudit écrit une ligne consultable", async () => {
  const t = makeT();
  const uid = await insertUser(t, { role: "admin" });
  await t.run((ctx: any) =>
    insertAudit(ctx, {
      userId: uid,
      action: "workflow_status_changed",
      entityType: "workflow_step",
      entityId: "abc",
      before: { status: "a_faire" },
      after: { status: "fait" },
    }),
  );
  const rows = await t.run((ctx: any) => ctx.db.query("auditLog").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].action).toBe("workflow_status_changed");
  expect(rows[0].before).toEqual({ status: "a_faire" });
});
