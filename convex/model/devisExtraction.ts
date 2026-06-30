// Types lâches d'extraction (le LLM est la source ; `extracted` reste brut).
export interface Customer {
  firstName?: string; lastName?: string; email?: string; phone?: string;
  addressLine?: string; postalCode?: string; city?: string;
  [k: string]: unknown;
}
export interface Vendor {
  name?: string; addressLine?: string; postalCode?: string; city?: string;
  phone?: string; email?: string; [k: string]: unknown;
}
export interface Ligne {
  designation: string; description?: string; qty: number; prixUnitaireHt: number;
  totalHt: number; tva: number; totalTtc: number; type?: string; [k: string]: unknown;
}
export interface Echeance { label: string; phase?: string; montant: number; [k: string]: unknown; }
export interface Prime {
  type?: string; montant?: number; tarifEuroParKwc?: number; zone?: string; [k: string]: unknown;
}
export interface DevisExtraction {
  devisNumber?: string; devisDate?: string; dateExpiration?: string; delaiExecution?: string;
  vendor?: Vendor; customer?: Customer;
  puissanceKwc?: number; nbPanneaux?: number; kits?: string;
  montantHt?: number; montantTva?: number; montantTtc?: number; montantNet?: number;
  lignes?: Ligne[]; prime?: Prime; conditionsReglement?: string; echeancier?: Echeance[];
  financingType?: string; financingDetails?: Record<string, unknown>;
  [k: string]: unknown;
}

// Portage verbatim de devis.service.ts.
const ECOI_VENDOR_MARKER = /electro\s*concept|ruisseau des noirs|97400\s+saint-denis|693\s*46\s*64\s*99/i;
const OCR_NOISE_MARKER = /^(devis|référence|reference|n[°º]|ape\b|siret\b|tva\b|jme-)/i;

export function cleanCustomerText(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  if (ECOI_VENDOR_MARKER.test(cleaned) || OCR_NOISE_MARKER.test(cleaned)) return undefined;
  return cleaned;
}

export function customerPatch(customer: Customer | undefined) {
  if (!customer) return {};
  return {
    firstName: cleanCustomerText(customer.firstName),
    lastName: cleanCustomerText(customer.lastName),
    email: cleanCustomerText(customer.email),
    phone: cleanCustomerText(customer.phone),
    addressLine: cleanCustomerText(customer.addressLine),
    postalCode: cleanCustomerText(customer.postalCode),
    city: cleanCustomerText(customer.city),
  };
}

export function dropUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
