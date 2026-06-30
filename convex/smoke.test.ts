import { expect, test } from "vitest";
import { makeT } from "./test";

test("le harness convex-test démarre offline", async () => {
  const t = makeT();
  const result = await t.run(async () => 42);
  expect(result).toBe(42);
});
