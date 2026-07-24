import { describe, expect, it } from "vitest";
import { signDebriefToken, verifyDebriefToken } from "./debriefLinkToken";

const SECRET = "s3cr3t-de-test";
const RDV = "k5700abcdef0123456789xyz"; // Id Convex opaque (non-UUID)

describe("token débrief (Web Crypto)", () => {
  it("round-trip permanent : verify rend le rdvId, exp 0", async () => {
    const token = await signDebriefToken(RDV, SECRET);
    expect(token.split(".")).toHaveLength(2);
    expect(await verifyDebriefToken(token, SECRET)).toEqual({ rdvId: RDV, exp: 0 });
  });

  it("signature altérée → null", async () => {
    const token = await signDebriefToken(RDV, SECRET);
    const [body, sig] = token.split(".");
    const flipped = sig[0] === "A" ? "B" + sig.slice(1) : "A" + sig.slice(1);
    expect(await verifyDebriefToken(`${body}.${flipped}`, SECRET)).toBeNull();
  });

  it("mauvais secret → null", async () => {
    const token = await signDebriefToken(RDV, SECRET);
    expect(await verifyDebriefToken(token, "autre-secret")).toBeNull();
  });

  it("TTL positif expiré → null ; non expiré → ok", async () => {
    const base = Date.parse("2026-07-06T00:00:00Z");
    const token = await signDebriefToken(RDV, SECRET, { ttlDays: 1, nowMs: base });
    expect(await verifyDebriefToken(token, SECRET, { nowMs: base + 2 * 86_400_000 })).toBeNull();
    const still = await verifyDebriefToken(token, SECRET, { nowMs: base + 3_600_000 });
    expect(still?.rdvId).toBe(RDV);
    expect(still?.exp).toBeGreaterThan(0);
  });

  it("permanent jamais expiré même loin dans le futur", async () => {
    const token = await signDebriefToken(RDV, SECRET);
    expect(await verifyDebriefToken(token, SECRET, { nowMs: 4_102_444_800_000 })).toEqual({ rdvId: RDV, exp: 0 });
  });

  it("ponctuation finale tolérée (« token. » écrit par l'agent VPS)", async () => {
    const token = await signDebriefToken(RDV, SECRET);
    expect(await verifyDebriefToken(`${token}.`, SECRET)).toEqual({ rdvId: RDV, exp: 0 });
    expect(await verifyDebriefToken(`${token}...`, SECRET)).toEqual({ rdvId: RDV, exp: 0 });
    expect(await verifyDebriefToken(` ${token}. \n`, SECRET)).toEqual({ rdvId: RDV, exp: 0 });
  });

  it("malformé / secret vide → null ; sign sans secret → lève", async () => {
    expect(await verifyDebriefToken("pas-de-point", SECRET)).toBeNull();
    expect(await verifyDebriefToken("aaa.bbb", SECRET)).toBeNull();
    expect(await verifyDebriefToken("", SECRET)).toBeNull();
    const token = await signDebriefToken(RDV, SECRET);
    expect(await verifyDebriefToken(token, "")).toBeNull();
    await expect(signDebriefToken(RDV, "")).rejects.toThrow();
    await expect(signDebriefToken("", SECRET)).rejects.toThrow();
  });
});
