import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CollapsibleSection } from './CollapsibleSection'

describe('CollapsibleSection', () => {
  beforeEach(() => window.localStorage.clear())

  it('affiche le titre et le contenu quand déplié', () => {
    render(<CollapsibleSection title="Historique" storageKey="t1"><p>contenu</p></CollapsibleSection>)
    expect(screen.getByText('Historique')).toBeInTheDocument()
    expect(screen.getByText('contenu')).toBeInTheDocument()
  })

  it('masque le contenu si replié par défaut', () => {
    render(<CollapsibleSection title="Débriefs" storageKey="t2" defaultCollapsed><p>secret</p></CollapsibleSection>)
    expect(screen.queryByText('secret')).toBeNull()
  })

  it('bascule au clic sur l\'en-tête', () => {
    render(<CollapsibleSection title="Sec" storageKey="t3" defaultCollapsed><p>corps</p></CollapsibleSection>)
    const btn = screen.getByRole('button', { name: /Sec/i })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    expect(screen.getByText('corps')).toBeInTheDocument()
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })

  it('rend le slot right dans l\'en-tête', () => {
    render(<CollapsibleSection title="Sec" storageKey="t4" right={<span>3 items</span>}><p>x</p></CollapsibleSection>)
    expect(screen.getByText('3 items')).toBeInTheDocument()
  })
})
