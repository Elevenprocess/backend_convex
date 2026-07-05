/**
 * Normaliseurs des réponses brutes de l'API GHL (events, slots, contacts,
 * calendriers, users). Portage verbatim de ghl-calendar.service.ts (NestJS),
 * chaque `|| null` devient `?? undefined`. Fonctions PURES.
 */

import type {
  GhlCalendarEvent, GhlCalendarSummary, GhlContactInfo, GhlSlot, GhlUser,
} from "./calendarTypes";

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function nestedStringValue(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  return stringValue((value as Record<string, unknown>)[key]);
}

// ─── Events (l.1294-1318) ─────────────────────────────────────────────────────

export function normalizeEvents(
  raw: unknown,
  calendarId: string,
  sector?: string,
): GhlCalendarEvent[] {
  const events =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).events)
      ? (raw as { events: unknown[] }).events
      : Array.isArray(raw)
        ? raw
        : [];
  return events.flatMap((event) => {
    if (!event || typeof event !== "object") return [];
    const item = event as Record<string, unknown>;
    const id = stringValue(item.id) || stringValue(item.eventId) || stringValue(item.appointmentId);
    const startTime = stringValue(item.startTime) || stringValue(item.start) || stringValue(item.date);
    if (!id || !startTime) return [];
    const out: GhlCalendarEvent = {
      id,
      calendarId: stringValue(item.calendarId) || calendarId,
      sector,
      title: stringValue(item.title) || stringValue(item.name),
      startTime,
      endTime: stringValue(item.endTime) || stringValue(item.end),
      status:
        stringValue(item.appointmentStatus) ||
        stringValue(item.appoinmentStatus) ||
        stringValue(item.status),
      contactId: stringValue(item.contactId) || nestedStringValue(item.contact, "id"),
      assignedUserId:
        stringValue(item.assignedUserId) ||
        stringValue(item.assignedTo) ||
        stringValue(item.userId) ||
        stringValue(item.ownerId) ||
        nestedStringValue(item.assignedUser, "id") ||
        nestedStringValue(item.user, "id"),
      address: stringValue(item.address),
      notes: stringValue(item.notes) || stringValue(item.description),
    };
    return [out];
  });
}

// ─── Slots (l.1279-1293 + collectSlotValues l.1608-1653) ──────────────────────

function looksLikeSlotString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(value) || /^\d{2}:\d{2}$/.test(value);
}

function collectSlotValues(raw: unknown): unknown[] {
  const values: unknown[] = [];
  const seen = new Set<unknown>();

  const visit = (value: unknown, depth = 0) => {
    if (value === null || value === undefined || depth > 8) return;

    if (typeof value === "string") {
      if (looksLikeSlotString(value)) values.push(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }

    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    const obj = value as Record<string, unknown>;
    const slotCandidate = obj.startTime || obj.start || obj.time || obj.date;
    if (typeof slotCandidate === "string" && looksLikeSlotString(slotCandidate)) {
      values.push(obj);
      return;
    }

    for (const nested of Object.values(obj)) visit(nested, depth + 1);
  };

  visit(raw);
  return values;
}

export function normalizeSlots(raw: unknown, calendarId: string, sector?: string): GhlSlot[] {
  const values = collectSlotValues(raw);
  const normalized: Array<GhlSlot | null> = values.map((value) => {
    if (typeof value === "string") return { startTime: value, calendarId, sector };
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    const start = item.startTime || item.start || item.time || item.date;
    const end = item.endTime || item.end;
    if (typeof start !== "string") return null;
    return {
      startTime: start,
      endTime: typeof end === "string" ? end : undefined,
      calendarId,
      sector,
    };
  });
  return normalized.filter((slot): slot is GhlSlot => Boolean(slot));
}

// ─── Contacts (l.1683-1701) ───────────────────────────────────────────────────

export function normalizeGhlContact(raw: unknown, fallbackId: string): GhlContactInfo {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const contact =
    root.contact && typeof root.contact === "object"
      ? (root.contact as Record<string, unknown>)
      : root;
  const firstName = stringValue(contact.firstName) || stringValue(contact.first_name);
  const lastName = stringValue(contact.lastName) || stringValue(contact.last_name);
  const name =
    stringValue(contact.name) || [firstName, lastName].filter(Boolean).join(" ").trim() || undefined;
  return {
    id: stringValue(contact.id) || stringValue(contact.contactId) || fallbackId,
    name,
    firstName,
    lastName,
    email: stringValue(contact.email),
    phone: stringValue(contact.phone) || stringValue(contact.phoneNumber),
    addressLine: stringValue(contact.address1) || stringValue(contact.address),
    city: stringValue(contact.city),
    postalCode: stringValue(contact.postalCode) || stringValue(contact.postal_code),
  };
}

// ─── Calendriers (l.1729-1752) ────────────────────────────────────────────────

export function normalizeGhlCalendars(raw: unknown): GhlCalendarSummary[] {
  const values =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).calendars)
      ? (raw as { calendars: unknown[] }).calendars
      : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).data)
        ? (raw as { data: unknown[] }).data
        : Array.isArray(raw)
          ? raw
          : [];
  return values.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const id = stringValue(item.id) || stringValue(item._id) || stringValue(item.calendarId);
    if (!id) return [];
    const name = stringValue(item.name) || stringValue(item.title) || id;
    const teamMembers = Array.isArray(item.teamMembers)
      ? item.teamMembers
      : Array.isArray(item.members)
        ? item.members
        : [];
    const members = teamMembers.flatMap((member) => {
      if (!member || typeof member !== "object") return [];
      const row = member as Record<string, unknown>;
      const userId = stringValue(row.userId) || stringValue(row.id);
      if (!userId) return [];
      return [{
        userId,
        selected: typeof row.selected === "boolean" ? row.selected : undefined,
        primary: row.isPrimary === true || row.primary === true,
      }];
    });
    return [{ id, name, members }];
  });
}

// ─── Users (l.1762-1780) ──────────────────────────────────────────────────────

export function normalizeGhlUsers(raw: unknown): GhlUser[] {
  const values =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).users)
      ? (raw as { users: unknown[] }).users
      : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).data)
        ? (raw as { data: unknown[] }).data
        : Array.isArray(raw)
          ? raw
          : [];
  return values.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const id = stringValue(item.id) || stringValue(item.userId);
    if (!id) return [];
    const firstName = stringValue(item.firstName);
    const lastName = stringValue(item.lastName);
    const name =
      stringValue(item.name) ||
      [firstName, lastName].filter(Boolean).join(" ").trim() ||
      stringValue(item.email) ||
      id;
    return [{
      id,
      name,
      email: stringValue(item.email),
      phone: stringValue(item.phone),
      role: stringValue(item.role) || stringValue(item.type),
    }];
  });
}

// ─── Split nom (l.1702-1708) ──────────────────────────────────────────────────

export function splitContactName(name?: string): { firstName?: string; lastName?: string } {
  if (!name) return { firstName: undefined, lastName: undefined };
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: undefined, lastName: undefined };
  if (parts.length === 1) return { firstName: parts[0], lastName: undefined };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
}
