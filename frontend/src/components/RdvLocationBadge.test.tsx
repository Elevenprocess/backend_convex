import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RdvLocationBadge, rdvLocationLabel } from './RdvLocationBadge'

describe('RdvLocationBadge', () => {
  it('Bureau pour agence, rien pour domicile', () => {
    const { container, rerender } = render(<RdvLocationBadge location="domicile" />)
    expect(container).toBeEmptyDOMElement()
    rerender(<RdvLocationBadge location="agence" />)
    expect(screen.getByText('Bureau')).toBeInTheDocument()
    expect(rdvLocationLabel('agence')).toBe('Bureau')
    expect(rdvLocationLabel('domicile')).toBe('Domicile')
  })
})
