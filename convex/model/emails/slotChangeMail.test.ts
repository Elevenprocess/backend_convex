import { describe, expect, test } from "vitest";
import { renderSlotChangeMail } from "./slotChangeMail";

describe("renderSlotChangeMail", () => {
  test("remplit billet, nouveau créneau, prénom et lien", () => {
    const m = renderSlotChangeMail({ firstName: "Jules", ticket: "BF-0080", day: "2026-11-28", hour: 15, ticketUrl: "https://invitation.electroconceptoi.com/billet/abc" });
    expect(m.subject).toBe("Votre nouveau créneau, Samedi 28 novembre, 15 h à 16 h");
    expect(m.html).toContain("Bonjour Jules,");
    expect(m.html).toContain("VOTRE BILLET BF-0080");
    expect(m.html).toContain("Samedi 28 novembre, de 15 h à 16 h");
    expect(m.html).toContain('href="https://invitation.electroconceptoi.com/billet/abc"');
    expect(m.html).not.toMatch(/\{\{|Jules,.*Jules|Vendredi 27|0080.*0080.*0080.*0080/s);
  });
  test("sans prénom ni lien : « Bonjour, » et lien vers le site", () => {
    const m = renderSlotChangeMail({ ticket: "BF-0001", day: "2026-11-27", hour: 9 });
    expect(m.html).toContain("Bonjour,");
    expect(m.html).toContain('href="https://invitation.electroconceptoi.com"');
  });
});
