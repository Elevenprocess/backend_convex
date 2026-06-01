import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AssignCommercialModal } from './AssignCommercialModal'
import type { LeadResponse, UserResponse } from '../../lib/types'

// On isole la modale : seul `assignLead` est mocké (le reste — Icon, Spinner — est pur).
const assignLeadMock = vi.fn()
vi.mock('../../lib/hooks', () => ({
  assignLead: (...args: unknown[]) => assignLeadMock(...args),
}))

function makeUser(id: string, name: string, role: UserResponse['role'], active = true): UserResponse {
  return { id, name, role, active } as UserResponse
}

const lead = { id: 'lead-1', firstName: 'Jean', lastName: 'Dupont', assignedToId: 'u-alice' } as LeadResponse

const commerciaux: UserResponse[] = [
  makeUser('u-alice', 'Alice Martin', 'commercial'),
  makeUser('u-bob', 'Bob Durand', 'commercial'),
]

describe('AssignCommercialModal', () => {
  beforeEach(() => assignLeadMock.mockReset())

  it('liste les commerciaux fournis et marque le commercial actuel', () => {
    render(<AssignCommercialModal lead={lead} commerciaux={commerciaux} onClose={() => {}} />)
    expect(screen.getByText('Alice Martin')).toBeInTheDocument()
    expect(screen.getByText('Bob Durand')).toBeInTheDocument()
    expect(screen.getByText('Actuel')).toBeInTheDocument()
  })

  it("désactive la confirmation tant que la cible n'a pas changé", () => {
    render(<AssignCommercialModal lead={lead} commerciaux={commerciaux} onClose={() => {}} />)
    // Le commercial actuel est présélectionné → bouton désactivé.
    expect(screen.getByRole('button', { name: /Donner le client/i })).toBeDisabled()
  })

  it('appelle assignLead avec la cible choisie puis ferme', async () => {
    assignLeadMock.mockResolvedValue({ ...lead, assignedToId: 'u-bob' })
    const onClose = vi.fn()
    const onAssigned = vi.fn()
    render(<AssignCommercialModal lead={lead} commerciaux={commerciaux} onClose={onClose} onAssigned={onAssigned} />)

    fireEvent.click(screen.getByText('Bob Durand'))
    fireEvent.click(screen.getByRole('button', { name: /Donner le client/i }))

    await waitFor(() => expect(assignLeadMock).toHaveBeenCalledWith('lead-1', 'u-bob'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onAssigned).toHaveBeenCalledWith(expect.objectContaining({ assignedToId: 'u-bob' }))
  })
})
