import '@testing-library/jest-dom/vitest'

// ---------------------------------------------------------------------------
// Layout mocks — jsdom returns 0 for all layout dimensions, which prevents
// @tanstack/react-virtual from computing a non-zero visible range.
// These stubs give every HTMLElement a realistic size so virtualized lists
// render their items during tests. Values are intentionally large (800 × 1024)
// so at least one row is always in the visible range regardless of estimate.
// ---------------------------------------------------------------------------

// offsetHeight / offsetWidth — used by @tanstack/virtual-core's getRect()
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return 800
  },
})
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {
    return 1024
  },
})

// getBoundingClientRect — used by various layout-aware code in tests
const _origGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
HTMLElement.prototype.getBoundingClientRect = function () {
  const orig = _origGetBoundingClientRect.call(this)
  // Only stub if jsdom would return all zeros (no real layout computed)
  if (orig.width === 0 && orig.height === 0) {
    return {
      width: 1024,
      height: 800,
      top: 0,
      left: 0,
      bottom: 800,
      right: 1024,
      x: 0,
      y: 0,
      toJSON() {
        return this
      },
    }
  }
  return orig
}

// ResizeObserver stub — not available in jsdom; @tanstack/react-virtual will
// skip it gracefully when absent, but we provide a no-op so code that
// instantiates it directly does not throw.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// IntersectionObserver stub — same rationale as ResizeObserver
if (typeof globalThis.IntersectionObserver === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: ReadonlyArray<number> = []
    takeRecords() {
      return []
    }
  }
}
