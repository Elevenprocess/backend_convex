import { expect, test } from "vitest";
import { deriveLeadStatus } from "./deriveLeadStatus";

test("result signe → lead signe", () => {
  expect(deriveLeadStatus("honore", "signe")).toBe("signe");
});
test("result perdu/no_show → lead perdu", () => {
  expect(deriveLeadStatus("honore", "perdu")).toBe("perdu");
  expect(deriveLeadStatus("honore", "no_show")).toBe("perdu");
});
test("result reporte → a_rappeler", () => {
  expect(deriveLeadStatus("planifie", "reporte")).toBe("a_rappeler");
});
test("status honore sans result décisif → rdv_honore", () => {
  expect(deriveLeadStatus("honore", null)).toBe("rdv_honore");
  expect(deriveLeadStatus("honore", "reflexion")).toBe("rdv_honore");
});
test("status no_show/annule → perdu", () => {
  expect(deriveLeadStatus("no_show", null)).toBe("perdu");
  expect(deriveLeadStatus("annule", null)).toBe("perdu");
});
test("status reporte sans result → a_rappeler", () => {
  expect(deriveLeadStatus("reporte", null)).toBe("a_rappeler");
});
test("planifie sans result → null (pas de changement)", () => {
  expect(deriveLeadStatus("planifie", null)).toBeNull();
});
