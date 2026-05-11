import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { LoadingBlock } from '../../components/Spinner'
import { useRdv, useLead, useUsers } from '../../lib/hooks'
import {
  fullName,
  initials as leadInitials,
  STATUS_LABEL,
  STATUS_BADGE,
  type RdvStatus,
  type RdvLocation,
} from '../../lib/types'
import { DebriefModal } from './DebriefModal'

const LOCATION_LABEL: Record<RdvLocation, string> = {
  domicile: 'Visite à domicile',
  agence: 'En agence',
  visio: 'Visio',
}

const RDV_STATUS_LABEL: Record<RdvStatus, string> = {
  planifie: 'À venir',
  honore: 'Honoré',
  no_show: 'No-show',
  reporte: 'Reporté',
  annule: 'Annulé',
}

const RDV_STATUS_BADGE: Record<RdvStatus, string> = {
  planifie: 'bg-cuivre-tint text-cuivre',
  honore: 'bg-success-tint text-success',
  no_show: 'bg-rouille-tint text-rouille',
  reporte: 'bg-info-tint text-info',
  annule: 'bg-rouille-tint text-rouille',
}

export function RdvDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [debriefOpen, setDebriefOpen] = useState(false)

  const { data: rdv, loading: rdvLoading, error: rdvError } = useRdv(id)
  const { data: lead } = useLead(rdv?.leadId)
  const { data: users } = useUsers()

  if (rdvLoading) {
    return (
      <AppShell>
        <Topbar eyebrow="RDV / DÉTAIL" title="Chargement…" />
        <main className="p-8 flex items-center justify-center flex-grow">
          <LoadingBlock label="Chargement du RDV…" />
        </main>
      </AppShell>
    )
  }

  if (rdvError || !rdv) {
    return (
      <AppShell>
        <Topbar eyebrow="RDV / DÉTAIL" title="RDV introuvable" />
        <main className="p-8 flex items-center justify-center flex-grow">
          <div className="glass-card p-12 text-center">
            <p className="text-muted mb-4">{rdvError ?? "Ce RDV n'existe pas (ou plus)."}</p>
            <button onClick={() => navigate('/rdv')} className="btn-primary px-4 py-2 rounded-xl text-sm">Retour calendrier</button>
          </div>
        </main>
      </AppShell>
    )
  }

  const commercial = users?.find((u) => u.id === rdv.commercialId)
  const setter = lead?.setterId ? users?.find((u) => u.id === lead.setterId) : undefined

  return (
    <AppShell>
      <Topbar
        eyebrow="RDV / DÉTAIL"
        title={`${lead ? fullName(lead) : 'Lead'} — ${formatDateShort(rdv.scheduledAt)}`}
      />
      <div className="px-8 pt-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => navigate('/rdv')} className="text-muted hover:text-text flex items-center gap-1 text-sm">
          <Icon name="arrow-left" size={16} />
          Retour
        </button>
        <div className="flex items-center gap-3 ml-auto">
          <span className={`status-badge ${RDV_STATUS_BADGE[rdv.status]}`}>{RDV_STATUS_LABEL[rdv.status]}</span>
          <button className="btn-secondary px-4 py-2 rounded-xl text-sm">Reprogrammer</button>
          <button
            onClick={() => setDebriefOpen(true)}
            className="btn-primary px-5 py-2 rounded-xl text-sm"
          >
            Lancer le débrief
          </button>
        </div>
      </div>

      <main className="p-8 pt-4 grid grid-cols-3 gap-6 overflow-y-auto flex-grow">
        <div className="col-span-2 space-y-6">
          <div className="glass-card p-6">
            <h3 className="font-bold mb-4">Informations RDV</h3>
            <div className="grid grid-cols-2 gap-y-4 gap-x-8 text-sm">
              <Field label="DATE & HEURE" value={formatDateLong(rdv.scheduledAt)} />
              <Field label="TYPE" value={LOCATION_LABEL[rdv.locationType]} />
              <Field label="STATUT" value={RDV_STATUS_LABEL[rdv.status]} />
              <Field label="DÉBRIEF DÛ AVANT" value={rdv.debriefDueAt ? formatDateLong(rdv.debriefDueAt) : '—'} />
              <Field label="COMMERCIAL">
                {commercial
                  ? <PersonChip name={commercial.name} tint="bg-or-tint" />
                  : <span className="text-faint">—</span>}
              </Field>
              <Field label="SETTER (RDV PRIS PAR)">
                {setter
                  ? <PersonChip name={setter.name} tint="bg-cuivre-tint" />
                  : <span className="text-faint">—</span>}
              </Field>
            </div>
          </div>

          {rdv.notes && (
            <div className="glass-card p-6">
              <h3 className="font-bold mb-3">Notes</h3>
              <div className="bg-white/50 border border-line rounded-[14px] p-4 text-sm leading-relaxed whitespace-pre-wrap">
                {rdv.notes}
              </div>
            </div>
          )}

          {rdv.result && (
            <div className="glass-card p-6">
              <h3 className="font-bold mb-3">Débrief</h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-8 text-sm">
                <Field label="RÉSULTAT" value={rdv.result} />
                {rdv.financingType && <Field label="MODE" value={rdv.financingType} />}
                {rdv.montantTotal && <Field label="MONTANT" value={`${Number(rdv.montantTotal).toLocaleString('fr-FR')} €`} />}
                {rdv.signatureAt && <Field label="SIGNATURE" value={formatDateShort(rdv.signatureAt)} />}
              </div>
              {rdv.objections && (
                <div className="mt-4">
                  <span className="eyebrow block mb-1">OBJECTIONS</span>
                  <div className="text-sm">{rdv.objections}</div>
                </div>
              )}
              {rdv.nonSaleReason && (
                <div className="mt-4">
                  <span className="eyebrow block mb-1">RAISON NON-VENTE</span>
                  <div className="text-sm">{rdv.nonSaleReason}</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="col-span-1 space-y-6">
          {lead && (
            <div className="glass-card p-6 text-center">
              <div className="w-20 h-20 rounded-full bg-cuivre-tint flex items-center justify-center text-2xl font-bold mx-auto mb-3">{leadInitials(lead)}</div>
              <h3 className="font-bold">{fullName(lead)}</h3>
              <span className={`status-badge ${STATUS_BADGE[lead.status]} mt-2 inline-block`}>{STATUS_LABEL[lead.status]}</span>
              {lead.phone && <div className="mt-3 text-xs text-muted">{lead.phone}</div>}
              <button
                onClick={() => navigate(`/leads/${lead.id}`)}
                className="mt-4 text-xs font-semibold text-or hover:underline"
              >
                Voir la fiche complète →
              </button>
            </div>
          )}
        </div>
      </main>

      {debriefOpen && lead && (
        <DebriefModal
          rdv={rdv}
          lead={lead}
          onClose={() => setDebriefOpen(false)}
          onSave={() => {
            setDebriefOpen(false)
            navigate('/rdv')
          }}
        />
      )}
    </AppShell>
  )
}

function Field({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <span className="eyebrow block mb-1">{label}</span>
      {children ?? <span className="font-semibold">{value}</span>}
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

function formatDateLong(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })
}

function formatDateShort(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
