import { expect, test } from "vitest";
import { cleanCustomerText, customerPatch, dropUndefined } from "./devisExtraction";

test("cleanCustomerText rejette le vendeur ECOI et le bruit OCR", () => {
  expect(cleanCustomerText("ELECTRO CONCEPT OI")).toBeUndefined();
  expect(cleanCustomerText("45 rue Ruisseau des Noirs")).toBeUndefined();
  expect(cleanCustomerText("Devis n°2605")).toBeUndefined();
  expect(cleanCustomerText("  Jean   Dupont ")).toBe("Jean Dupont");
  expect(cleanCustomerText("")).toBeUndefined();
  expect(cleanCustomerText(undefined)).toBeUndefined();
});

test("customerPatch nettoie chaque champ", () => {
  const p = customerPatch({ firstName: "Marie", lastName: "ELECTRO CONCEPT OI", city: "Saint-Denis" });
  expect(p.firstName).toBe("Marie");
  expect(p.lastName).toBeUndefined();
  expect(p.city).toBe("Saint-Denis");
});

test("customerPatch sur undefined renvoie {}", () => {
  expect(customerPatch(undefined)).toEqual({});
});

test("dropUndefined retire les clés undefined", () => {
  expect(dropUndefined({ a: 1, b: undefined, c: "x" })).toEqual({ a: 1, c: "x" });
});
