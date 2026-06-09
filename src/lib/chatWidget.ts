import { create } from 'zustand'
import { api } from './api'

type AssistantRole = 'user' | 'assistant' | 'system' | 'tool'

export type AssistantConversation = {
  id: string
  userId: string
  title: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export type AssistantMessage = {
  id: string
  conversationId: string
  role: AssistantRole
  parts: unknown[]
  createdAt: string
}

export type AssistantConversationDetail = {
  conversation: AssistantConversation
  messages: AssistantMessage[]
}

type ChatWidgetState = {
  open: boolean
  conversationId: string | null
  conversations: AssistantConversation[]
  loadingConversations: boolean
  error: string | null
  setOpen: (open: boolean) => void
  toggle: () => void
  setConversationId: (id: string | null) => void
  setError: (error: string | null) => void
  loadConversations: () => Promise<AssistantConversation[]>
  createConversation: () => Promise<AssistantConversation>
  renameConversation: (id: string, title: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
}

export const useChatWidget = create<ChatWidgetState>((set, get) => ({
  open: false,
  conversationId: null,
  conversations: [],
  loadingConversations: false,
  error: null,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setConversationId: (conversationId) => set({ conversationId }),
  setError: (error) => set({ error }),
  loadConversations: async () => {
    set({ loadingConversations: true, error: null })
    try {
      const conversations = await api<AssistantConversation[]>('/assistant/conversations')
      set({ conversations, loadingConversations: false })
      return conversations
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Impossible de charger les conversations'
      set({ error: message, loadingConversations: false })
      throw e
    }
  },
  createConversation: async () => {
    const conversation = await api<AssistantConversation>('/assistant/conversations', { method: 'POST', body: {} })
    set((s) => ({ conversations: [conversation, ...s.conversations], conversationId: conversation.id }))
    return conversation
  },
  renameConversation: async (id, title) => {
    const updated = await api<AssistantConversation>(`/assistant/conversations/${id}`, { method: 'PATCH', body: { title } })
    set((s) => ({ conversations: s.conversations.map((c) => c.id === id ? updated : c) }))
  },
  deleteConversation: async (id) => {
    await api<{ ok: true }>(`/assistant/conversations/${id}`, { method: 'DELETE' })
    const next = get().conversations.filter((c) => c.id !== id)
    set({ conversations: next, conversationId: get().conversationId === id ? (next[0]?.id ?? null) : get().conversationId })
  },
}))

export async function getAssistantConversation(id: string): Promise<AssistantConversationDetail> {
  return api<AssistantConversationDetail>(`/assistant/conversations/${id}`)
}
