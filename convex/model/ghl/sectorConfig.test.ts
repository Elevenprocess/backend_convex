import { describe, expect, it } from "vitest";
import {
  calendarIdForSector, calendarsForEvents, isSectorLike, normalizeSector,
  parseSectorCalendars, publicSectors, sectorFromCalendarName,
} from "./sectorConfig";

describe("parseSectorCalendars", () => {
  it("valeurs string et objet, label par défaut, entrées sans calendarId filtrées", () => {
    const raw = JSON.stringify({ ouest: "cal1", est: { calendarId: "cal2", label: "Zone Est" }, vide: {} });
    expect(parseSectorCalendars(raw)).toEqual([
      { sector: "ouest", calendarId: "cal1", label: "Secteur OUEST" },
      { sector: "est", calendarId: "cal2", label: "Zone Est" },
    ]);
  });
  it("JSON cassé ou absent → []", () => {
    expect(parseSectorCalendars("{pas du json")).toEqual([]);
    expect(parseSectorCalendars(undefined)).toEqual([]);
  });
});

describe("publicSectors", () => {
  it("config vide → fallback Ouest/Est/Sud/Nord calendarId vide", () => {
    const fallback = publicSectors([]);
    expect(fallback).toHaveLength(4);
    expect(fallback[0]).toEqual({ sector: "Ouest", calendarId: "", label: "Secteur OUEST" });
    const cfg = [{ sector: "ouest", calendarId: "c", label: "L" }];
    expect(publicSectors(cfg)).toBe(cfg);
  });
});

describe("calendarIdForSector / calendarsForEvents", () => {
  const sectors = [
    { sector: "ouest", calendarId: "cal1", label: "Secteur OUEST" },
    { sector: "est", calendarId: "cal2", label: "Secteur EST" },
  ];
  it("résolution insensible casse/accents", () => {
    expect(calendarIdForSector(sectors, " Öuest ")).toBe("cal1");
    expect(calendarIdForSector(sectors, "nord")).toBeUndefined();
    expect(calendarIdForSector(sectors, undefined)).toBeUndefined();
  });
  it("calendarsForEvents : calendarId explicite > secteur > tous", () => {
    expect(calendarsForEvents(sectors, { calendarId: "calX", sector: "Sud" })).toEqual([
      { sector: "sud", calendarId: "calX", label: "Sud" },
    ]);
    expect(calendarsForEvents(sectors, { sector: "est" })).toEqual([
      { sector: "est", calendarId: "cal2", label: "Secteur est" },
    ]);
    expect(calendarsForEvents(sectors, { sector: "inconnu" })).toEqual([]);
    expect(calendarsForEvents(sectors, {})).toBe(sectors);
  });
});

describe("sectorFromCalendarName / isSectorLike", () => {
  it("préfixe « Secteur » retiré, détection secteur", () => {
    expect(sectorFromCalendarName("Secteur Ouest")).toBe("ouest");
    expect(normalizeSector("Été")).toBe("ete");
    expect(isSectorLike("Secteur Nord")).toBe(true);
    expect(isSectorLike("Agenda Sud")).toBe(true);
    expect(isSectorLike("Réunions internes")).toBe(false);
  });
});
