import { useMemo, useState, type DragEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { MockBanner } from '../components/MockBanner'
import { Icon, type IconName } from '../components/Icon'
import { useAuth } from '../lib/auth'

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'vt' | 'dp' | 'racco' | 'consuel' | 'installation' | 'mes'

type StepStatus =
  | 'a_faire'
  | 'planifie'
  | 'en_cours'
  | 'fait'
  | 'probleme'
  | 'en_attente'

type ProblemReason =
  | 'vt_client_absent'
  | 'vt_acces_toit_impossible'
  | 'dp_refusee'
  | 'dp_incomplete'
  | 'installation_stock_panneaux'
  | 'installation_stock_onduleur'
  | 'installation_acces_chantier'
  | 'installation_meteo'
  | 'consuel_non_valide'
  | 'autre'

type WorkflowStep = {
  phase: Phase
  status: StepStatus
  datePrevue?: string
  dateRealisee?: string
  deadline?: string
  responsable?: string
  notes?: string
  problemReason?: ProblemReason
  problemNotes?: string
}

type Client = {
  id: string
  nom: string
  ville: string
  postalCode: string
  phone: string
  signedAt: string
  montantTotal: number
  typeFinancement: 'comptant' | 'financement' | 'apport_financement'
  equipement: { panneaux: number; onduleur: string; batterie?: string }
  steps: Record<Phase, WorkflowStep>
  solteoProjectId?: string
}

type ClientStatus =
  | 'nouveau'
  | 'vt_a_faire'
  | 'administratif_en_cours'
  | 'installation_planifiee'
  | 'installe_en_attente_mes'
  | 'cloture'
  | 'bloque'
  | 'annule'

// ─── Constantes labels ────────────────────────────────────────────────────────

const PHASES: { id: Phase; label: string; short: string; icon: IconName }[] = [
  { id: 'vt', label: 'Visite Technique', short: 'VT', icon: 'home' },
  { id: 'dp', label: 'DP Mairie', short: 'DP', icon: 'shield' },
  { id: 'racco', label: 'Raccordement EDF', short: 'Racco', icon: 'target' },
  { id: 'consuel', label: 'Consuel', short: 'Consuel', icon: 'shield' },
  { id: 'installation', label: 'Installation', short: 'Pose', icon: 'users' },
  { id: 'mes', label: 'Mise en Service', short: 'MES', icon: 'bell' },
]

const PHASE_INDEX: Record<Phase, number> = PHASES.reduce((acc, p, i) => {
  acc[p.id] = i
  return acc
}, {} as Record<Phase, number>)

const STATUS_LABEL: Record<StepStatus, string> = {
  a_faire: 'À faire',
  planifie: 'Planifié',
  en_cours: 'En cours',
  fait: 'Fait',
  probleme: 'Problème',
  en_attente: 'En attente',
}

const PROBLEM_LABEL: Record<ProblemReason, string> = {
  vt_client_absent: 'Client absent',
  vt_acces_toit_impossible: 'Accès toit impossible',
  dp_refusee: 'DP refusée par la mairie',
  dp_incomplete: 'Dossier DP incomplet',
  installation_stock_panneaux: 'Stock panneaux insuffisant',
  installation_stock_onduleur: 'Stock onduleur insuffisant',
  installation_acces_chantier: 'Accès chantier bloqué',
  installation_meteo: 'Météo défavorable',
  consuel_non_valide: 'Consuel non validé',
  autre: 'Autre',
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const TODAY = new Date('2026-05-25')
const iso = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (n: number) => iso(new Date(TODAY.getTime() - n * 86400000))
const daysAhead = (n: number) => iso(new Date(TODAY.getTime() + n * 86400000))

const MOCK_CLIENTS: Client[] = [
  // Nouveau / VT à planifier
  {
    id: 'c1',
    nom: 'BOURGINE Étienne',
    ville: 'Saint-Denis',
    postalCode: '97400',
    phone: '+262 692 12 34 56',
    signedAt: daysAgo(2),
    montantTotal: 18900,
    typeFinancement: 'apport_financement',
    equipement: { panneaux: 12, onduleur: 'Huawei 6kW' },
    steps: {
      vt: { phase: 'vt', status: 'a_faire', deadline: daysAhead(12), responsable: 'Aurélien' },
      dp: { phase: 'dp', status: 'a_faire' },
      racco: { phase: 'racco', status: 'a_faire' },
      consuel: { phase: 'consuel', status: 'a_faire' },
      installation: { phase: 'installation', status: 'a_faire' },
      mes: { phase: 'mes', status: 'a_faire' },
    },
  },
  {
    id: 'c2',
    nom: 'PAYET Sandrine',
    ville: 'Saint-Pierre',
    postalCode: '97410',
    phone: '+262 692 22 11 88',
    signedAt: daysAgo(5),
    montantTotal: 24500,
    typeFinancement: 'comptant',
    equipement: { panneaux: 16, onduleur: 'Huawei 8kW', batterie: 'Pylontech 5kWh' },
    steps: {
      vt: { phase: 'vt', status: 'planifie', datePrevue: daysAhead(3), responsable: 'Aurélien', deadline: daysAhead(9) },
      dp: { phase: 'dp', status: 'a_faire' },
      racco: { phase: 'racco', status: 'a_faire' },
      consuel: { phase: 'consuel', status: 'a_faire' },
      installation: { phase: 'installation', status: 'a_faire' },
      mes: { phase: 'mes', status: 'a_faire' },
    },
  },
  // VT done → DP en cours
  {
    id: 'c3',
    nom: 'TECHER Jean-Marc',
    ville: 'Le Tampon',
    postalCode: '97430',
    phone: '+262 692 45 67 89',
    signedAt: daysAgo(28),
    montantTotal: 21200,
    typeFinancement: 'financement',
    equipement: { panneaux: 14, onduleur: 'Solis 6kW' },
    steps: {
      vt: { phase: 'vt', status: 'fait', dateRealisee: daysAgo(14), responsable: 'Aurélien', notes: 'Toit en bon état, exposition optimale Sud.' },
      dp: { phase: 'dp', status: 'en_cours', datePrevue: daysAgo(10), responsable: 'Ilanah', notes: 'Déposée en mairie Le Tampon, attente récépissé.' },
      racco: { phase: 'racco', status: 'a_faire' },
      consuel: { phase: 'consuel', status: 'a_faire' },
      installation: { phase: 'installation', status: 'a_faire' },
      mes: { phase: 'mes', status: 'a_faire' },
    },
    solteoProjectId: '9fabdb4e-4f5c-43f3-b8a4-0cb9a699e2b1',
  },
  // DP refusée — bloqué
  {
    id: 'c4',
    nom: 'GRONDIN Maximin',
    ville: 'Saint-Paul',
    postalCode: '97460',
    phone: '+262 692 78 90 12',
    signedAt: daysAgo(45),
    montantTotal: 19800,
    typeFinancement: 'comptant',
    equipement: { panneaux: 12, onduleur: 'Huawei 6kW' },
    steps: {
      vt: { phase: 'vt', status: 'fait', dateRealisee: daysAgo(30), responsable: 'Aurélien' },
      dp: {
        phase: 'dp',
        status: 'probleme',
        datePrevue: daysAgo(20),
        responsable: 'Ilanah',
        problemReason: 'dp_refusee',
        problemNotes: 'Refus mairie : zone classée monument historique, dossier ABF à constituer.',
      },
      racco: { phase: 'racco', status: 'a_faire' },
      consuel: { phase: 'consuel', status: 'a_faire' },
      installation: { phase: 'installation', status: 'a_faire' },
      mes: { phase: 'mes', status: 'a_faire' },
    },
    solteoProjectId: '332969a9-2faa-4fb9-811a-c4eb123782f8',
  },
  // DP validée → Racco en cours
  {
    id: 'c5',
    nom: 'AMAVASSY Léonce',
    ville: 'Saint-Louis',
    postalCode: '97450',
    phone: '+262 692 33 44 55',
    signedAt: daysAgo(60),
    montantTotal: 26700,
    typeFinancement: 'financement',
    equipement: { panneaux: 18, onduleur: 'Huawei 10kW', batterie: 'Pylontech 10kWh' },
    steps: {
      vt: { phase: 'vt', status: 'fait', dateRealisee: daysAgo(50) },
      dp: { phase: 'dp', status: 'fait', dateRealisee: daysAgo(10), responsable: 'Ilanah' },
      racco: { phase: 'racco', status: 'en_cours', datePrevue: daysAgo(8), responsable: 'Ilanah', notes: 'Demande envoyée EDF. Attente convention.' },
      consuel: { phase: 'consuel', status: 'a_faire' },
      installation: { phase: 'installation', status: 'a_faire' },
      mes: { phase: 'mes', status: 'a_faire' },
    },
    solteoProjectId: 'bfb1bad9-6a6b-4323-acd2-e744a68921c6',
  },
  // Installation planifiée
  {
    id: 'c6',
    nom: 'MOREL Sandrine',
    ville: 'Saint-Benoît',
    postalCode: '97470',
    phone: '+262 692 66 77 88',
    signedAt: daysAgo(75),
    montantTotal: 22300,
    typeFinancement: 'apport_financement',
    equipement: { panneaux: 14, onduleur: 'Solis 8kW' },
    steps: {
      vt: { phase: 'vt', status: 'fait', dateRealisee: daysAgo(60) },
      dp: { phase: 'dp', status: 'fait', dateRealisee: daysAgo(20) },
      racco: { phase: 'racco', status: 'en_cours', responsable: 'Ilanah' },
      consuel: { phase: 'consuel', status: 'a_faire' },
      installation: { phase: 'installation', status: 'planifie', datePrevue: daysAhead(7), responsable: 'Équipe Patrice' },
      mes: { phase: 'mes', status: 'a_faire' },
    },
    solteoProjectId: 'c3fca060-0e71-4f42-a866-a56018afe535',
  },
  // Installation en cours
  {
    id: 'c7',
    nom: 'CLAIN Teddy',
    ville: 'Saint-Paul',
    postalCode: '97460',
    phone: '+262 692 99 00 11',
    signedAt: daysAgo(80),
    montantTotal: 28100,
    typeFinancement: 'financement',
    equipement: { panneaux: 20, onduleur: 'Huawei 12kW', batterie: 'Pylontech 10kWh' },
    steps: {
      vt: { phase: 'vt', status: 'fait', dateRealisee: daysAgo(65) },
      dp: { phase: 'dp', status: 'fait', dateRealisee: daysAgo(25) },
      racco: { phase: 'racco', status: 'en_cours' },
      consuel: { phase: 'consuel', status: 'a_faire' },
      installation: { phase: 'installation', status: 'en_cours', datePrevue: daysAgo(1), responsable: 'Équipe Patrice', notes: 'Pose démarrée hier matin, 14 panneaux fixés.' },
      mes: { phase: 'mes', status: 'a_faire' },
    },
    solteoProjectId: 'd1ae539e-a593-4904-9a90-ec4c726ae1a9',
  },
  // Installation bloquée — stock
  {
    id: 'c8',
    nom: 'PITOU Frantz',
    ville: 'Saint-André',
    postalCode: '97440',
    phone: '+262 692 14 25 36',
    signedAt: daysAgo(95),
    montantTotal: 31500,
    typeFinancement: 'comptant',
    equipement: { panneaux: 22, onduleur: 'Huawei 12kW', batterie: 'Pylontech 15kWh' },
    steps: {
      vt: { phase: 'vt', status: 'fait', dateRealisee: daysAgo(80) },
      dp: { phase: 'dp', status: 'fait', dateRealisee: daysAgo(40) },
      racco: { phase: 'racco', status: 'fait', dateRealisee: daysAgo(15) },
      consuel: { phase: 'consuel', status: 'a_faire' },
      installation: {
        phase: 'installation',
        status: 'probleme',
        datePrevue: daysAgo(5),
        responsable: 'Équipe Patrice',
        problemReason: 'installation_stock_onduleur',
        problemNotes: 'Onduleur 12kW indisponible chez le fournisseur. ETA 10 jours.',
      },
      mes: { phase: 'mes', status: 'a_faire' },
    },
  },
  // Installé, en attente MES
  {
    id: 'c9',
    nom: 'BARRET Manon',
    ville: 'La Possession',
    postalCode: '97419',
    phone: '+262 692 47 58 69',
    signedAt: daysAgo(110),
    montantTotal: 19200,
    typeFinancement: 'comptant',
    equipement: { panneaux: 12, onduleur: 'Solis 6kW' },
    steps: {
      vt: { phase: 'vt', status: 'fait', dateRealisee: daysAgo(95) },
      dp: { phase: 'dp', status: 'fait', dateRealisee: daysAgo(55) },
      racco: { phase: 'racco', status: 'en_cours' },
      consuel: { phase: 'consuel', status: 'en_cours', responsable: 'Ilanah', notes: 'Attestation complétude envoyée 10 mai.' },
      installation: { phase: 'installation', status: 'fait', dateRealisee: daysAgo(7), responsable: 'Équipe Patrice' },
      mes: { phase: 'mes', status: 'a_faire', deadline: daysAhead(7) },
    },
  },
  // Clôturé
  {
    id: 'c10',
    nom: 'ROSSI Nadine',
    ville: 'Saint-Joseph',
    postalCode: '97480',
    phone: '+262 692 70 81 92',
    signedAt: daysAgo(140),
    montantTotal: 23800,
    typeFinancement: 'financement',
    equipement: { panneaux: 16, onduleur: 'Huawei 8kW', batterie: 'Pylontech 5kWh' },
    steps: {
      vt: { phase: 'vt', status: 'fait', dateRealisee: daysAgo(120) },
      dp: { phase: 'dp', status: 'fait', dateRealisee: daysAgo(80) },
      racco: { phase: 'racco', status: 'fait', dateRealisee: daysAgo(30) },
      consuel: { phase: 'consuel', status: 'fait', dateRealisee: daysAgo(25) },
      installation: { phase: 'installation', status: 'fait', dateRealisee: daysAgo(15) },
      mes: { phase: 'mes', status: 'fait', dateRealisee: daysAgo(5) },
    },
    solteoProjectId: 'bfb1bad9-6a6b-4323-acd2-e744a68921c6',
  },
  // VT en attente
  {
    id: 'c11',
    nom: 'HOAREAU Fabien',
    ville: 'Bras-Panon',
    postalCode: '97412',
    phone: '+262 692 88 77 66',
    signedAt: daysAgo(8),
    montantTotal: 17600,
    typeFinancement: 'comptant',
    equipement: { panneaux: 10, onduleur: 'Solis 5kW' },
    steps: {
      vt: {
        phase: 'vt',
        status: 'probleme',
        datePrevue: daysAgo(3),
        responsable: 'Aurélien',
        problemReason: 'vt_client_absent',
        problemNotes: 'Client absent du domicile, replanifier.',
      },
      dp: { phase: 'dp', status: 'a_faire' },
      racco: { phase: 'racco', status: 'a_faire' },
      consuel: { phase: 'consuel', status: 'a_faire' },
      installation: { phase: 'installation', status: 'a_faire' },
      mes: { phase: 'mes', status: 'a_faire' },
    },
  },
  // Consuel en cours
  {
    id: 'c12',
    nom: 'LATCHOUMANIN Bertrand',
    ville: 'Le Port',
    postalCode: '97420',
    phone: '+262 692 41 52 63',
    signedAt: daysAgo(115),
    montantTotal: 20400,
    typeFinancement: 'apport_financement',
    equipement: { panneaux: 14, onduleur: 'Huawei 8kW' },
    steps: {
      vt: { phase: 'vt', status: 'fait', dateRealisee: daysAgo(100) },
      dp: { phase: 'dp', status: 'fait', dateRealisee: daysAgo(60) },
      racco: { phase: 'racco', status: 'fait', dateRealisee: daysAgo(20) },
      consuel: { phase: 'consuel', status: 'en_cours', responsable: 'Ilanah', notes: 'Visite Consuel passée — attente attestation officielle.' },
      installation: { phase: 'installation', status: 'fait', dateRealisee: daysAgo(10) },
      mes: { phase: 'mes', status: 'a_faire', deadline: daysAhead(5) },
    },
    solteoProjectId: '300fe5e9-def9-493b-8375-d1c43a412093',
  },
]

// ─── Logique dérivation status (mirror backend SPEC) ──────────────────────────

function deriveClientStatus(client: Client): { statusGlobal: ClientStatus; currentPhase: Phase; blocked: boolean } {
  const steps = client.steps
  const allSteps = Object.values(steps)
  const blocked = allSteps.some((s) => s.status === 'probleme')
  const order: Phase[] = ['vt', 'dp', 'racco', 'consuel', 'installation', 'mes']
  const currentPhase = order.find((p) => steps[p].status !== 'fait') ?? 'mes'

  let statusGlobal: ClientStatus
  if (allSteps.every((s) => s.status === 'fait')) statusGlobal = 'cloture'
  else if (steps.installation.status === 'fait') statusGlobal = 'installe_en_attente_mes'
  else if (steps.installation.status === 'planifie') statusGlobal = 'installation_planifiee'
  else if (blocked) statusGlobal = 'bloque'
  else if (steps.vt.status === 'fait') statusGlobal = 'administratif_en_cours'
  else if (steps.vt.status === 'a_faire' || steps.vt.status === 'planifie') statusGlobal = 'vt_a_faire'
  else statusGlobal = 'nouveau'

  return { statusGlobal, currentPhase, blocked }
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function Delivrabilite() {
  const role = useAuth((s) => s.user?.role)
  const [search, setSearch] = useState('')
  const [responsableFilter, setResponsableFilter] = useState<string>('tous')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draggedClientId, setDraggedClientId] = useState<string | null>(null)
  const [optimisticMoves, setOptimisticMoves] = useState<Record<string, Phase>>({})

  const clients = useMemo(() => MOCK_CLIENTS.map((c) => ({ ...c, ...deriveClientStatus(c) })), [])

  // Filter
  const filtered = useMemo(() => {
    return clients.filter((c) => {
      if (search) {
        const q = search.toLowerCase()
        const hay = `${c.nom} ${c.ville} ${c.postalCode}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (responsableFilter !== 'tous') {
        const someStepMatches = Object.values(c.steps).some((s) => s.responsable === responsableFilter)
        if (!someStepMatches) return false
      }
      return true
    })
  }, [clients, search, responsableFilter])

  const responsables = useMemo(() => {
    const set = new Set<string>()
    MOCK_CLIENTS.forEach((c) => {
      Object.values(c.steps).forEach((s) => s.responsable && set.add(s.responsable))
    })
    return Array.from(set).sort()
  }, [])

  // KPIs
  const kpis = useMemo(() => {
    const actifs = clients.filter((c) => c.statusGlobal !== 'cloture' && c.statusGlobal !== 'annule')
    const bloques = clients.filter((c) => c.blocked)
    const installSemaine = clients.filter((c) => {
      const d = c.steps.installation.datePrevue
      if (!d) return false
      const diff = (new Date(d).getTime() - TODAY.getTime()) / 86400000
      return diff >= 0 && diff <= 7 && c.steps.installation.status === 'planifie'
    })
    const clotureCeMois = clients.filter((c) => c.statusGlobal === 'cloture')
    return {
      actifs: actifs.length,
      bloques: bloques.length,
      installSemaine: installSemaine.length,
      clotureCeMois: clotureCeMois.length,
    }
  }, [clients])

  // Urgences (steps en probleme depuis > 5 jours, simulé)
  const urgences = useMemo(() => {
    const list: { client: Client & { statusGlobal: ClientStatus }; phase: Phase; step: WorkflowStep; daysOpen: number }[] = []
    clients.forEach((c) => {
      Object.values(c.steps).forEach((s) => {
        if (s.status === 'probleme') {
          const ref = s.datePrevue ?? c.signedAt
          const daysOpen = Math.floor((TODAY.getTime() - new Date(ref).getTime()) / 86400000)
          list.push({ client: c, phase: s.phase, step: s, daysOpen })
        }
      })
    })
    return list.sort((a, b) => b.daysOpen - a.daysOpen)
  }, [clients])

  // Cards groupées par phase (avec optimistic moves)
  const cardsByPhase = useMemo(() => {
    const m = new Map<Phase, (typeof clients)[number][]>()
    PHASES.forEach((p) => m.set(p.id, []))
    filtered.forEach((c) => {
      const effectivePhase = optimisticMoves[c.id] ?? c.currentPhase
      m.get(effectivePhase)?.push(c)
    })
    return m
  }, [filtered, optimisticMoves])

  // Drop handler
  const handleDrop = (e: DragEvent<HTMLDivElement>, targetPhase: Phase) => {
    e.preventDefault()
    const clientId = e.dataTransfer.getData('text/client-id') || draggedClientId
    setDraggedClientId(null)
    if (!clientId) return
    const client = clients.find((c) => c.id === clientId)
    if (!client) return
    const currentPhase = optimisticMoves[clientId] ?? client.currentPhase
    if (currentPhase === targetPhase) return
    setOptimisticMoves((prev) => ({ ...prev, [clientId]: targetPhase }))
  }

  const selectedClient = selectedId ? clients.find((c) => c.id === selectedId) ?? null : null

  if (role && role !== 'admin' && role !== 'delivrabilite') {
    return <Navigate to="/overview" replace />
  }

  return (
    <AppShell flat>
      <Topbar eyebrow="DÉLIVRABILITÉ" title="Pipeline post-signature" />

      <MockBanner reason="Données de démonstration · Backend Lot 2 en cours d'implémentation." />

      <main className="px-4 sm:px-8 pt-4 pb-8 flex flex-col gap-3 overflow-y-auto flex-grow">
        {/* KPIs */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
          <KpiCard
            label="Dossiers actifs"
            value={`${kpis.actifs}`}
            hint="VT → MES en cours"
            tint="info"
            icon="users"
          />
          <KpiCard
            label="Bloqués"
            value={`${kpis.bloques}`}
            hint={kpis.bloques ? 'Nécessite intervention' : 'Aucun blocage'}
            tint={kpis.bloques ? 'rouille' : 'success'}
            icon="shield"
          />
          <KpiCard
            label="Installations sem."
            value={`${kpis.installSemaine}`}
            hint="Planifiées d'ici 7 jours"
            tint="or"
            icon="calendar"
          />
          <KpiCard
            label="Clôturés"
            value={`${kpis.clotureCeMois}`}
            hint="MES validée"
            tint="success"
            icon="target"
          />
        </section>

        {/* Urgences */}
        {urgences.length > 0 && (
          <section className="glass-card bg-white border border-line-soft px-4 py-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex w-2 h-2 rounded-full bg-rouille animate-pulse" aria-hidden />
                <span className="eyebrow text-[10px]">URGENCES</span>
                <h3 className="text-sm font-black">Blocages à traiter</h3>
              </div>
              <span className="rounded-full border border-line-soft bg-rouille-tint px-2.5 py-1 text-[11px] font-bold text-rouille whitespace-nowrap">
                {urgences.length} dossier{urgences.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {urgences.map(({ client, phase, step, daysOpen }) => (
                <button
                  key={`${client.id}-${phase}`}
                  type="button"
                  onClick={() => setSelectedId(client.id)}
                  className="flex-shrink-0 w-[280px] text-left rounded-[14px] border border-rouille/30 bg-rouille-tint/40 px-3 py-2 hover:bg-rouille-tint transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-black text-sm truncate">{client.nom}</p>
                      <p className="text-[11px] text-muted truncate">{client.ville} · {PHASES.find((p) => p.id === phase)?.label}</p>
                    </div>
                    <span className="rounded-full bg-rouille text-white px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap flex-shrink-0">
                      {daysOpen}j
                    </span>
                  </div>
                  {step.problemReason && (
                    <p className="mt-1.5 text-[11px] font-semibold text-rouille">
                      {PROBLEM_LABEL[step.problemReason]}
                    </p>
                  )}
                  {step.problemNotes && (
                    <p className="mt-1 text-[11px] text-muted line-clamp-2">{step.problemNotes}</p>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Filter bar */}
        <section className="glass-card bg-white border border-line-soft px-4 py-2.5 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Icon name="users" size={14} className="text-faint flex-shrink-0" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un client, ville, CP…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] eyebrow text-faint">Responsable</span>
            <select
              value={responsableFilter}
              onChange={(e) => setResponsableFilter(e.target.value)}
              className="text-xs rounded-md border border-line-soft bg-white px-2 py-1 outline-none focus:border-or"
            >
              <option value="tous">Tous</option>
              {responsables.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <span className="text-[11px] text-muted whitespace-nowrap">
            {filtered.length} / {clients.length} dossier{clients.length > 1 ? 's' : ''}
          </span>
        </section>

        {/* Kanban Pipeline */}
        <section className="glass-card bg-white border border-line-soft px-4 py-3 flex-grow flex flex-col min-h-0">
          <div className="flex items-center justify-between gap-3 mb-3 flex-shrink-0">
            <div>
              <span className="eyebrow text-[10px]">PIPELINE</span>
              <h3 className="text-base font-black leading-tight">VT → Mise en service</h3>
              <p className="text-[11px] text-muted mt-0.5">Glisse un dossier pour le faire avancer (mock — pas de persistance).</p>
            </div>
            <span className="rounded-full border border-line-soft bg-info-tint px-2.5 py-1 text-[11px] font-bold text-info whitespace-nowrap">
              {clients.length} dossiers actifs
            </span>
          </div>

          <div className="overflow-x-auto overflow-y-hidden flex-grow min-h-0 pb-1">
            <div className="flex gap-3 min-w-max h-full items-stretch">
              {PHASES.map((p, i) => {
                const cards = cardsByPhase.get(p.id) ?? []
                return (
                  <PhaseColumn
                    key={p.id}
                    phase={p}
                    index={i}
                    cards={cards}
                    onDragStart={(id) => setDraggedClientId(id)}
                    onDrop={(e) => handleDrop(e, p.id)}
                    onCardClick={(id) => setSelectedId(id)}
                  />
                )
              })}
            </div>
          </div>
        </section>
      </main>

      {/* Drawer fiche client */}
      {selectedClient && (
        <ClientDrawer client={selectedClient} onClose={() => setSelectedId(null)} />
      )}
    </AppShell>
  )
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  hint,
  tint,
  icon,
}: {
  label: string
  value: string
  hint?: string
  tint: 'info' | 'or' | 'rouille' | 'success'
  icon: IconName
}) {
  const tintMap = {
    info: 'bg-info-tint text-info',
    or: 'bg-or-tint text-or-dark',
    rouille: 'bg-rouille-tint text-rouille',
    success: 'bg-success-tint text-success',
  } as const

  return (
    <div className="glass-card px-4 py-3 border border-line-soft bg-white flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="eyebrow mb-1 text-[10px]">{label}</p>
        <p className="text-lg font-black leading-tight">{value}</p>
        {hint && <p className="text-[11px] text-muted mt-0.5 truncate">{hint}</p>}
      </div>
      <div className={`w-9 h-9 rounded-full flex items-center justify-center ${tintMap[tint]} flex-shrink-0`}>
        <Icon name={icon} size={16} />
      </div>
    </div>
  )
}

function PhaseColumn({
  phase,
  index,
  cards,
  onDragStart,
  onDrop,
  onCardClick,
}: {
  phase: typeof PHASES[number]
  index: number
  cards: (Client & { statusGlobal: ClientStatus; currentPhase: Phase; blocked: boolean })[]
  onDragStart: (id: string) => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
  onCardClick: (id: string) => void
}) {
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="w-[270px] rounded-[18px] border border-line-soft bg-cream/45 p-2.5 flex flex-col min-h-0"
    >
      <div className="bg-white rounded-[14px] border border-line-soft p-2.5 mb-2 flex-shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-black text-faint">0{index + 1}</span>
              <h4 className="font-black text-xs leading-snug truncate">{phase.label}</h4>
            </div>
            <p className="text-[10px] text-muted mt-0.5 truncate">{phase.short}</p>
          </div>
          <span className="rounded-full border border-line-soft px-1.5 py-0.5 text-[10px] font-bold text-muted flex-shrink-0">
            {cards.length}
          </span>
        </div>
      </div>
      <div className="space-y-1.5 overflow-y-auto pr-1 flex-grow min-h-0">
        {cards.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-line-soft bg-white/70 p-4 text-center text-[11px] text-faint">
            Aucun dossier
          </div>
        ) : (
          cards.map((c) => (
            <ClientCard
              key={c.id}
              client={c}
              phase={phase.id}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/client-id', c.id)
                onDragStart(c.id)
              }}
              onClick={() => onCardClick(c.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function ClientCard({
  client,
  phase,
  onDragStart,
  onClick,
}: {
  client: Client & { statusGlobal: ClientStatus; currentPhase: Phase; blocked: boolean }
  phase: Phase
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onClick: () => void
}) {
  const step = client.steps[phase]
  const isBlocked = step.status === 'probleme'
  const tone = statusTone(step.status)
  const deadline = step.deadline
  const deadlineLate = deadline && new Date(deadline).getTime() < TODAY.getTime()

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={`rounded-[14px] border bg-white p-3 shadow-sm transition cursor-grab active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-md ${
        isBlocked ? 'border-rouille/40 bg-rouille-tint/30' : 'border-line-soft'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-black text-sm truncate">{client.nom}</p>
          <p className="text-[11px] text-muted truncate">{client.postalCode} · {client.ville}</p>
        </div>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap flex-shrink-0 ${tone.badge}`}>
          {STATUS_LABEL[step.status]}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-[11px] text-muted">
        {step.responsable && (
          <div className="flex items-center gap-1.5">
            <Icon name="users" size={11} className="text-faint flex-shrink-0" />
            <span className="truncate">{step.responsable}</span>
          </div>
        )}
        {(step.datePrevue || step.dateRealisee) && (
          <div className="flex items-center gap-1.5">
            <Icon name="calendar" size={11} className="text-faint flex-shrink-0" />
            <span className="truncate">
              {step.dateRealisee ? `Fait le ${formatShortDate(step.dateRealisee)}` : `Prévu le ${formatShortDate(step.datePrevue!)}`}
            </span>
          </div>
        )}
        {deadline && step.status !== 'fait' && (
          <div className={`flex items-center gap-1.5 ${deadlineLate ? 'text-rouille font-semibold' : ''}`}>
            <Icon name="bell" size={11} className="flex-shrink-0" />
            <span className="truncate">
              {deadlineLate ? `Deadline dépassée (${formatShortDate(deadline)})` : `Deadline ${formatShortDate(deadline)}`}
            </span>
          </div>
        )}
      </div>
      {isBlocked && step.problemReason && (
        <div className="mt-2 rounded-md bg-white/80 border border-rouille/30 px-2 py-1.5">
          <p className="text-[10px] font-black text-rouille uppercase tracking-wide">Blocage</p>
          <p className="text-[11px] text-rouille mt-0.5">{PROBLEM_LABEL[step.problemReason]}</p>
        </div>
      )}
      <div className="mt-2 pt-2 border-t border-line-soft/60 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-faint">{formatCurrency(client.montantTotal)}</span>
        <span className={`font-semibold ${client.blocked ? 'text-rouille' : 'text-muted'}`}>
          {client.blocked ? '⚠ bloqué' : `Étape ${PHASE_INDEX[client.currentPhase] + 1}/6`}
        </span>
      </div>
    </div>
  )
}

function ClientDrawer({
  client,
  onClose,
}: {
  client: Client & { statusGlobal: ClientStatus; currentPhase: Phase; blocked: boolean }
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
      />
      <aside className="relative w-full sm:w-[480px] max-w-full h-full bg-white shadow-2xl border-l border-line-soft overflow-y-auto">
        <header className="sticky top-0 bg-white border-b border-line-soft px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <p className="eyebrow text-[10px]">FICHE DOSSIER</p>
            <h2 className="text-lg font-black truncate">{client.nom}</h2>
            <p className="text-[11px] text-muted mt-0.5">{client.postalCode} · {client.ville} · {client.phone}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-cream/60 hover:bg-cream flex items-center justify-center text-muted text-lg flex-shrink-0"
            aria-label="Fermer"
          >
            ×
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          {/* Status global */}
          <section className="grid grid-cols-3 gap-2">
            <div className="rounded-[14px] border border-line-soft bg-cream/40 px-3 py-2">
              <p className="text-[9px] eyebrow text-faint">Montant</p>
              <p className="text-sm font-black mt-0.5">{formatCurrency(client.montantTotal)}</p>
            </div>
            <div className="rounded-[14px] border border-line-soft bg-cream/40 px-3 py-2">
              <p className="text-[9px] eyebrow text-faint">Financement</p>
              <p className="text-[11px] font-bold mt-0.5">{financementLabel(client.typeFinancement)}</p>
            </div>
            <div className="rounded-[14px] border border-line-soft bg-cream/40 px-3 py-2">
              <p className="text-[9px] eyebrow text-faint">Signé le</p>
              <p className="text-[11px] font-bold mt-0.5">{formatShortDate(client.signedAt)}</p>
            </div>
          </section>

          {/* Équipement */}
          <section>
            <p className="eyebrow text-[10px] mb-2">ÉQUIPEMENT</p>
            <div className="space-y-1 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-muted">Panneaux</span>
                <span className="font-bold">{client.equipement.panneaux}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Onduleur</span>
                <span className="font-bold">{client.equipement.onduleur}</span>
              </div>
              {client.equipement.batterie && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">Batterie</span>
                  <span className="font-bold">{client.equipement.batterie}</span>
                </div>
              )}
            </div>
          </section>

          {/* Solteo */}
          {client.solteoProjectId && (
            <section className="rounded-[14px] border border-info/30 bg-info-tint/40 px-3 py-2">
              <p className="text-[9px] eyebrow text-info">SOLTEO</p>
              <p className="text-[11px] font-mono mt-0.5 truncate">{client.solteoProjectId}</p>
            </section>
          )}

          {/* Timeline phases */}
          <section>
            <p className="eyebrow text-[10px] mb-2">PIPELINE</p>
            <div className="space-y-2">
              {PHASES.map((p, i) => {
                const step = client.steps[p.id]
                const tone = statusTone(step.status)
                const isCurrent = client.currentPhase === p.id
                return (
                  <div
                    key={p.id}
                    className={`rounded-[14px] border px-3 py-2.5 ${
                      step.status === 'probleme'
                        ? 'border-rouille/40 bg-rouille-tint/30'
                        : isCurrent
                        ? 'border-or/40 bg-or-tint/30'
                        : 'border-line-soft bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${
                          step.status === 'fait' ? 'bg-success text-white' : 'bg-cream text-faint'
                        }`}>
                          {step.status === 'fait' ? '✓' : i + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="font-black text-xs truncate">{p.label}</p>
                          {step.responsable && (
                            <p className="text-[10px] text-muted truncate">{step.responsable}</p>
                          )}
                        </div>
                      </div>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold flex-shrink-0 ${tone.badge}`}>
                        {STATUS_LABEL[step.status]}
                      </span>
                    </div>
                    {(step.datePrevue || step.dateRealisee || step.deadline) && (
                      <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px]">
                        <DateMini label="Prévu" value={step.datePrevue} />
                        <DateMini label="Réalisé" value={step.dateRealisee} />
                        <DateMini label="Deadline" value={step.deadline} />
                      </div>
                    )}
                    {step.notes && (
                      <p className="mt-1.5 text-[11px] text-muted bg-white/60 rounded-md px-2 py-1.5">
                        {step.notes}
                      </p>
                    )}
                    {step.status === 'probleme' && step.problemReason && (
                      <div className="mt-1.5 bg-white border border-rouille/30 rounded-md px-2 py-1.5">
                        <p className="text-[10px] font-black text-rouille uppercase">Blocage</p>
                        <p className="text-[11px] font-semibold text-rouille mt-0.5">{PROBLEM_LABEL[step.problemReason]}</p>
                        {step.problemNotes && (
                          <p className="text-[11px] text-muted mt-1">{step.problemNotes}</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* Actions (mock) */}
          <section className="flex flex-wrap gap-2 pt-2 border-t border-line-soft">
            <button className="flex-1 min-w-[120px] rounded-[12px] bg-or text-white px-3 py-2 text-xs font-black hover:bg-or-dark transition">
              Avancer phase
            </button>
            <button className="flex-1 min-w-[120px] rounded-[12px] border border-line-soft bg-white px-3 py-2 text-xs font-black hover:bg-cream transition">
              Déclarer blocage
            </button>
          </section>
        </div>
      </aside>
    </div>
  )
}

function DateMini({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-md bg-white/70 border border-line-soft/60 px-1.5 py-1 text-center">
      <p className="text-[9px] uppercase tracking-wide text-faint">{label}</p>
      <p className="text-[10px] font-bold truncate">{value ? formatShortDate(value) : '—'}</p>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusTone(status: StepStatus) {
  switch (status) {
    case 'fait':
      return { badge: 'bg-success-tint text-success' }
    case 'en_cours':
      return { badge: 'bg-or-tint text-or-dark' }
    case 'planifie':
      return { badge: 'bg-info-tint text-info' }
    case 'probleme':
      return { badge: 'bg-rouille text-white' }
    case 'en_attente':
      return { badge: 'bg-cream text-faint' }
    case 'a_faire':
    default:
      return { badge: 'bg-cream text-muted' }
  }
}

function financementLabel(t: Client['typeFinancement']): string {
  if (t === 'comptant') return 'Comptant'
  if (t === 'financement') return 'Financement'
  return 'Apport + Fin.'
}

function formatCurrency(value: number): string {
  return value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
