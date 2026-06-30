// Port de OcrService (devis NestJS). Appel OpenRouter (Vision) — exécuté côté
// action Convex. Non testé offline (réseau).
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OCR_MODEL = "google/gemini-2.0-flash-001";
const OCR_ATTEMPTS = 3;

const SYSTEM_PROMPT = `Tu es un OCR spécialisé sur les devis photovoltaïques français (logiciel Solteo). Tu dois extraire EXHAUSTIVEMENT toutes les données visibles du PDF. Tu réponds UNIQUEMENT avec un JSON valide. Aucun texte avant ou après le JSON, pas de markdown. Montants en euros sans symbole, point décimal. Dates au format YYYY-MM-DD.`;

const USER_PROMPT = `Extrais TOUTES les données du devis Solteo en JSON : devisNumber, devisDate, dateExpiration, delaiExecution, vendor{name,addressLine,postalCode,city,phone,email}, customer{firstName,lastName,addressLine,city,postalCode,email,phone}, puissanceKwc, nbPanneaux, kits, montantHt, montantTva, montantTtc, montantNet, lignes[{designation,description,qty,prixUnitaireHt,totalHt,tva,totalTtc,type}], prime{type,montant,tarifEuroParKwc,zone}, conditionsReglement, echeancier[{label,phase,montant}], financingType, financingDetails{duree,mensualite,taux,apport}. Le client est à droite ; ne JAMAIS mettre le vendeur ELECTRO CONCEPT OI dans customer.`;

// Extrait le 1er objet JSON d'une réponse LLM (tolère un préambule/markdown).
export function parseOcrJson(raw: string): Record<string, unknown> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Réponse OCR sans JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function extractFromPdf(
  pdfBase64: string,
  filename: string,
): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY manquante");
  let lastErr: unknown;
  for (let attempt = 1; attempt <= OCR_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OCR_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: USER_PROMPT },
                { type: "file", file: { filename, file_data: `data:application/pdf;base64,${pdfBase64}` } },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error("Réponse OpenRouter vide");
      return parseOcrJson(content);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("OCR échec");
}
