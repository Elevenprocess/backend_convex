import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCollapsibleState } from './useCollapsibleState'

describe('useCollapsibleState', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('renvoie defaultCollapsed quand rien en storage', () => {
    const { result: a } = renderHook(() => useCollapsibleState('k1', true))
    expect(a.current[0]).toBe(true)
    const { result: b } = renderHook(() => useCollapsibleState('k2', false))
    expect(b.current[0]).toBe(false)
  })

  it('toggle inverse et persiste en localStorage', () => {
    const { result } = renderHook(() => useCollapsibleState('k3', false))
    act(() => result.current[1]())
    expect(result.current[0]).toBe(true)
    expect(window.localStorage.getItem('ecoi.collapse.k3')).toBe('1')
    act(() => result.current[1]())
    expect(result.current[0]).toBe(false)
    expect(window.localStorage.getItem('ecoi.collapse.k3')).toBe('0')
  })

  it('relit une valeur existante depuis localStorage', () => {
    window.localStorage.setItem('ecoi.collapse.k4', '1')
    const { result } = renderHook(() => useCollapsibleState('k4', false))
    expect(result.current[0]).toBe(true)
  })
})
