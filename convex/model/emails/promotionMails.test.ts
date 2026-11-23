import { expect, it } from "vitest";
import { renderPromotionMail } from "./promotionMails";

it("prénom inséré et échappé ; sans prénom « Bonjour, » ; modèle inconnu = null", () => {
  expect(renderPromotionMail("bf26-confirmation-prix", "Zoé <b>")?.html).toContain("Bonjour Zoé &lt;b&gt;,");
  const anon = renderPromotionMail("bf26-confirmation-prix", null)!.html;
  expect(anon).toContain("Bonjour,");
  expect(anon).not.toContain("{{");
  expect(renderPromotionMail("inconnu", "A")).toBeNull();
});
