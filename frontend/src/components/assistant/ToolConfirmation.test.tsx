import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ToolConfirmation } from './ToolConfirmation'

describe('ToolConfirmation', () => {
  it('affiche un libellé lisible pour updateLeadStatus', () => {
    render(
      <ToolConfirmation
        toolName="updateLeadStatus"
        input={{ leadId: 'abc-123', status: 'signe' }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/statut/i)).toBeInTheDocument()
    expect(screen.getByText(/signe/i)).toBeInTheDocument()
  })

  it('appelle onConfirm au clic sur Confirmer', async () => {
    const onConfirm = vi.fn()
    render(
      <ToolConfirmation
        toolName="assignLead"
        input={{ leadId: 'abc-123', commercialId: 'com-9' }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /confirmer/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('appelle onCancel au clic sur Annuler', async () => {
    const onCancel = vi.fn()
    render(
      <ToolConfirmation
        toolName="updateLeadStatus"
        input={{ leadId: 'abc-123', status: 'perdu' }}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /annuler/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
