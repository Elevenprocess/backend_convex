import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Icon } from '../components/Icon'
import { MockBanner } from '../components/MockBanner'
import { CONVERSATIONS, LEADS } from '../lib/mock-data'
import { useStartCall } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { leadDetailPath } from '../lib/leadPaths'

type Message = { from: 'lead' | 'me'; text: string }

const THREADS: Record<string, { date: string; messages: Message[] }[]> = {
  c1: [
    {
      date: '28 AVRIL',
      messages: [
        { from: 'lead', text: "Bonjour, je suis intéressé par votre offre solaire. Vous pouvez m'appeler ?" },
        { from: 'me', text: 'Bonjour Pierre, avec plaisir. Quel créneau vous arrange ?' },
      ],
    },
    {
      date: "AUJOURD'HUI",
      messages: [
        { from: 'lead', text: 'Mercredi 14h ça marche pour moi.' },
        { from: 'me', text: 'Parfait, RDV confirmé pour mercredi 06/05 à 14h. Notre commercial Jean-Luc viendra à votre adresse.' },
        { from: 'lead', text: 'Parfait, à mercredi 14h alors !' },
      ],
    },
  ],
  c2: [
    {
      date: 'HIER',
      messages: [
        { from: 'lead', text: 'Bonjour, vous pouvez me rappeler après 17h ?' },
        { from: 'me', text: 'Bonjour Marc, je vous appelle ce soir à 17h30, ça vous va ?' },
        { from: 'lead', text: 'Vous pouvez me rappeler après 17h ?' },
      ],
    },
  ],
  c3: [
    { date: 'HIER', messages: [{ from: 'lead', text: 'Je dois en parler à mon mari' }] },
  ],
  c4: [
    { date: 'LUNDI', messages: [{ from: 'lead', text: 'Merci pour les infos' }] },
  ],
}

export function Conversations() {
  const [activeId, setActiveId] = useState('c1')
  const [draft, setDraft] = useState('')
  // Mobile master-detail : on affiche soit la liste, soit le fil (pas les deux côte à côte).
  const [showThreadMobile, setShowThreadMobile] = useState(false)
  const navigate = useNavigate()
  const startCall = useStartCall()
  const role = useAuth((s) => s.user?.role)

  const active = CONVERSATIONS.find((c) => c.id === activeId)!
  const lead = LEADS.find((l) => l.id === active.leadId)
  const thread = THREADS[activeId] ?? []

  return (
    <AppShell>
      <Topbar eyebrow="MESSAGERIE" title="Conversations" />
      <MockBanner reason="messagerie pas encore branchée — pas de endpoint /conversations côté backend." />
      <div className="flex flex-grow overflow-hidden">
        {/* Conversations list */}
        <div className={`w-full sm:w-[320px] border-r border-line bg-white/30 backdrop-blur-md flex-col flex-shrink-0 ${showThreadMobile ? 'hidden sm:flex' : 'flex'}`}>
          <div className="p-4 border-b border-line">
            <input
              type="text"
              placeholder="Rechercher…"
              className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full"
            />
          </div>
          <div className="overflow-y-auto flex-grow">
            {CONVERSATIONS.map((c) => (
              <button
                key={c.id}
                onClick={() => { setActiveId(c.id); setShowThreadMobile(true) }}
                className={`w-full p-4 border-b border-line-soft text-left transition-colors ${
                  activeId === c.id ? 'bg-cuivre-tint/40' : 'hover:bg-white/40'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full ${c.tintClass} flex items-center justify-center text-xs font-bold shrink-0`}>{c.initials}</div>
                  <div className="flex-grow min-w-0">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-semibold text-sm">{c.name}</span>
                      <span className="text-[10px] text-faint">{c.lastTime}</span>
                    </div>
                    <p className="text-xs text-muted truncate">{c.lastMessage}</p>
                  </div>
                  {c.unread > 0 && (
                    <span className="w-5 h-5 bg-or text-white text-[10px] font-bold rounded-full flex items-center justify-center shrink-0">{c.unread}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Thread */}
        <div className={`flex-grow flex-col min-w-0 ${showThreadMobile ? 'flex' : 'hidden sm:flex'}`}>
          <div className="px-4 sm:px-6 py-3 border-b border-line bg-white/30 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setShowThreadMobile(false)}
                className="sm:hidden w-10 h-10 -ml-2 rounded-full flex items-center justify-center text-muted hover:bg-white/50 shrink-0"
                aria-label="Retour aux conversations"
              >
                <Icon name="arrow-left" size={18} />
              </button>
              <div className={`w-9 h-9 rounded-full ${active.tintClass} flex items-center justify-center text-sm font-bold shrink-0`}>{active.initials}</div>
              <div>
                <h2 className="text-base font-bold">{active.name}</h2>
                <span className="text-xs text-faint">{lead?.phone ?? ''} — En ligne</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => lead && navigate(leadDetailPath(role, lead.id))}
                className="btn-secondary px-3 py-2 rounded-xl text-xs"
              >
                Voir le profil
              </button>
              <button
                onClick={() => {
                  if (!lead || !lead.phone) return
                  startCall({
                    leadId: lead.id,
                    leadName: `${lead.firstName} ${lead.lastName}`,
                    toNumber: lead.phone,
                  }).catch((err) => {
                    console.error('Phone copy failed', err)
                    alert(err instanceof Error ? err.message : 'Impossible de copier le numéro')
                  })
                }}
                className="btn-primary px-4 py-2 rounded-xl text-xs flex items-center gap-2"
              >
                <Icon name="phone" size={12} />
                Appeler
              </button>
            </div>
          </div>

          <div className="flex-grow p-6 overflow-y-auto space-y-4">
            {thread.map((block, i) => (
              <div key={i}>
                <div className="text-center text-xs eyebrow my-2">{block.date}</div>
                <div className="space-y-3">
                  {block.messages.map((m, j) => (
                    <div key={j} className={`flex gap-3 ${m.from === 'me' ? 'justify-end' : ''}`}>
                      {m.from === 'lead' && (
                        <div className={`w-8 h-8 rounded-full ${active.tintClass} flex items-center justify-center text-[10px] font-bold shrink-0`}>{active.initials}</div>
                      )}
                      <div
                        className={`rounded-2xl px-4 py-2.5 max-w-md text-sm ${
                          m.from === 'me'
                            ? 'bg-or text-white rounded-tr-sm'
                            : 'bg-white border border-line rounded-tl-sm'
                        }`}
                      >
                        {m.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <form
            className="p-4 border-t border-line bg-white/30 flex items-end gap-2 flex-shrink-0"
            onSubmit={(e) => { e.preventDefault(); setDraft('') }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm flex-grow"
              placeholder="Écrire un message…"
            />
            <button type="submit" className="btn-primary px-5 py-2 rounded-xl">Envoyer</button>
          </form>
        </div>
      </div>
    </AppShell>
  )
}
