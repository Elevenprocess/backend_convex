import { expect, test } from "vitest";
import { makeT } from "../test.kit";
import { isJalonReached, clientStatusGlobal } from "./delivrabiliteSeam";

test("signature toujours atteint", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    expect(await isJalonReached(ctx, { jalonKey: "signature" })).toBe(true);
  });
});

test("autres jalons non atteints (stub)", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    expect(await isJalonReached(ctx, { jalonKey: "vt_validee" })).toBe(false);
    expect(await isJalonReached(ctx, { jalonKey: "install_effectuee" })).toBe(false);
  });
});

test("clientStatusGlobal null (clients absente)", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    expect(await clientStatusGlobal(ctx, {})).toBeNull();
  });
});
