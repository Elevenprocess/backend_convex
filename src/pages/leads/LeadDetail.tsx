import { useMemo, useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon, type IconName } from '../../components/Icon'
import { LoadingScreen } from '../../components/Spinner'
import { useLead, useRdvList, useCallLogs, useUsers, useStartCall } from '../../lib/hooks'
import {
  PROJECT_STATUS_LABEL,
  STATUS_BADGE,
  STATUS_LABEL,
  DELIVRABILITE_STATUS_LABEL,
  DELIVRABILITE_STATUS_BADGE,
  CALL_RESULT_LABEL,
  fullName,
  initials as leadInitials,
  type LeadResponse,
  type RdvResponse,
  type CallLogResponse,
  type UserResponse,
  type ProjectResponse,
  type DebriefResponse,
} from '../../lib/types'
import { ApiError, createProject, listProjectsByLead, listDebriefsByLead, createLeadDebrief, deleteDebrief } from '../../lib/api'
import { clientStatusBadge } from '../../lib/clientStatus'
import { Spinner } from '../../components/Spinner'
import { useAuth } from '../../lib/auth'
import { leadListPath } from '../../lib/leadPaths'
import { CommercialDebriefSidebar } from '../../components/leads/CommercialDebriefSidebar'
import { DebriefRow } from '../../components/leads/project/ProjectDebriefsTab'
import { AssignCommercialModal } from '../../components/leads/AssignCommercialModal'
import { CollapsibleSection } from '../../components/CollapsibleSection'

type TimelineItem = {
  icon: IconName
  iconBg: string
  iconColor: string
  title: string
  date: string
  desc?: string
}

// Corps d'un débrief tel que produit par CommercialDebriefSidebar (sans RDV).
type DebriefDraft = Parameters<typeof createLeadDebrief>[1]

