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

describe('Sidebar — navigation par rôle', () => {
  it('limite le menu technicien au planning et à ses dossiers', () => {
    setUser('technicien')
    renderSidebar()
    const nav = screen.getByRole('button', { name: /Rechercher/i }).parentElement!

    expect(within(nav).getByRole('link', { name: /Planning/i })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /Mes dossiers/i })).toBeInTheDocument()

    expect(within(nav).queryByRole('link', { name: /Overview/i })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /Analytics/i })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /Calendrier RDV/i })).not.toBeInTheDocument()
  })

  it('groupe le setter par Acquisition et Calendriers', () => {
    setUser('setter')
    renderSidebar()

    expect(screen.getByRole('navigation', { name: 'Acquisition' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Calendriers' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Étape setter' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Étape commercial' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Calendrier RDV' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Planning' })).not.toBeInTheDocument()
  })

  it('affiche à l’admin Acquisition, Délivrabilité et les deux calendriers', () => {
    setUser('admin')
    renderSidebar()

    expect(screen.getByRole('navigation', { name: 'Acquisition' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Délivrabilité' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Calendriers' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Étape setter' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Étape commercial' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Suivi dossiers' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Calendrier RDV' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Planning' })).toBeInTheDocument()
  })
})
