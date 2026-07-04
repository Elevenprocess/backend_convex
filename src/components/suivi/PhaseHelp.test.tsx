import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PhaseHelp } from './PhaseHelp'

describe('PhaseHelp', () => {
  it('ouvre le popover au clic avec le contenu du guide', () => {
    render(<PhaseHelp phase="racco" />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Raccordement/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/Enedis/)).toBeInTheDocument()
    expect(screen.getAllByText(/CRAE/).length).toBeGreaterThan(0)
  })

  it('affiche la phase suivante quand elle existe', () => {
    render(<PhaseHelp phase="consuel" />)
    fireEvent.click(screen.getByRole('button', { name: /Consuel/ }))
    expect(screen.getByText('Mise en service')).toBeInTheDocument()
  })

  it('se referme au second clic', () => {
    render(<PhaseHelp phase="vt" />)
    const btn = screen.getByRole('button', { name: /Visite technique/ })
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
