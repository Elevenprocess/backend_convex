/**
 * Config secteurs GHL. Portage de sectorCalendars/publicSectors/
 * calendarIdForSector/calendarsForEvents + normalizeSector/
 * sectorFromCalendarName/isSectorLike (ghl-calendar.service.ts NestJS), rendus
 * PURS : la config brute (env) est un paramètre au lieu de `this.config`.
 */

import type { GhlSectorConfig } from "./calendarTypes";

export function normalizeSector(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function parseSectorCalendars(raw: string | undefined): GhlSectorConfig[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, string | { calendarId?: string; label?: string }>;
    return Object.entries(parsed)
      .map(([sector, value]) => {
        const calendarId = typeof value === "string" ? value : value.calendarId ?? "";
        const label =
          typeof value === "string"
            ? `Secteur ${sector.toUpperCase()}`
            : value.label ?? `Secteur ${sector.toUpperCase()}`;
        return { sector: normalizeSector(sector), calendarId, label };
      })
      .filter((s) => s.calendarId);
  } catch {
    return [];
  }
}

export function publicSectors(configured: GhlSectorConfig[]): GhlSectorConfig[] {
  if (configured.length > 0) return configured;
  return ["Ouest", "Est", "Sud", "Nord"].map((sector) => ({
    sector,
    calendarId: "",
    label: `Secteur ${sector.toUpperCase()}`,
  }));
}

export function calendarIdForSector(sectors: GhlSectorConfig[], sector?: string): string | undefined {
  if (!sector) return undefined;
  const wanted = normalizeSector(sector);
  return sectors.find((entry) => normalizeSector(entry.sector) === wanted)?.calendarId;
}

export function calendarsForEvents(
  sectors: GhlSectorConfig[],
  dto: { sector?: string; calendarId?: string },
): GhlSectorConfig[] {
  if (dto.calendarId) {
    return [{ sector: normalizeSector(dto.sector ?? "GHL"), calendarId: dto.calendarId, label: dto.sector ?? "GHL" }];
  }
  if (dto.sector) {
    const calendarId = calendarIdForSector(sectors, dto.sector);
    return calendarId
      ? [{ sector: normalizeSector(dto.sector), calendarId, label: `Secteur ${normalizeSector(dto.sector)}` }]
      : [];
  }
  return sectors;
}

export function sectorFromCalendarName(name: string): string {
  const normalized = normalizeSector(name.replace(/^secteur\s+/i, ""));
  return normalized || normalizeSector(name);
}

export function isSectorLike(label: string): boolean {
  return (
    /^secteur\s+/i.test(label) ||
    ["ouest", "est", "sud", "nord"].some((sector) => normalizeSector(label).includes(sector))
  );
}
