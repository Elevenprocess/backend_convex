import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DevisScanLoader } from './DevisScanLoader'

describe('DevisScanLoader', () => {
  it('affiche le libellé de scan et un pourcentage', () => {
    render(<DevisScanLoader ocrStatus="processing" />)
    expect(screen.getByText(/Analyse du devis en cours/i)).toBeTruthy()
    expect(screen.getByText(/%$/)).toBeTruthy()
  })

  it('ne montre pas le nom de fichier brut', () => {
    render(<DevisScanLoader ocrStatus="pending" />)
    expect(screen.queryByText(/\.pdf/i)).toBeNull()
  })
})
