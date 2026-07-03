import { expect, test } from "vitest";
import {
  formatFrDate,
  vtDateChangedMessage,
  acompte40Message,
  acompteSoldeMessage,
  shouldNotifyVtDateChange,
} from "./notifMessages";

test("formatFrDate : YYYY-MM-DD → JJ/MM/AAAA, '' sinon", () => {
  expect(formatFrDate("2026-07-03")).toBe("03/07/2026");
  expect(formatFrDate(null)).toBe("");
  expect(formatFrDate(undefined)).toBe("");
  expect(formatFrDate("garbage")).toBe("");
});

test("vtDateChangedMessage avec/sans date", () => {
  expect(vtDateChangedMessage({ leadName: "Sophie Martin", date: "2026-07-10" })).toEqual({
    title: "Date de VT mise à jour",
    body: "Sophie Martin — VT le 10/07/2026",
  });
  expect(vtDateChangedMessage({ leadName: "Sophie Martin", date: null }).body).toBe(
    "Sophie Martin — VT replanifiée",
  );
});

test("messages acompte", () => {
  expect(acompte40Message({ leadName: "S" })).toEqual({
    type: "acompte_a_encaisser",
    title: "Acompte à encaisser (40 %)",
    body: "VT validée pour S — encaisser le 1er acompte (40 %).",
  });
  expect(acompteSoldeMessage({ leadName: "S" })).toEqual({
    type: "acompte_a_encaisser",
    title: "Solde à encaisser",
    body: "Installation effectuée pour S — encaisser le solde.",
  });
});

test("shouldNotifyVtDateChange : seulement vt_planifie avec date qui change", () => {
  expect(shouldNotifyVtDateChange({ key: "vt_planifie", beforeDate: null, nextDate: "2026-07-10" })).toBe(true);
  expect(shouldNotifyVtDateChange({ key: "vt_planifie", beforeDate: "2026-07-10", nextDate: "2026-07-10" })).toBe(false);
  expect(shouldNotifyVtDateChange({ key: "vt_planifie", beforeDate: "2026-07-10", nextDate: undefined })).toBe(false);
  expect(shouldNotifyVtDateChange({ key: "vt_planifie", beforeDate: "2026-07-10", nextDate: null })).toBe(true);
  expect(shouldNotifyVtDateChange({ key: "vt_validee", beforeDate: null, nextDate: "2026-07-10" })).toBe(false);
});
