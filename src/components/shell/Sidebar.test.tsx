import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { UserResponse } from '../../lib/types'
import { useAuth } from '../../lib/auth'
import { Sidebar } from './Sidebar'

function setUser(role: UserResponse['role']) {
  useAuth.setState({ user: { id: 'u-1', name: 'Tech Un', role, active: true } as UserResponse })
}

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <Sidebar />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  useAuth.setState({ user: null })
})

describe('Sidebar — menu du technicien', () => {
  it('ne montre que Overview, Calendrier, Rappels et Mes interventions', () => {
    setUser('technicien')
    renderSidebar()
    const nav = screen.getByRole('button', { name: /Rechercher/i }).parentElement!

    // Pages attribuées au technicien.
    expect(within(nav).getByRole('link', { name: /Overview/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /Calendrier/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /Rappels/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /Mes interventions/i })).toBeInTheDocument()

    // Pages masquées pour le technicien.
    expect(within(nav).queryByRole('link', { name: /Leads/i })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /Analytics/i })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'RDV' })).not.toBeInTheDocument()
  })

  it('garde le libellé « RDV » pour un autre rôle (ex. setter)', () => {
    setUser('setter')
    renderSidebar()
    expect(screen.getByRole('link', { name: 'RDV' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Calendrier/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Analytics/i })).toBeInTheDocument()
  })
})
