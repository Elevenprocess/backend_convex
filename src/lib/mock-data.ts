export type LeadStatus = 'nouveau' | 'qualifie' | 'rdv_pris' | 'rdv_honore' | 'vendu' | 'perdu'

export type Lead = {
  id: string
  firstName: string
  lastName: string
  initials: string
  city: string
  source: string
  utm: string
  phone: string
  email: string
  status: LeadStatus
  daysSinceContact: number
  assignedSetter: string
  assignedCommercial?: string
  createdAt: string
  notes?: string
}

export const LEADS: Lead[] = [
  { id: 'l1', firstName: 'Pierre', lastName: 'Laurent', initials: 'PL', city: 'Saint-Denis', source: 'Meta', utm: 'meta_solar_dec', phone: '+262 692 12 34 56', email: 'pierre.l@example.re', status: 'rdv_pris', daysSinceContact: 0, assignedSetter: 'Sarah R.', assignedCommercial: 'Jean-Luc B.', createdAt: '2026-05-02', notes: 'Maison 120m², toit tôle ondulée, intéressé financement' },
  { id: 'l2', firstName: 'Marc', lastName: 'Laurent', initials: 'ML', city: 'Saint-Pierre', source: 'Google', utm: 'g_solar_brand', phone: '+262 692 22 11 33', email: 'marc.l@example.re', status: 'qualifie', daysSinceContact: 1, assignedSetter: 'Sarah R.', createdAt: '2026-05-01' },
  { id: 'l3', firstName: 'Clara', lastName: 'Dupont', initials: 'CD', city: 'Saint-Paul', source: 'Meta', utm: 'meta_eco_apr', phone: '+262 692 33 44 55', email: 'clara.d@example.re', status: 'nouveau', daysSinceContact: 2, assignedSetter: 'Sarah R.', createdAt: '2026-05-01' },
  { id: 'l4', firstName: 'Vincent', lastName: 'Roux', initials: 'VR', city: 'Le Tampon', source: 'Google', utm: 'g_solar_generic', phone: '+262 692 44 55 66', email: 'vincent.r@example.re', status: 'qualifie', daysSinceContact: 0, assignedSetter: 'Sarah R.', createdAt: '2026-04-30' },
  { id: 'l5', firstName: 'Mehdi', lastName: 'Aubry', initials: 'MA', city: 'Saint-Louis', source: 'Référence', utm: 'ref_pierreL', phone: '+262 692 55 66 77', email: 'mehdi.a@example.re', status: 'qualifie', daysSinceContact: 1, assignedSetter: 'Sarah R.', createdAt: '2026-04-29' },
  { id: 'l6', firstName: 'Sophie', lastName: 'Bernard', initials: 'SB', city: 'Saint-Denis', source: 'Meta', utm: 'meta_solar_dec', phone: '+262 692 66 77 88', email: 'sophie.b@example.re', status: 'rdv_pris', daysSinceContact: 0, assignedSetter: 'Karim B.', assignedCommercial: 'Jean-Luc B.', createdAt: '2026-05-02' },
  { id: 'l7', firstName: 'Régis', lastName: 'Martin', initials: 'RM', city: 'Saint-Benoît', source: 'Google', utm: 'g_solar_brand', phone: '+262 692 77 88 99', email: 'regis.m@example.re', status: 'rdv_pris', daysSinceContact: 0, assignedSetter: 'Karim B.', assignedCommercial: 'Jean-Luc B.', createdAt: '2026-05-02' },
  { id: 'l8', firstName: 'Estelle', lastName: 'Coquillard', initials: 'EC', city: 'Saint-Joseph', source: 'Meta', utm: 'meta_eco_apr', phone: '+262 692 88 99 00', email: 'estelle.c@example.re', status: 'vendu', daysSinceContact: 5, assignedSetter: 'Sarah R.', assignedCommercial: 'Marie S.', createdAt: '2026-04-15' },
  { id: 'l9', firstName: 'Bruno', lastName: 'Hoarau', initials: 'BH', city: 'Sainte-Suzanne', source: 'Google', utm: 'g_solar_generic', phone: '+262 692 99 00 11', email: 'bruno.h@example.re', status: 'perdu', daysSinceContact: 12, assignedSetter: 'Karim B.', createdAt: '2026-04-20' },
  { id: 'l10', firstName: 'Léa', lastName: 'Payet', initials: 'LP', city: 'Saint-André', source: 'Meta', utm: 'meta_solar_dec', phone: '+262 692 10 20 30', email: 'lea.p@example.re', status: 'rdv_honore', daysSinceContact: 3, assignedSetter: 'Sarah R.', assignedCommercial: 'Jean-Luc B.', createdAt: '2026-04-28' },
]

