import { convexTest } from "convex-test";
import schema from "./schema";

// Offline : on injecte la map de modules pour que convex-test localise
// `_generated/` et les fonctions. Glob évalué relativement à ce fichier (racine convex/).
const modules = import.meta.glob("./**/*.{ts,js}");

export const makeT = () => convexTest(schema, modules);
