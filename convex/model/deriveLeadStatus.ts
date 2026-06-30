import { RdvStatus, RdvResult, LeadStatus } from "./enums";

// Portage de RdvService.deriveLeadStatusFromRdv. Retourne null = pas de mouvement.
export function deriveLeadStatus(status: RdvStatus, result: RdvResult | null): LeadStatus | null {
  if (result === "signe") return "signe";
  if (result === "perdu" || result === "no_show") return "perdu";
  if (result === "reporte") return "a_rappeler";
  if (status === "honore") return "rdv_honore";
  if (status === "no_show") return "perdu";
  if (status === "annule") return "perdu";
  if (status === "reporte") return "a_rappeler";
  return null; // planifie → déjà qualifié, on ne touche pas
}
