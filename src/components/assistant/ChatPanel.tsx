import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isToolUIPart, getToolName, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai'
import { buildApiUrl } from '../../lib/api'
import { getAssistantConversation, useChatWidget } from '../../lib/chatWidget'
import { useAuth } from '../../lib/auth'
import { updateLead, assignLead } from '../../lib/hooks'
import { ToolConfirmation } from './ToolConfirmation'
import { Markdown } from './Markdown'
import { Icon } from '../Icon'

const WRITE_TOOLS = new Set(['updateLeadStatus', 'assignLead'])

function messageText(message: UIMessage): string {
  return (message.parts ?? [])
    .map((part: any) => {
      if (part?.type === 'text') return part.text
      if (part?.type?.startsWith('tool-')) {
        // Les outils d'écriture sont rendus via la carte de confirmation puis
        // résumés par le modèle — pas de texte d'état générique pour eux.
        if (WRITE_TOOLS.has(part.type.slice('tool-'.length))) return ''
        return part.state === 'output-available' ? '✓ Données consultées' : 'Recherche en cours…'
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

export function ChatPanel() {
  const status = useAuth((s) => s.status)
  const user = useAuth((s) => s.user)
  const open = useChatWidget((s) => s.open)
  const setOpen = useChatWidget((s) => s.setOpen)
  const conversationId = useChatWidget((s) => s.conversationId)
  const setConversationId = useChatWidget((s) => s.setConversationId)
  const conversations = useChatWidget((s) => s.conversations)
  const loadConversations = useChatWidget((s) => s.loadConversations)
  const createConversation = useChatWidget((s) => s.createConversation)
  const deleteConversation = useChatWidget((s) => s.deleteConversation)
  const [input, setInput] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // Id de conversation attribué PENDANT le stream en cours (nouvelle conversation
  // créée côté backend, renvoyé via l'en-tête). On l'utilise pour NE PAS recharger
  // les messages depuis la base à ce moment-là : la base n'a pas encore la réponse
  // de l'IA (sauvée en fin de stream), un reload effacerait le message en cours.
  const activeStreamConvRef = useRef<string | null>(null)

  const transport = useMemo(() => new DefaultChatTransport<UIMessage>({
    api: buildApiUrl('/assistant/chat'),
    credentials: 'include',
    fetch: async (input, init) => {
      const res = await fetch(input, init)
      const id = res.headers.get('X-Assistant-Conversation-Id')
      if (id) {
        activeStreamConvRef.current = id
        setConversationId(id)
      }
      return res
    },
    prepareSendMessagesRequest: ({ messages }) => ({
      body: { messages, conversationId: useChatWidget.getState().conversationId ?? undefined },
    }),
  }), [setConversationId])

  const { messages, setMessages, sendMessage, addToolResult, status: chatStatus, error, stop } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  })
  const busy = chatStatus === 'submitted' || chatStatus === 'streaming'

  const runWriteTool = async (toolName: string, toolCallId: string, toolInput: any) => {
    try {
      if (toolName === 'updateLeadStatus') {
        await updateLead(String(toolInput.leadId), { status: toolInput.status })
      } else if (toolName === 'assignLead') {
        await assignLead(String(toolInput.leadId), String(toolInput.commercialId))
      }
      await addToolResult({ tool: toolName, toolCallId, output: { ok: true } })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Échec de l’action'
      await addToolResult({ tool: toolName, toolCallId, output: { error: message } })
    }
  }

  const cancelWriteTool = async (toolName: string, toolCallId: string) => {
    await addToolResult({ tool: toolName, toolCallId, output: { cancelled: true } })
  }

  useEffect(() => {
    if (status === 'authed') void loadConversations().catch(() => undefined)
  }, [status, loadConversations])

  useEffect(() => {
    if (!conversationId) {
      setMessages([])
      return
    }
    // Conversation venant d'être créée par le stream en cours → les messages
    // locaux (question + réponse en cours de frappe) sont déjà à l'écran, on ne
    // recharge PAS depuis la base (qui n'a pas encore la réponse).
    if (conversationId === activeStreamConvRef.current) return
    setHistoryLoading(true)
    getAssistantConversation(conversationId)
      .then((detail) => {
        setMessages(detail.messages.map((m) => ({ id: m.id, role: m.role as any, parts: m.parts as any })))
      })
      .catch(() => setMessages([]))
      .finally(() => setHistoryLoading(false))
  }, [conversationId, setMessages])

  useEffect(() => {
    if (!open) return
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open, busy])

  if (status !== 'authed' || !user) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    await sendMessage({ text })
    void loadConversations().catch(() => undefined)
  }

  return (
    <>
      <button
        type="button"
        className="assistant-launcher"
        onClick={() => setOpen(!open)}
        aria-label={open ? 'Fermer assistant IA' : 'Ouvrir assistant IA'}
      >
        <span className="assistant-launcher-glow" />
        <span className="assistant-launcher-icon">✦</span>
        <span className="assistant-launcher-label">IA</span>
      </button>

      {open && (
        <section className="assistant-panel" aria-label="Assistant IA VELORA">
          <header className="assistant-header">
            <div>
              <p className="assistant-eyebrow">Assistant VELORA</p>
              <h2>Copilote IA</h2>
              <span>Connecté à tes leads, RDV, clients et stats.</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fermer">×</button>
          </header>

          <div className="assistant-body">
            <aside className="assistant-history">
              <button type="button" className="assistant-new" onClick={() => { setConversationId(null); setMessages([]); void createConversation() }}>
                + Nouveau
              </button>
              <div className="assistant-history-list">
                {conversations.map((conversation) => (
                  <div
                    key={conversation.id}
                    className={`assistant-history-item${conversation.id === conversationId ? ' active' : ''}`}
                  >
                    <button
                      type="button"
                      className="assistant-history-open"
                      onClick={() => setConversationId(conversation.id)}
                      title={conversation.title}
                    >
                      <span>{conversation.title}</span>
                      <small>{new Date(conversation.updatedAt).toLocaleDateString('fr-FR')}</small>
                    </button>
                    <button
                      type="button"
                      className="assistant-history-del"
                      aria-label="Supprimer la conversation"
                      title="Supprimer"
                      onClick={() => {
                        if (window.confirm(`Supprimer la conversation « ${conversation.title} » ?`)) {
                          void deleteConversation(conversation.id)
                        }
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                ))}
                {conversations.length === 0 && <p>Aucune conversation.</p>}
              </div>
            </aside>

            <main className="assistant-chat">
              <div className="assistant-messages" ref={listRef}>
                {historyLoading && <div className="assistant-empty">Chargement…</div>}
                {!historyLoading && messages.length === 0 && (
                  <div className="assistant-empty">
                    <strong>Bonjour {(user.name ?? '').trim().split(' ')[0] || ''} 👋</strong>
                    <span>Je suis ton copilote VELORA. Demande-moi par exemple :</span>
                    <span>• « Combien de nouveaux leads aujourd'hui / hier ? »</span>
                    <span>• « Qu'a fait tel setter aujourd'hui ? »</span>
                    <span>• « Montre mes RDV de demain » · « Quels leads chauds relancer ? »</span>
                  </div>
                )}
                {messages.map((message) => {
                  const isUser = message.role === 'user'
                  const text = messageText(message)
                  const pendingWrites = (message.parts ?? []).filter(
                    (p: any) =>
                      isToolUIPart(p) &&
                      WRITE_TOOLS.has(getToolName(p) as string) &&
                      p.state === 'input-available',
                  )
                  if (!text && pendingWrites.length === 0) return null
                  return (
                    <div key={message.id}>
                      {text && (
                        <div className={`assistant-message ${isUser ? 'user' : 'assistant assistant-md'}`}>
                          {isUser ? text : <Markdown text={text} />}
                        </div>
                      )}
                      {pendingWrites.map((p: any) => (
                        <ToolConfirmation
                          key={p.toolCallId}
                          toolName={getToolName(p) as 'updateLeadStatus' | 'assignLead'}
                          input={p.input ?? {}}
                          onConfirm={() => void runWriteTool(getToolName(p) as string, p.toolCallId, p.input ?? {})}
                          onCancel={() => void cancelWriteTool(getToolName(p) as string, p.toolCallId)}
                        />
                      ))}
                    </div>
                  )
                })}
                {busy && <div className="assistant-thinking">L’assistant réfléchit…</div>}
              </div>

              {error && <div className="assistant-error">{error.message}</div>}
              <form className="assistant-input" onSubmit={submit}>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) submit(e)
                  }}
                  placeholder="Écris ta demande…"
                  rows={2}
                />
                <button type={busy ? 'button' : 'submit'} onClick={busy ? () => void stop() : undefined}>
                  {busy ? 'Stop' : 'Envoyer'}
                </button>
              </form>
            </main>
          </div>
        </section>
      )}
    </>
  )
}
