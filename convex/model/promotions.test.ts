// convex/model/promotions.test.ts
import { describe, expect, it } from "vitest";
import {
  isLegacyEligible, legacyRejectReason, matchPromotion, normalizeTag, parseGhlTags, parsePromotionSlot, formatPromotionSlot,
  promotionConflict, promotionStatus, reunionDayEndMs, reunionDayStartMs,
  type PromotionLike,
} from "./promotions";

const promo = (over: Partial<PromotionLike> = {}): PromotionLike => ({
  _id: "p1",
  tagKey: "black friday",
  startAt: reunionDayStartMs("2026-11-23"),
  endAt: reunionDayEndMs("2026-11-29"),
  archived: false,
  ...over,
});

describe("normalizeTag / parseGhlTags", () => {
  it("ignore casse, accents et espaces multiples", () => {
    expect(normalizeTag("  Black   FRIDAY ")).toBe("black friday");
    expect(normalizeTag("Présentiel")).toBe("presentiel");
  });
  it("accepte une chaîne à virgules ou un tableau, dédoublonne, retire les vides", () => {
    expect(parseGhlTags("simulateur, présentiel,,Simulateur")).toEqual(["simulateur", "présentiel"]);
    expect(parseGhlTags(["a", " ", "b", 3])).toEqual(["a", "b"]);
    expect(parseGhlTags(undefined)).toEqual([]);
    expect(parseGhlTags(null)).toEqual([]);
  });
});

describe("dates Réunion", () => {
  it("minuit Réunion = 20:00 UTC la veille", () => {
    expect(new Date(reunionDayStartMs("2026-11-23")).toISOString()).toBe("2026-11-22T20:00:00.000Z");
    expect(new Date(reunionDayEndMs("2026-11-29")).toISOString()).toBe("2026-11-29T19:59:59.999Z");
  });
  it("refuse un format invalide", () => {
    expect(() => reunionDayStartMs("23/11/2026")).toThrow("Date invalide");
  });
});

describe("promotionStatus", () => {
  const p = promo();
  it("bornes incluses", () => {
    expect(promotionStatus(p, p.startAt - 1)).toBe("a_venir");
    expect(promotionStatus(p, p.startAt)).toBe("en_cours");
    expect(promotionStatus(p, p.endAt)).toBe("en_cours");
    expect(promotionStatus(p, p.endAt + 1)).toBe("terminee");
  });
  it("archivée = terminée", () => {
    expect(promotionStatus({ ...p, archived: true }, p.startAt + 1)).toBe("terminee");
  });
});

describe("matchPromotion", () => {
  const p = promo();
  it("trouve la promo par tag normalisé pendant la période", () => {
    expect(matchPromotion(["Simulateur", "BLACK Friday"], [p], p.startAt + 1000)?._id).toBe("p1");
  });
  it("rien hors période ni si archivée ni sans tag", () => {
    expect(matchPromotion(["black friday"], [p], p.startAt - 1)).toBeUndefined();
    expect(matchPromotion(["black friday"], [p], p.endAt + 1)).toBeUndefined();
    expect(matchPromotion(["black friday"], [{ ...p, archived: true }], p.startAt + 1)).toBeUndefined();
    expect(matchPromotion(["black friday"], [{ ...p, tagKey: undefined }], p.startAt + 1)).toBeUndefined();
  });
  it("prend la promo commencée le plus tard si plusieurs", () => {
    const p2 = { ...p, _id: "p2", startAt: p.startAt + 10 };
    expect(matchPromotion(["black friday"], [p, p2], p.startAt + 100)?._id).toBe("p2");
  });
});

describe("promotionConflict", () => {
  const a = promo();
  it("même tag sur période qui chevauche = conflit", () => {
    expect(promotionConflict({ ...a, _id: "new" }, [a])).toMatch(/tag/);
  });
  it("même tag sans chevauchement = ok ; archivée ignorée ; soi-même ignoré", () => {
    const later = { ...a, _id: "new", startAt: a.endAt + 1, endAt: a.endAt + 1000 };
    expect(promotionConflict(later, [a])).toBeNull();
    expect(promotionConflict({ ...a, _id: "new" }, [{ ...a, archived: true }])).toBeNull();
    expect(promotionConflict(a, [a])).toBeNull();
  });
  it("deux calendriers bureau sur la même période = conflit", () => {
    const b = { ...a, _id: "new", tagKey: "autre", officeCalendarId: "cal2" };
    expect(promotionConflict(b, [{ ...a, officeCalendarId: "cal1" }])).toMatch(/bureau/);
  });
});

describe("éligibilité des anciens leads", () => {
  const p = promo({ legacyStatuses: ["perdu", "relance"], legacyArrivedFrom: 1000, legacyArrivedTo: 5000 });
  const base = { status: "perdu" as const, arrivedAt: 2000, hasUpcomingRdv: false };
  it("éligible", () => {
    expect(legacyRejectReason(base, p)).toBeNull();
    expect(isLegacyEligible(base, p)).toBe(true);
  });
  it("raisons de rejet", () => {
    expect(legacyRejectReason({ ...base, status: "nouveau" }, p)).toBe("statut");
    expect(legacyRejectReason({ ...base, arrivedAt: 500 }, p)).toBe("periode");
    expect(legacyRejectReason({ ...base, arrivedAt: 6000 }, p)).toBe("periode");
    expect(legacyRejectReason({ ...base, deletedAt: 1 }, p)).toBe("supprime");
    expect(legacyRejectReason({ ...base, promotionId: "x" }, p)).toBe("deja_promo");
    expect(legacyRejectReason({ ...base, hasUpcomingRdv: true }, p)).toBe("rdv_a_venir");
    expect(legacyRejectReason({ ...base, status: "signe" }, { ...p, legacyStatuses: ["signe"] })).toBe("signe");
  });
});

describe("parsePromotionSlot / formatPromotionSlot", () => {
  it("lit jour, heure (nombre ou texte) et billet", () => {
    expect(parsePromotionSlot({ creneau_jour: "2026-11-27", creneau_heure: 14, billet: " BF-0012 " })).toEqual({ day: "2026-11-27", hour: 14, ticket: "BF-0012" });
    expect(parsePromotionSlot({ creneau_jour: "2026-11-29", creneau_heure: "9" })).toEqual({ day: "2026-11-29", hour: 9 });
  });
  it("null si absent ou invalide", () => {
    expect(parsePromotionSlot({})).toBeNull();
    expect(parsePromotionSlot({ creneau_jour: "2026-11-27" })).toBeNull();
    expect(parsePromotionSlot({ creneau_jour: "27/11/2026", creneau_heure: 14 })).toBeNull();
    expect(parsePromotionSlot({ creneau_jour: "2026-11-27", creneau_heure: 24 })).toBeNull();
    expect(parsePromotionSlot({ creneau_jour: "2026-11-27", creneau_heure: 8.5 })).toBeNull();
  });
  it("phrase lisible par le setter", () => {
    expect(formatPromotionSlot("2026-11-27", 14, "BF-0012")).toBe("vendredi 27, 14 h, billet BF-0012");
    expect(formatPromotionSlot("2026-11-29", 9)).toBe("dimanche 29, 9 h");
  });
});
