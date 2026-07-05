/**
 * Types du calendrier GHL. Portage de ghl-calendar.service.ts (NestJS l.20-66
 * + 1645-1682), undefined-based (jamais null côté Convex). `commercialId`
 * porte un Id<"users"> Convex sérialisé (string au niveau du type pur).
 */

export type GhlSectorConfig = {
  sector: string;
  calendarId: string;
  label: string;
};

export type GhlSlot = {
  startTime: string;
  endTime?: string;
  calendarId: string;
  sector?: string;
};

export type GhlCalendarEvent = {
  id: string;
  calendarId: string;
  sector?: string;
  title?: string;
  startTime: string;
  endTime?: string;
  status?: string;
  contactId?: string;
  assignedUserId?: string;
  commercialId?: string;
  commercialName?: string;
  isMappedCommercial?: boolean;
  address?: string;
  notes?: string;
  contactName?: string;
  contactFirstName?: string;
  contactLastName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactCity?: string;
  contactPostalCode?: string;
};

export type GhlContactInfo = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  addressLine?: string;
  city?: string;
  postalCode?: string;
};

export type GhlCalendarMember = {
  userId: string;
  selected?: boolean;
  primary: boolean;
};

export type GhlCalendarSummary = {
  id: string;
  name: string;
  members: GhlCalendarMember[];
};

export type GhlUser = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
};
