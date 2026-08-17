import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../lib/auth', () => ({
  useAuth: (sel: (s: { user?: { role: string } }) => unknown) => sel({ user: { role: 'admin' } }),
}))
import { HelpFab } from './HelpFab'

describe('<HelpFab />', () => {
  it('ouvre un menu vers la doc API, le guide agents et (admin) la gestion des clés', () => {
    render(<HelpFab />)
    expect(screen.queryByText("Documentation de l'API")).toBeNull()
    fireEvent.click(screen.getByLabelText("Aide et documentation de l'API"))
    expect(screen.getByText("Documentation de l'API").closest('a')?.getAttribute('href')).toBe('#/api-docs')
    expect(screen.getByText('Guide pour agents IA').closest('a')?.getAttribute('href')).toMatch(/\/api\/v1\/guide\.md$/)
    expect(screen.getByText('Gérer les clés API')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText("Documentation de l'API")).toBeNull()
  })
})
