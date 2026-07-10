/**
 * Note « remarque prospect » poussée à GHL à la prise de RDV (contact note +
 * note d'appointment) : identité, créneau, adresse, logement, revenu fiscal,
 * commentaire setter et éligibilité, présentés en blocs lisibles pour le
 * commercial. Portage verbatim de buildGhlProspectRemark /
 * parseSetterRemarkSections (ghl-calendar.service.ts NestJS), rendu PUR :
 * scheduledAt en ms epoch au lieu de Date.
 */

export type ProspectRemarkInput = {
  sector?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  addressLine?: string | null;
  city?: string | null;
  postalCode?: string | null;
  typeLogement?: string | null;
  revenuFiscal?: number | null;
  scheduledAt?: number | null; // ms epoch
  notes?: string | null; // note structurée du setter (Commentaire / Éligibilité)
};

export function cleanRemarkText(value?: string | null): string {
  return (value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** « mercredi 15/07/2026 à 09:00 » — fuseau La Réunion. Date et heure formatées
 *  séparément puis jointes par « à » : le séparateur d'Intl varie selon l'ICU
 *  embarqué (virgule ou espace), le `.replace(',')` du NestJS n'était pas fiable. */
export function formatRdvForCommercial(ms: number): string {
  const d = new Date(ms);
  const date = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Indian/Reunion",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Indian/Reunion",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${date} à ${time}`;
}

export function parseSetterRemarkSections(raw?: string | null): {
  comment: string | null;
  eligibility: string[];
  extra: string[];
} {
  const text = cleanRemarkText(raw)
    .replace(/^RDV\s+ECOI\s*[—-].*$/gim, "")
    .replace(/^Informations complémentaires\s*:\s*/gim, "")
    .trim();
  if (!text) return { comment: null, eligibility: [], extra: [] };

  const commentMatch = text.match(/Commentaire setter\s*:\s*([\s\S]*?)(?=\n\s*Éligibilité\s*:|$)/i);
  const eligibilityMatch = text.match(/Éligibilité\s*:\s*([\s\S]*)$/i);
  const comment = commentMatch ? cleanRemarkText(commentMatch[1]) : null;
  const eligibility = eligibilityMatch
    ? cleanRemarkText(eligibilityMatch[1])
        .split("\n")
        .map((line) => cleanRemarkText(line.replace(/^[-•]\s*/, "")))
        .filter(Boolean)
    : [];

  const remainder = text
    .replace(/Commentaire setter\s*:\s*[\s\S]*?(?=\n\s*Éligibilité\s*:|$)/i, "")
    .replace(/Éligibilité\s*:\s*[\s\S]*$/i, "")
    .split("\n")
    .map(cleanRemarkText)
    .filter(Boolean);

  return { comment, eligibility, extra: remainder };
}

export function buildGhlProspectRemark(input: ProspectRemarkInput): string {
  const noteSections = parseSetterRemarkSections(input.notes);
  const identity = [input.firstName, input.lastName].map(cleanRemarkText).filter(Boolean).join(" ");
  const location = [input.postalCode, input.city].map(cleanRemarkText).filter(Boolean).join(" ");
  const header = [
    "RDV ECOI",
    input.sector ? `Secteur ${cleanRemarkText(input.sector)}` : null,
    identity || null,
  ]
    .filter(Boolean)
    .join(" — ");

  const blocks = [
    header,
    [
      input.scheduledAt != null ? `Créneau : ${formatRdvForCommercial(input.scheduledAt)}` : null,
      input.addressLine ? `Adresse : ${cleanRemarkText(input.addressLine)}` : null,
      location ? `Ville / CP : ${location}` : null,
      input.typeLogement ? `Logement : ${cleanRemarkText(input.typeLogement)}` : null,
      input.revenuFiscal != null
        ? `Revenu fiscal : ${input.revenuFiscal.toLocaleString("fr-FR")} €`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
    noteSections.comment ? `COMMENTAIRE SETTER\n${noteSections.comment}` : null,
    noteSections.eligibility.length
      ? `ÉLIGIBILITÉ\n${noteSections.eligibility.map((line) => `• ${line}`).join("\n")}`
      : null,
    noteSections.extra.length
      ? `INFORMATIONS COMPLÉMENTAIRES\n${noteSections.extra.join("\n")}`
      : null,
  ].filter((block): block is string => Boolean(block && block.trim()));

  return blocks.join("\n\n").trim().slice(0, 5000);
}
