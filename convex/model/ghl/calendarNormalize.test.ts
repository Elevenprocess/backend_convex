import { describe, expect, it } from "vitest";
import {
  normalizeEvents, normalizeSlots, normalizeGhlContact,
  normalizeGhlCalendars, normalizeGhlUsers, splitContactName,
} from "./calendarNormalize";

describe("normalizeEvents", () => {
  it("alias id/eventId/appointmentId, startTime/start/date, statut avec la faute appoinmentStatus", () => {
    const raw = { events: [
      { id: "e1", startTime: "2026-07-10T09:00:00Z", appointmentStatus: "confirmed", contactId: "c1" },
      { eventId: "e2", start: "2026-07-11T10:00:00Z", appoinmentStatus: "noshow" },
      { appointmentId: "e3", date: "2026-07-12T11:00:00Z", status: "cancelled", contact: { id: "c3" } },
    ]};
    const events = normalizeEvents(raw, "cal1", "ouest");
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ id: "e1", calendarId: "cal1", sector: "ouest", status: "confirmed", contactId: "c1" });
    expect(events[1]).toMatchObject({ id: "e2", status: "noshow" });
    expect(events[2]).toMatchObject({ id: "e3", status: "cancelled", contactId: "c3" });
  });

  it("assignedUserId : 6 alias acceptés", () => {
    const mk = (o: object) => normalizeEvents({ events: [{ id: "e", startTime: "2026-07-10T09:00:00Z", ...o }] }, "cal")[0];
    expect(mk({ assignedUserId: "u1" }).assignedUserId).toBe("u1");
    expect(mk({ assignedTo: "u2" }).assignedUserId).toBe("u2");
    expect(mk({ userId: "u3" }).assignedUserId).toBe("u3");
    expect(mk({ ownerId: "u4" }).assignedUserId).toBe("u4");
    expect(mk({ assignedUser: { id: "u5" } }).assignedUserId).toBe("u5");
    expect(mk({ user: { id: "u6" } }).assignedUserId).toBe("u6");
  });

  it("event sans id ou sans startTime écarté ; raw tableau direct accepté", () => {
    expect(normalizeEvents({ events: [{ id: "x" }, { startTime: "2026-07-10T09:00:00Z" }] }, "cal")).toHaveLength(0);
    expect(normalizeEvents([{ id: "e", startTime: "2026-07-10T09:00:00Z" }], "cal")).toHaveLength(1);
  });
});

describe("normalizeSlots", () => {
  it("strings ISO, objets {startTime}, structure imbriquée", () => {
    const raw = { _dates: { slots: ["2026-07-10T09:00:00Z", { startTime: "2026-07-10T10:00:00Z", endTime: "2026-07-10T11:00:00Z" }] } };
    const slots = normalizeSlots(raw, "cal1", "sud");
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ startTime: "2026-07-10T09:00:00Z", calendarId: "cal1", sector: "sud" });
    expect(slots[1].endTime).toBe("2026-07-10T11:00:00Z");
  });
});

describe("normalizeGhlContact", () => {
  it("contact imbriqué ou racine, alias snake, name composé", () => {
    const c = normalizeGhlContact({ contact: { id: "c1", first_name: "Jean", last_name: "Payet", phoneNumber: "0692", postal_code: "97400" } }, "fb");
    expect(c).toMatchObject({ id: "c1", firstName: "Jean", lastName: "Payet", name: "Jean Payet", phone: "0692", postalCode: "97400" });
    expect(normalizeGhlContact(null, "fallback").id).toBe("fallback");
  });
});

describe("normalizeGhlCalendars", () => {
  it("clés calendars/data/tableau, membres teamMembers/members, primary", () => {
    const raw = { calendars: [{ _id: "cal1", name: "Secteur Ouest", teamMembers: [
      { userId: "u1", selected: true, isPrimary: true }, { id: "u2" }, {} ] }] };
    const [cal] = normalizeGhlCalendars(raw);
    expect(cal).toMatchObject({ id: "cal1", name: "Secteur Ouest" });
    expect(cal.members).toEqual([
      { userId: "u1", selected: true, primary: true },
      { userId: "u2", selected: undefined, primary: false },
    ]);
  });
});

describe("normalizeGhlUsers", () => {
  it("users/data/tableau, name composé sinon email sinon id", () => {
    const users = normalizeGhlUsers({ users: [
      { id: "u1", firstName: "A", lastName: "B", email: "a@b.re" },
      { userId: "u2", email: "x@y.re" }, { noid: true } ] });
    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({ id: "u1", name: "A B", email: "a@b.re" });
    expect(users[1].name).toBe("x@y.re");
  });
});

describe("splitContactName", () => {
  it("dernier mot = nom, le reste = prénom (parité NestJS)", () => {
    expect(splitContactName("Marie Claire Payet")).toEqual({ firstName: "Marie Claire", lastName: "Payet" });
    expect(splitContactName("Cimendef")).toEqual({ firstName: "Cimendef", lastName: undefined });
    expect(splitContactName(undefined)).toEqual({ firstName: undefined, lastName: undefined });
  });
});