export type Rdv = {
  id: string
  leadId: string
  date: string // ISO
  time: string
  duration: number // mn
  location: string
  type: 'visite' | 'audit' | 'closing' | 'visio'
  commercial: string
  setter: string
  status: 'a_venir' | 'honore' | 'no_show' | 'reporte'
  debriefDone: boolean
  outcome?: 'devis' | 'vendu' | 'a_relancer' | 'perdu'
}

export const RDVS: Rdv[] = [
  { id: 'r1', leadId: 'l1', date: '2026-05-06', time: '14:00', duration: 60, location: 'Saint-Denis', type: 'visite', commercial: 'Jean-Luc B.', setter: 'Sarah R.', status: 'a_venir', debriefDone: false },
  { id: 'r2', leadId: 'l6', date: '2026-05-06', time: '16:30', duration: 45, location: 'Saint-Denis', type: 'audit', commercial: 'Jean-Luc B.', setter: 'Karim B.', status: 'a_venir', debriefDone: false },
  { id: 'r3', leadId: 'l7', date: '2026-05-07', time: '10:00', duration: 60, location: 'Saint-Benoît', type: 'closing', commercial: 'Jean-Luc B.', setter: 'Karim B.', status: 'a_venir', debriefDone: false },
  { id: 'r4', leadId: 'l10', date: '2026-05-04', time: '15:00', duration: 60, location: 'Saint-André', type: 'visite', commercial: 'Jean-Luc B.', setter: 'Sarah R.', status: 'honore', debriefDone: true, outcome: 'devis' },
  { id: 'r5', leadId: 'l8', date: '2026-04-25', time: '11:00', duration: 90, location: 'Saint-Joseph', type: 'closing', commercial: 'Marie S.', setter: 'Sarah R.', status: 'honore', debriefDone: true, outcome: 'vendu' },
]

export type TeamMember = {
  id: string
  name: string
  role: 'admin' | 'setter' | 'commercial'
  initials: string
  tintClass: string
  ca?: string
  closing?: number
  rdvCount?: number
  ventes?: number
}

export const TEAM: TeamMember[] = [
  { id: 'jb', name: 'Jean-Luc B.', role: 'commercial', initials: 'JB', tintClass: 'bg-or-tint', ca: '210k€', closing: 42, rdvCount: 28, ventes: 12 },
  { id: 'sr', name: 'Sarah R.', role: 'setter', initials: 'SR', tintClass: 'bg-cuivre-tint', closing: 88, rdvCount: 62 },
  { id: 'ms', name: 'Marie S.', role: 'commercial', initials: 'MS', tintClass: 'bg-rouille-tint', ca: '155k€', closing: 35, rdvCount: 22, ventes: 8 },
  { id: 'kb', name: 'Karim B.', role: 'setter', initials: 'KB', tintClass: 'bg-info-tint', closing: 83, rdvCount: 48 },
  { id: 'ec', name: 'Estelle C.', role: 'setter', initials: 'EC', tintClass: 'bg-cuivre-tint', closing: 12, rdvCount: 18 },
]

export const NOTIFICATIONS = [
  { id: 'n1', type: 'rdv', title: 'Nouveau RDV pris', desc: 'Sarah R. a pris un RDV avec Pierre L. pour le 06/05 à 14h', time: 'il y a 12 min', read: false },
  { id: 'n2', type: 'lead', title: 'Lead chaud non rappelé', desc: 'Clara Dupont attend un retour depuis 2 jours', time: 'il y a 1h', read: false },
  { id: 'n3', type: 'debrief', title: 'Débrief manquant', desc: 'Jean-Luc B. n\'a pas debrieffé son RDV du 04/05 avec Léa P.', time: 'il y a 3h', read: false },
  { id: 'n4', type: 'sale', title: 'Vente signée', desc: 'Marie S. a clôturé la vente avec Estelle C. — 18.5k€', time: 'hier', read: true },
  { id: 'n5', type: 'team', title: 'Sous-performance détectée', desc: 'Estelle C. en dessous des objectifs ce mois (12% vs 25%)', time: 'hier', read: true },
]

export const CONVERSATIONS = [
  { id: 'c1', leadId: 'l1', name: 'Pierre L.', initials: 'PL', tintClass: 'bg-or-tint', lastMessage: 'Parfait, je suis dispo le 06 à 14h', lastTime: '14:32', unread: 0 },
  { id: 'c2', leadId: 'l2', name: 'Marc L.', initials: 'ML', tintClass: 'bg-cuivre-tint', lastMessage: 'Vous pouvez me rappeler après 17h ?', lastTime: '11:14', unread: 2 },
  { id: 'c3', leadId: 'l3', name: 'Clara D.', initials: 'CD', tintClass: 'bg-rouille-tint', lastMessage: 'Je dois en parler à mon mari', lastTime: 'hier', unread: 0 },
  { id: 'c4', leadId: 'l5', name: 'Mehdi A.', initials: 'MA', tintClass: 'bg-info-tint', lastMessage: 'Merci pour les infos', lastTime: 'lundi', unread: 0 },
]
