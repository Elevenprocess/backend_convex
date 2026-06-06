import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateRangePicker } from './DateRangePicker'
import { defaultPeriod } from '../../lib/period'

describe('DateRangePicker', () => {
  it('ouvre le panneau au clic sur le trigger', async () => {
    const user = userEvent.setup()
    render(<DateRangePicker value={defaultPeriod()} onChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: /période/i }))
    expect(screen.getByText('Appliquer')).toBeInTheDocument()
  })

  it('applique un preset uniquement après clic sur Appliquer', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DateRangePicker value={defaultPeriod()} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /période/i }))
    await user.click(screen.getByRole('button', { name: 'Hier' }))
    expect(onChange).not.toHaveBeenCalled()
    await user.click(screen.getByText('Appliquer'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'yesterday' }))
  })

  it('Annuler ferme sans propager', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DateRangePicker value={defaultPeriod()} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /période/i }))
    await user.click(screen.getByRole('button', { name: 'Hier' }))
    await user.click(screen.getByText('Annuler'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText('Appliquer')).not.toBeInTheDocument()
  })
})
