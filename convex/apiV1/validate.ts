/**
 * Validation des arguments d'une fonction métier invoquée via le pont, à
 * partir du validateur JSON qu'exporte Convex (`fn.exportArgs()`). Même
 * sémantique que la validation serveur de Convex (et que convex-test) ;
 * messages en français avec le chemin du champ fautif.
 */
type JsonValidator =
  | { type: "null" | "number" | "bigint" | "boolean" | "string" | "bytes" | "any" }
  | { type: "literal"; value: unknown }
  | { type: "id"; tableName: string }
  | { type: "array"; value: JsonValidator }
  | { type: "record"; keys: JsonValidator; values: { fieldType: JsonValidator; optional?: boolean } }
  | { type: "union"; value: JsonValidator[] }
  | { type: "object"; value: Record<string, { fieldType: JsonValidator; optional?: boolean }> };

export class ArgsValidationError extends Error {}

function describe(v: JsonValidator): string {
  switch (v.type) {
    case "literal": return JSON.stringify(v.value);
    case "id": return `id (${v.tableName})`;
    case "array": return `tableau de ${describe(v.value)}`;
    case "union": return v.value.map(describe).join(" | ");
    case "object": return "objet";
    case "record": return "dictionnaire";
    default: return v.type;
  }
}

function fail(path: string, msg: string): never {
  throw new ArgsValidationError(`Paramètre \`${path || "body"}\` : ${msg}`);
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
}

export function validateValue(v: JsonValidator, value: unknown, path = ""): void {
  switch (v.type) {
    case "any": return;
    case "null": if (value !== null) fail(path, "doit être null"); return;
    case "number": if (typeof value !== "number" || Number.isNaN(value)) fail(path, "doit être un nombre"); return;
    case "bigint": if (typeof value !== "bigint") fail(path, "doit être un entier (bigint)"); return;
    case "boolean": if (typeof value !== "boolean") fail(path, "doit être un booléen"); return;
    case "string": if (typeof value !== "string") fail(path, "doit être une chaîne"); return;
    case "bytes": if (!(value instanceof ArrayBuffer)) fail(path, "doit être binaire"); return;
    case "literal": if (value !== v.value) fail(path, `doit valoir ${JSON.stringify(v.value)}`); return;
    case "id": if (typeof value !== "string" || !value) fail(path, `doit être un identifiant ${v.tableName}`); return;
    case "array":
      if (!Array.isArray(value)) fail(path, "doit être un tableau");
      value.forEach((x, i) => validateValue(v.value, x, `${path}[${i}]`));
      return;
    case "union": {
      const errors: string[] = [];
      for (const alt of v.value) {
        try { validateValue(alt, value, path); return; } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
      }
      fail(path, `valeur inattendue (attendu : ${describe(v)})`);
      return;
    }
    case "record":
      if (!isPlainObject(value)) fail(path, "doit être un objet");
      for (const [k, x] of Object.entries(value)) validateValue(v.values.fieldType, x, path ? `${path}.${k}` : k);
      return;
    case "object": {
      if (!isPlainObject(value)) fail(path, "doit être un objet");
      for (const [k, { fieldType, optional }] of Object.entries(v.value)) {
        const p = path ? `${path}.${k}` : k;
        if (value[k] === undefined) { if (!optional) fail(p, "requis"); }
        else validateValue(fieldType, value[k], p);
      }
      for (const k of Object.keys(value)) if (v.value[k] === undefined) fail(path ? `${path}.${k}` : k, "champ inconnu");
      return;
    }
  }
}

/** Valide `args` contre le JSON de `fn.exportArgs()`. */
export function validateArgs(exportedArgsJson: string, args: unknown): void {
  const validator = JSON.parse(exportedArgsJson) as JsonValidator;
  validateValue(validator, args ?? {});
}
