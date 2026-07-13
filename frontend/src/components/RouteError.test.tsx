import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { RouteError, shouldAutoReload } from './RouteError'

function renderWithError(error: Error) {
  const Boom = () => { throw error }
  const router = createMemoryRouter([
    { path: '/', element: <Boom />, errorElement: <RouteError /> },
  ])
  return render(<RouterProvider router={router} />)
}

describe('RouteError', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('erreur applicative → écran propre avec bouton recharger', () => {
    renderWithError(new Error('boom métier'))
    expect(screen.getByText('Une erreur est survenue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Recharger la page/i })).toBeInTheDocument()
  })

  it('chunk périmé + reload déjà tenté récemment → écran « Nouvelle version » (pas de boucle)', () => {
    // Simule un rechargement auto qui vient d'avoir lieu : la garde refuse.
    expect(shouldAutoReload()).toBe(true)
    renderWithError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Settings-abc.js'))
    expect(screen.getByText('Nouvelle version disponible')).toBeInTheDocument()
  })

  it('shouldAutoReload : vrai une fois, puis faux pendant la fenêtre de garde', () => {
    expect(shouldAutoReload()).toBe(true)
    expect(shouldAutoReload()).toBe(false)
  })
})
