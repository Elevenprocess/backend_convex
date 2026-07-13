import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NewClientModal } from './NewClientModal'
import * as apiModule from '../../lib/api'
import { ApiError } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api')>()
  return { ...mod, createManualClient: vi.fn(), bootstrapClient: vi.fn() }
})

const createManualClient = vi.mocked(apiModule.createManualClient)
const bootstrapClient = vi.mocked(apiModule.bootstrapClient)

describe('NewClientModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('soumet identité + vente et appelle onCreated', async () => {
    const created = { id: 'c1', leadId: 'l1' } as never
    createManualClient.mockResolvedValue(created)
    const onCreated = vi.fn()
    render(<NewClientModal onCreated={onCreated} onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText(/prénom/i), { target: { value: 'Corine' } })
    fireEvent.change(screen.getByLabelText(/^nom/i), { target: { value: 'Feld' } })
    fireEvent.click(screen.getByRole('button', { name: /créer le client/i }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created))
    expect(createManualClient).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Corine', lastName: 'Feld' }),
    )
  })

  it('cas 409 : affiche le lead existant et « Utiliser ce lead » lance bootstrapClient', async () => {
    createManualClient.mockRejectedValue(
      new ApiError(409, 'Un lead existe déjà', undefined, {
        lead: { id: 'l9', firstName: 'Jean', lastName: 'Dup', status: 'signe', hasDossier: false },
      }),
    )
    const created = { id: 'c9', leadId: 'l9' } as never
    bootstrapClient.mockResolvedValue(created)
    const onCreated = vi.fn()
    render(<NewClientModal onCreated={onCreated} onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText(/prénom/i), { target: { value: 'Jean' } })
    fireEvent.change(screen.getByLabelText(/^nom/i), { target: { value: 'Dup' } })
    fireEvent.click(screen.getByRole('button', { name: /créer le client/i }))

    await screen.findByText(/un lead existe déjà/i)
    expect(screen.getByText(/jean dup/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /utiliser ce lead/i }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created))
    expect(bootstrapClient).toHaveBeenCalledWith('l9')
  })
})
