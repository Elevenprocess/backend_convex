import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { compactScopes, expandToSet, summarizeScopes } from '../../lib/apiScopes'

const create = vi.fn(async () => ({ id: 't1', secret: 'vlr_SECRET123', prefix: 'vlr_SECRET12', scopes: ['leads:read', 'rdv:write'] }))
let rows: unknown[] = []
vi.mock('convex/react', () => ({
  useQuery: () => rows,
  useMutation: () => create,
}))
vi.mock('../../lib/convex', () => ({ convexClient: {}, convexAuthEnabled: true }))
vi.mock('../../lib/hooks', () => ({ copyText: vi.fn(async () => {}) }))
vi.mock('../../lib/clipboardToast', () => ({ notifyClipboardCopied: vi.fn() }))

import { ApiTokensSection } from './ApiTokensSection'

describe('apiScopes helpers', () => {
  it('compacte en presets quand tout un accès est coché, et développe à l’inverse', () => {
    const all = expandToSet(['*:read'])
    expect(all.has('leads:read')).toBe(true)
    expect(all.has('leads:write')).toBe(false)
    expect(compactScopes(all)).toEqual(['*:read'])
    expect(compactScopes(new Set(['rdv:write', 'leads:read']))).toEqual(['leads:read', 'rdv:write'])
    expect(summarizeScopes(['*:read', '*:write'])).toBe('Tout (lecture + écriture)')
    expect(summarizeScopes(['*:read', 'rdv:write'])).toBe('Tout en lecture + 1 domaine')
    expect(summarizeScopes([])).toBe('Aucun accès')
  })
})

describe('<ApiTokensSection />', () => {
  it('liste les clés et crée une clé scopée depuis la grille ; le secret est affiché une fois', async () => {
    rows = [{
      id: 'a', name: 'n8n', prefix: 'vlr_abcdefgh', scopes: ['*:read'], effectiveScopes: [], createdAt: 1, createdBy: 'Admin',
      expiresAt: null, revokedAt: null, lastUsedAt: null, callCount: 3,
    }]
    render(<ApiTokensSection />)
    expect(screen.getAllByTestId('api-token-row')).toHaveLength(1)
    expect(screen.getByText('Tout en lecture')).toBeTruthy()

    fireEvent.click(screen.getByText('Nouvelle clé'))
    fireEvent.change(screen.getByPlaceholderText('ex. Agent Hermes'), { target: { value: 'Agent Hermes' } })
    fireEvent.click(screen.getByLabelText('Prospects lecture'))
    fireEvent.click(screen.getByLabelText('Rendez-vous écriture'))
    fireEvent.click(screen.getByText('Générer la clé'))

    expect(await screen.findByTestId('api-token-secret')).toHaveTextContent('vlr_SECRET123')
    expect(create).toHaveBeenCalledWith({ name: 'Agent Hermes', scopes: ['leads:read', 'rdv:write'] })
  })
})