export function LeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const startCall = useStartCall()
  const role = useAuth((s) => s.user?.role)
  const listPath = leadListPath(role)

  const { data: lead, loading, error } = useLead(id)
  const { data: rdvs } = useRdvList(id ? { leadId: id, limit: 50 } : undefined)
  const { data: calls } = useCallLogs(id ? { leadId: id, limit: 50 } : undefined)
  const { data: users } = useUsers()

  const userMap = useMemo(() => {
    const m = new Map<string, UserResponse>()
    for (const u of users ?? []) m.set(u.id, u)
    return m
  }, [users])

  const [projects, setProjects] = useState<ProjectResponse[]>([])
  const [debriefs, setDebriefs] = useState<DebriefResponse[]>([])
  const [debriefRefreshKey, setDebriefRefreshKey] = useState(0)
  const [debriefOpen, setDebriefOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  // Attribution d'un débrief NON-VENTE fait depuis la fiche (sans RDV) quand ≥2
  // projets existent : payload en attente + sélecteur de projet. La vente ne passe
  // plus par là (création/réutilisation auto, cf. resolveVenteProject).
  const [pendingDebrief, setPendingDebrief] = useState<{ payload: DebriefDraft; outcome: 'non_vente' } | null>(null)
  const [attributionMode, setAttributionMode] = useState<null | 'non_vente'>(null)
  useEffect(() => {
    if (!id) return
    void listProjectsByLead(id).then(setProjects).catch(() => undefined)
  }, [id])
  useEffect(() => {
    if (!id) return
    void listDebriefsByLead(id).then(setDebriefs).catch(() => undefined)
  }, [id, debriefRefreshKey])

  async function handleDeleteDebrief(debriefId: string) {
    if (!window.confirm('Supprimer ce débrief ?')) return
    try {
      await deleteDebrief(debriefId)
      setDebriefRefreshKey((k) => k + 1)
    } catch {
      /* noop */
    }
  }

  async function saveDebrief(input: DebriefDraft) {
    if (!id) return
    try {
      await createLeadDebrief(id, input)
      setDebriefRefreshKey((k) => k + 1)
    } catch (e) {
      alert(e instanceof Error ? e.message : "Échec de l'enregistrement du débrief")
    }
  }

  // Résout le projet cible d'une vente puis le retourne (la redirection est faite
  // par l'appelant). 0 projet → création ; 1 → réutilisation ; ≥2 → nouveau projet.
  // L'adresse n'est pas fournie : le backend reprend celle du lead.
  async function resolveVenteProject(): Promise<ProjectResponse | null> {
    if (!lead) return null
    if (projects.length === 1) return projects[0]
    try {
      const created = await createProject({ leadId: lead.id, name: `Projet ${fullName(lead)}` })
      setProjects((prev) => [created, ...prev])
      return created
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Échec de la création du projet')
      return null
    }
  }

  // Débrief fait depuis la fiche (sans RDV) → décision d'attribution :
  //  non-vente : 0 projet → lead-level ; 1 → ce projet ; ≥2 → sélecteur
  //  vente     : création/réutilisation auto du projet + rattachement + redirection
  function handleFicheDebrief(payload: DebriefDraft, outcome: 'vente' | 'non_vente') {
    setDebriefOpen(false)
    if (outcome === 'non_vente') {
      if (projects.length === 0) {
        void saveDebrief({ ...payload, projectId: null })
      } else if (projects.length === 1) {
        void saveDebrief({ ...payload, projectId: projects[0].id })
      } else {
        setPendingDebrief({ payload, outcome })
        setAttributionMode('non_vente')
      }
      return
    }
    // vente : création/réutilisation auto du projet + rattachement + redirection
    void (async () => {
      const project = await resolveVenteProject()
      if (!project) return
      await saveDebrief({ ...payload, projectId: project.id })
      navigate(`/projects/${project.id}`)
    })()
  }

  if (loading) {
    return (
      <AppShell>
        <Topbar eyebrow="LEADS / DÉTAIL" title="Chargement…" />
        <LoadingScreen label="Chargement du lead…" />
      </AppShell>
    )
  }

  if (error || !lead) {
    return (
      <AppShell>
        <Topbar eyebrow="LEADS / DÉTAIL" title="Lead introuvable" />
        <main className="p-8 flex items-center justify-center flex-grow">
          <div className="glass-card p-12 text-center">
            <p className="text-muted mb-4">{error ?? "Ce lead n'existe pas (ou plus)."}</p>
            <Link to={listPath} className="btn-primary inline-block px-4 py-2 rounded-xl text-sm">Retour à la liste</Link>
          </div>
        </main>
      </AppShell>
    )
  }

  const setter = lead.setterId ? userMap.get(lead.setterId) : undefined
  const commercial = lead.assignedToId ? userMap.get(lead.assignedToId) : undefined

  // Côté commercial, la fiche est ouverte comme « client » : on n'affiche jamais le
  // statut setter brut (« Sans réponse »…), seulement la terminologie commerciale.
  // Côté setter/admin (pages leads), on garde le statut setter d'origine.
  const isCommercialView = role === 'commercial' || role === 'commercial_lead'
  // Seuls le responsable commercial et l'admin peuvent donner/réattribuer un client.
  const isManager = role === 'commercial_lead' || role === 'admin'
  const teamCommerciaux = (users ?? []).filter(
    (u) => (u.role === 'commercial' || u.role === 'commercial_lead') && u.active,
  )
  const statusBadge = isCommercialView
    ? clientStatusBadge(lead)
    : lead.delivrabiliteStatus
      ? { label: DELIVRABILITE_STATUS_LABEL[lead.delivrabiliteStatus], className: DELIVRABILITE_STATUS_BADGE[lead.delivrabiliteStatus] }
      : { label: STATUS_LABEL[lead.status], className: STATUS_BADGE[lead.status] }

  const timeline = buildTimeline(rdvs ?? [], calls ?? [], userMap)

  return (
    <AppShell>
      <Topbar
        eyebrow="LEADS / DÉTAIL"
        title={fullName(lead)}
      />
      <div className="px-4 sm:px-6 md:px-8 pt-3 sm:pt-4 flex items-center gap-2 flex-shrink-0 flex-wrap">
        <button
          onClick={() => navigate(listPath)}
          className="text-muted hover:text-text flex items-center gap-1 text-sm shrink-0"
        >
          <Icon name="arrow-left" size={16} />
          <span className="hidden sm:inline">Retour</span>
        </button>
        <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
          <button className="hidden md:flex px-3 py-2 rounded-[14px] text-sm font-semibold border border-line bg-white items-center gap-2">
            <Icon name="mail" size={14} />
            <span className="hidden lg:inline">Email</span>
          </button>
          <button className="hidden md:flex px-3 py-2 rounded-[14px] text-sm font-semibold border border-line bg-white items-center gap-2">
            <Icon name="edit" size={14} />
            <span className="hidden lg:inline">Note</span>
          </button>
          <button
            onClick={() => setDebriefOpen(true)}
            title="Débrief structuré sur RDV planifié (wizard)"
            className="px-3 sm:px-4 py-2 rounded-[14px] text-xs sm:text-sm font-semibold border border-or text-or-dark bg-or/10 hover:bg-or/20 flex items-center gap-2 whitespace-nowrap"
          >
            <Icon name="phone" size={12} />
            Débrief RDV
          </button>
          <button
            onClick={() => {
              if (!lead.phone) return
              startCall({ leadId: lead.id, leadName: fullName(lead), toNumber: lead.phone }).catch((e) => {
                console.error('Phone copy failed', e)
                alert(e instanceof Error ? e.message : 'Impossible de copier le numéro')
              })
            }}
            disabled={!lead.phone}
            className="btn-primary px-3 sm:px-5 py-2 rounded-[14px] text-xs sm:text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <Icon name="phone" size={14} />
            Appeler
          </button>
        </div>
      </div>

      <main className="p-3 sm:p-6 md:p-8 pt-3 sm:pt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 overflow-y-auto flex-grow">
        {/* Left col */}
        <div className="lg:col-span-1 space-y-4 lg:space-y-6">
          <div className="glass-card p-6 text-center">
            <div className="w-24 h-24 rounded-full bg-cuivre-tint flex items-center justify-center text-3xl font-bold mx-auto mb-4">{leadInitials(lead)}</div>
            <h3 className="text-xl font-bold">{fullName(lead)}</h3>
            <span className={`status-badge ${statusBadge.className} mt-2 inline-block`}>{statusBadge.label}</span>
            <div className="mt-4 space-y-2 text-sm text-muted">
              {lead.phone && <div className="flex items-center justify-center gap-2"><Icon name="phone" size={14} /> {lead.phone}</div>}
              {lead.email && <div className="flex items-center justify-center gap-2"><Icon name="mail" size={14} /> {lead.email}</div>}
              {fullAddress(lead) && (
                <div className="flex items-start justify-center gap-2">
                  <Icon name="map-pin" size={14} className="mt-0.5 shrink-0" />
                  <span>{fullAddress(lead)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="glass-card p-6">
            <span className="eyebrow block mb-3">ATTRIBUTION</span>
            <div className="space-y-3 text-sm">
              <Row label="Setter">
                {setter
                  ? <PersonChip name={setter.name} tint="bg-cuivre-tint" />
                  : <span className="text-faint">Non assigné</span>}
              </Row>
              <Row label="Commercial">
                <div className="flex items-center justify-end gap-2">
                  {commercial
                    ? <PersonChip name={commercial.name} tint="bg-or-tint" />
                    : <span className="text-faint">Non assigné</span>}
                  {isManager && (
                    <button
                      type="button"
                      onClick={() => setAssignOpen(true)}
                      title="Donner ce client à un commercial"
                      className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-[10px] font-bold text-muted hover:border-or hover:text-or-dark"
                    >
                      <Icon name="users" size={12} />
                      {commercial ? 'Réattribuer' : 'Donner à…'}
                    </button>
                  )}
                </div>
              </Row>
              <Row label="Source"><span className="font-semibold">{prettySource(lead)}</span></Row>
              {lead.utmSource && <Row label="UTM"><span className="font-mono text-xs">{lead.utmSource}</span></Row>}
              <Row label="Créé le"><span className="font-semibold">{formatDate(lead.createdAt)}</span></Row>
              <Row label="Dernier contact"><span className="font-semibold">{lastContactLabel(lead.joursSansContact)}</span></Row>
            </div>
          </div>

          {lead.customFields && lead.customFields.length > 0 && (
            <div className="glass-card p-6">
              <span className="eyebrow block mb-3">DONNÉES FORMULAIRE / SETTER</span>
              <div className="space-y-3 text-sm">
                {lead.customFields.map((field) => (
                  <div key={`${field.fieldKey}-${field.fieldName}`} className="flex flex-col gap-0.5">
                    <span className="text-faint text-xs">{field.fieldName || field.fieldKey}</span>
                    <span className="font-semibold break-words">{field.value?.trim() ? field.value : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="glass-card p-6">
            <CreateProjectInline
              lead={lead}
              projects={projects}
              onCreated={(p) => { setProjects((prev) => [p, ...prev]); navigate(`/projects/${p.id}`) }}
              onOpenProject={(p) => navigate(`/projects/${p.id}`)}
            />
          </div>
        </div>

        {/* Right col */}
        <div className="lg:col-span-2 space-y-4 lg:space-y-6">
          <div className="glass-card p-6">
            <CollapsibleSection title="Historique" storageKey="lead.historique" defaultCollapsed>
              {timeline.length === 0 ? (
                <p className="text-sm text-faint">Aucun événement enregistré pour ce lead.</p>
              ) : (
                <div className="space-y-4">
                  {timeline.map((t, i) => (
                    <div key={i} className="flex gap-3">
                      <div className={`w-8 h-8 rounded-full ${t.iconBg} flex items-center justify-center shrink-0`}>
                        <Icon name={t.icon} size={14} className={t.iconColor} />
                      </div>
                      <div className="flex-grow">
                        <div className="flex justify-between gap-3">
                          <span className="font-semibold text-sm">{t.title}</span>
                          <span className="text-xs text-faint shrink-0">{t.date}</span>
                        </div>
                        {t.desc && <p className="text-xs text-muted mt-1">{t.desc}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CollapsibleSection>
          </div>

          <div className="glass-card p-6">
            <CollapsibleSection
              title="Débriefs"
              storageKey="lead.debriefs"
              defaultCollapsed
              right={debriefs.length > 0 ? (
                <span className="text-[10px] font-black uppercase tracking-wider text-faint">{debriefs.length} débrief{debriefs.length > 1 ? 's' : ''}</span>
              ) : undefined}
            >
              {debriefs.length === 0 ? (
                <p className="text-sm text-faint">Aucun débrief enregistré pour ce client.</p>
              ) : (
                <ul className="space-y-2">
                  {debriefs.map((d) => (
                    <DebriefRow
                      key={d.id}
                      debrief={d}
                      projectName={d.projectId ? (projects.find((p) => p.id === d.projectId)?.name ?? 'Projet') : 'Débrief libre'}
                      onDelete={() => void handleDeleteDebrief(d.id)}
                    />
                  ))}
                </ul>
              )}
            </CollapsibleSection>
          </div>
        </div>
      </main>

      {debriefOpen && (
        <>
          <button
            type="button"
            aria-label="Fermer le débriefing"
            onClick={() => setDebriefOpen(false)}
            className="fixed inset-0 z-[135] bg-text/40 backdrop-blur-sm"
          />
          <CommercialDebriefSidebar
            lead={lead}
            onSubmitFromFiche={handleFicheDebrief}
            onResolveVenteProject={resolveVenteProject}
            onSaved={() => setDebriefRefreshKey((k) => k + 1)}
            onClose={() => setDebriefOpen(false)}
            onValidated={(outcome, projectId) => {
              // Chemin RDV uniquement (le sans-RDV passe par onSubmitFromFiche).
              // Le projet vente est déjà résolu/rattaché par le sidebar : on redirige.
              setDebriefRefreshKey((k) => k + 1)
              if (outcome === 'vente') {
                setDebriefOpen(false)
                if (projectId) navigate(`/projects/${projectId}`)
              }
            }}
            className="fixed top-0 right-0 bottom-0 z-[140]"
          />
        </>
      )}

      {attributionMode && pendingDebrief && (
        <DebriefProjectPicker
          projects={projects}
          onPick={(p) => {
            const draft = pendingDebrief
            setAttributionMode(null)
            setPendingDebrief(null)
            void saveDebrief({ ...draft.payload, projectId: p.id })
          }}
          onClose={() => { setAttributionMode(null); setPendingDebrief(null) }}
        />
      )}

      {assignOpen && (
        <AssignCommercialModal
          lead={lead}
          commerciaux={teamCommerciaux}
          onClose={() => setAssignOpen(false)}
        />
      )}

    </AppShell>
  )
}

function buildTimeline(
  rdvs: RdvResponse[],
  calls: CallLogResponse[],
  userMap: Map<string, UserResponse>,
): TimelineItem[] {
  const items: (TimelineItem & { sortKey: number })[] = []

  for (const r of rdvs) {
    const com = r.commercialId ? (userMap.get(r.commercialId)?.name ?? 'commercial') : 'commercial non assigné'
    const scheduledLabel = r.scheduledAt ? formatDateTime(r.scheduledAt) : 'Date RDV manquante'
    items.push({
      icon: 'calendar',
      iconBg: 'bg-success-tint',
      iconColor: 'text-success',
      title: r.result === 'signe' ? 'RDV signé' : r.status === 'honore' ? 'RDV honoré' : r.status === 'no_show' ? 'RDV no-show' : 'RDV programmé',
      date: scheduledLabel,
      desc: `Avec ${com} — ${r.locationType}${r.montantTotal ? ` · ${Number(r.montantTotal).toLocaleString('fr-FR')} €` : ''}${r.notes ? ` · ${r.notes}` : ''}`,
      sortKey: r.scheduledAt ? new Date(r.scheduledAt).getTime() : (r.signatureAt ? new Date(r.signatureAt).getTime() : 0),
    })
  }

  for (const c of calls) {
    items.push({
      icon: 'phone',
      iconBg: 'bg-cuivre-tint',
      iconColor: 'text-cuivre',
      title: `Appel — ${CALL_RESULT_LABEL[c.result]}`,
      date: formatDateTime(c.calledAt),
      desc: c.notes ?? undefined,
      sortKey: new Date(c.calledAt).getTime(),
    })
  }

  items.sort((a, b) => b.sortKey - a.sortKey)
  return items.map(({ sortKey: _sortKey, ...rest }) => rest)
}

function prettySource(l: Pick<LeadResponse, 'source' | 'canalAcquisition' | 'utmSource'>): string {
  if (l.canalAcquisition) return l.canalAcquisition
  if (l.utmSource) return l.utmSource[0].toUpperCase() + l.utmSource.slice(1)
  switch (l.source) {
    case 'ghl': return 'GHL'
    case 'airtable_migration': return 'Migration'
    case 'manual': return 'Manuel'
    case 'referrer': return 'Parrain'
  }
}

function fullAddress(l: Pick<LeadResponse, 'addressLine' | 'postalCode' | 'city'>): string {
  return [l.addressLine, [l.postalCode, l.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
}

function lastContactLabel(j: number | null): string {
  if (j === null) return 'Jamais'
  if (j === 0) return "Aujourd'hui"
  if (j === 1) return 'Hier'
  return `Il y a ${j}j`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-faint">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  )
}

// ─── Section "Créer un projet" inline (création directe + navigate) ───
function CreateProjectInline(props: {
  lead: LeadResponse
  projects: ProjectResponse[]
  onCreated: (p: ProjectResponse) => void
  onOpenProject: (p: ProjectResponse) => void
}) {
  const { lead, projects, onCreated, onOpenProject } = props
  const defaultAddress = [lead.addressLine, lead.postalCode, lead.city].filter(Boolean).join(', ')
  const [name, setName] = useState('')
  const [address, setAddress] = useState(lead.addressLine ?? '')
  const [postalCode, setPostalCode] = useState(lead.postalCode ?? '')
  const [city, setCity] = useState(lead.city ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    const projectName = name.trim()
    if (!projectName) return setError('Donne un nom au projet.')
    if (!address.trim() && !city.trim()) return setError('Indique l’adresse de la maison.')
    setSubmitting(true)
    try {
      const created = await createProject({
        leadId: lead.id,
        name: projectName,
        addressLine: address.trim() || null,
        postalCode: postalCode.trim() || null,
        city: city.trim() || null,
      })
      onCreated(created)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Échec de la création.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="space-y-4">
      <CollapsibleSection
        title="Créer un projet sur ce client"
        storageKey="lead.createProject"
        right={projects.length > 0 ? (
          <span className="text-[10px] font-black uppercase tracking-wider text-faint">{projects.length} projet{projects.length > 1 ? 's' : ''}</span>
        ) : undefined}
      >
        <div className="rounded-2xl border border-line bg-white/60 p-4 space-y-3">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-1">Nom du projet</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Installation 6 kWc Valentin"
              className="w-full bg-white border border-line rounded-[14px] px-3 py-2 text-sm focus:outline-none focus:border-or"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-1">Adresse de la maison</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Rue & numéro"
              className="w-full bg-white border border-line rounded-[14px] px-3 py-2 text-sm focus:outline-none focus:border-or"
            />
            <div className="mt-2 grid grid-cols-3 gap-2">
              <input
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="CP"
                className="col-span-1 bg-white border border-line rounded-[14px] px-3 py-2 text-sm focus:outline-none focus:border-or"
              />
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Ville"
                className="col-span-2 bg-white border border-line rounded-[14px] px-3 py-2 text-sm focus:outline-none focus:border-or"
              />
            </div>
            {defaultAddress && (
              <div className="mt-1 text-[10px] text-faint">Adresse prospect : {defaultAddress}</div>
            )}
          </div>

          {error && <div className="rounded-xl bg-rouille-tint px-3 py-2 text-sm text-rouille">{error}</div>}

          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name.trim() || (!address.trim() && !city.trim())}
            className="btn-primary w-full px-4 py-2.5 rounded-[14px] text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {submitting && <Spinner size={14} />}
            {submitting ? 'Création…' : 'Créer le projet'}
          </button>
        </div>
      </CollapsibleSection>

      {projects.length > 0 && (
        <CollapsibleSection
          title="Projets existants"
          storageKey="lead.existingProjects"
          right={<span className="text-[10px] font-black uppercase tracking-wider text-faint">{projects.length}</span>}
        >
          <ul className="space-y-2">
            {projects.map((p, i) => {
              const projectAddress = [p.addressLine, p.postalCode, p.city].filter(Boolean).join(', ')
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onOpenProject(p)}
                    className="w-full text-left rounded-2xl border border-line bg-white/70 hover:bg-white px-4 py-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold truncate">Projet {projects.length - i} — {p.name}</div>
                        {projectAddress && <div className="text-[11px] text-muted mt-0.5 truncate">{projectAddress}</div>}
                        <div className="text-[10px] text-faint mt-0.5">{new Date(p.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</div>
                      </div>
                      <span className="shrink-0 inline-flex rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider bg-cuivre-tint text-cuivre">{PROJECT_STATUS_LABEL[p.status]}</span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </CollapsibleSection>
      )}
    </section>
  )
}

// ─── Sélecteur de projet pour attribuer un débrief non-vente (fiche, ≥2 projets) ───
function DebriefProjectPicker({
  projects,
  onPick,
  onClose,
}: {
  projects: ProjectResponse[]
  onPick: (p: ProjectResponse) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-noir/50 backdrop-blur-sm px-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-card w-full max-w-md max-h-[92vh] flex flex-col p-0 shadow-2xl">
        <div className="px-6 py-4 border-b border-line">
          <div className="eyebrow text-or-dark">Attribuer le débrief</div>
          <h3 className="text-xl font-black mt-1">Choisir un projet</h3>
          <p className="text-xs text-muted mt-1">À quel projet rattacher ce débrief ?</p>
        </div>

        <div className="px-6 py-4 space-y-2 overflow-y-auto">
          {projects.map((p) => {
            const projectAddress = [p.addressLine, p.postalCode, p.city].filter(Boolean).join(', ')
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p)}
                className="w-full text-left rounded-2xl border border-line bg-white/70 hover:bg-white hover:border-or px-4 py-3 text-sm transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold truncate">{p.name}</div>
                    {projectAddress && <div className="text-[11px] text-muted mt-0.5 truncate">{projectAddress}</div>}
                  </div>
                  <span className="shrink-0 inline-flex rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider bg-cuivre-tint text-cuivre">{PROJECT_STATUS_LABEL[p.status]}</span>
                </div>
              </button>
            )
          })}
        </div>

        <div className="px-6 py-4 border-t border-line flex items-center justify-between gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-muted hover:text-text">
            Annuler
          </button>
        </div>
      </div>
    </div>
  )
}

function PersonChip({ name, tint }: { name: string; tint: string }) {
  const parts = name.split(' ').filter(Boolean)
  const inits = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '··'
  return (
    <div className="flex items-center gap-2">
      <div className={`w-6 h-6 rounded-full ${tint} flex items-center justify-center text-[10px] font-bold`}>{inits}</div>
      <span className="font-semibold">{name}</span>
    </div>
  )
}
