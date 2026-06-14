import type { Dossier } from '../../lib/suivi'
import { formatCurrency, formatDate } from '../../lib/suivi'
import { fullName, initials, STATUS_LABEL, type DebriefResponse } from '../../lib/types'
import { Section, Field, DebriefCard, formatDebriefFinancingType, formatDebriefPaymentMethod } from './fiche-parts'

type Props = {
  dossier: Dossier
  debriefs: DebriefResponse[]
}

/**
 * Colonne gauche de la page Fiche complète : identité, coordonnées & données
 * collectées, puis l'historique « global » du client (note setter + débriefs
 * non rattachés à un projet précis).
 */
export function FicheClientPanel({ dossier, debriefs }: Props) {
  const lead = dossier.lead
  const setterNote = lead.latestCallComment
  const generalDebriefs = [...debriefs]
    .filter((d) => d.projectId == null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  // Financement & méthode de paiement = ce qui a été saisi au débriefing. On prend
  // le débrief le plus récent qui porte une de ces infos (tous projets confondus),
  // puis on en dérive le TYPE (+ organisme) et la MÉTHODE (chèque/espèces/virement)
  // depuis le MÊME débrief, pour deux champs cohérents. Repli sur le financement
  // du RDV pour le type si aucun débrief n'est renseigné.
  const financingDebrief = [...debriefs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .find((d) => d.financingType || d.paymentSubMethod || d.financingOrg) ?? null

  const financingValue =
    (financingDebrief ? formatDebriefFinancingType(financingDebrief) : null)
    ?? (dossier.rdv?.financingType
      ? formatDebriefFinancingType({ financingType: dossier.rdv.financingType, paymentSubMethod: null, financingOrg: null })
      : null)
  const paymentMethodValue = financingDebrief ? formatDebriefPaymentMethod(financingDebrief) : null

  return (
    <aside className="space-y-7 rounded-2xl border border-line bg-white p-5 lg:sticky lg:top-4">
      <header className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-or-tint text-base font-semibold text-or-dark">
          {initials(lead)}
        </span>
        <div className="min-w-0">
          <div className="eyebrow text-or-dark">Fiche client</div>
          <h2 className="truncate text-lg font-semibold text-text">{fullName(lead) || 'Client sans nom'}</h2>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
            <span className="rounded-full bg-cream px-2 py-0.5 font-medium text-or-dark">{STATUS_LABEL[lead.status]}</span>
            {lead.city && <span>· {lead.city}</span>}
          </div>
        </div>
      </header>

      <Section title="Coordonnées & données">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
          <Field label="Téléphone" value={lead.phone} href={lead.phone ? `tel:${lead.phone}` : undefined} />
          <Field label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
          <Field label="Adresse" value={lead.addressLine} wide />
          <Field label="Code postal" value={lead.postalCode} />
          <Field label="Ville" value={lead.city} />
          <Field label="Logement" value={lead.typeLogement} />
          <Field label="Source" value={lead.source} />
          <Field label="Canal" value={lead.canalAcquisition} />
          <Field label="Campagne" value={lead.campaign} />
          <Field label="Setter" value={dossier.setter?.name} />
          <Field label="Commercial" value={dossier.commercial?.name} />
          <Field label="RDV" value={dossier.rdv?.scheduledAt ? formatDate(dossier.rdv.scheduledAt) : null} />
          <Field label="Montant" value={dossier.amount ? formatCurrency(dossier.amount) : null} />
          <Field label="Financement" value={financingValue} />
          <Field
            label="Signé le"
            value={dossier.rdv?.signatureAt ? formatDate(dossier.rdv.signatureAt) : (dossier.signedAt ? formatDate(dossier.signedAt) : null)}
          />
          <Field label="Méthode de paiement" value={paymentMethodValue} wide />
        </dl>
      </Section>

      {(generalDebriefs.length > 0 || setterNote) && (
        <Section title="Historique" count={generalDebriefs.length + (setterNote ? 1 : 0)}>
          <div className="space-y-3">
            {generalDebriefs.map((d) => (
              <DebriefCard key={d.id} debrief={d} />
            ))}
            {setterNote && (
              <article className="rounded-xl border border-line bg-white p-3.5 [border-left:3px_solid_var(--color-cuivre)]">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-text">
                    Note setter{dossier.setter?.name ? ` · ${dossier.setter.name}` : ''}
                  </span>
                  {lead.latestCallAt && <span className="shrink-0 text-[10px] font-medium text-faint">{formatDate(lead.latestCallAt)}</span>}
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{setterNote}</p>
              </article>
            )}
          </div>
        </Section>
      )}
    </aside>
  )
}
