import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GhlSlotSyncNotice } from './GhlSlotSyncNotice'

const base = { id: 'l1', promotionSlotDay: '2026-11-27', promotionSlotHour: 12 }

describe('GhlSlotSyncNotice', () => {
  it('envoi échoué : message, erreur et bouton « Renvoyer à GHL » qui renvoie le créneau', async () => {
    const send = vi.fn().mockResolvedValue({ ghl: 'ok' })
    render(<GhlSlotSyncNotice lead={{ ...base, promotionGhlSync: { status: 'failed', at: '', error: 'Contact not found' } }} send={send} />)
    expect(screen.getByText(/Vendredi 27 novembre, 12 h à 13 h : pas encore transmis à GHL/)).toBeTruthy()
    expect(screen.getByText('Contact not found')).toBeTruthy()
    fireEvent.click(screen.getByText('Renvoyer à GHL'))
    expect(send).toHaveBeenCalledWith({ leadId: 'l1', day: '2026-11-27', hour: 12 })
    await waitFor(() => expect(screen.getByText(/Transmis à GHL/)).toBeTruthy())
  })
  it('rien quand c’est transmis ou sans envoi', () => {
    const { container, rerender } = render(<GhlSlotSyncNotice lead={{ ...base, promotionGhlSync: { status: 'ok', at: '', error: null } }} />)
    expect(container.textContent).toBe('')
    rerender(<GhlSlotSyncNotice lead={{ ...base, promotionGhlSync: null }} />)
    expect(container.textContent).toBe('')
  })
})
