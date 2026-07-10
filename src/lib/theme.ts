import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'ecoi.theme'

function getSystemMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia('(prefers-color-scheme: dark)')
}

function systemPrefersDark(): boolean {
  return getSystemMediaQuery()?.matches ?? false
}

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  return stored === 'dark' || stored === 'light' ? stored : 'system'
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return mode
}

function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}

type ThemeState = {
  theme: ThemeMode
  resolvedTheme: ResolvedTheme
  isDark: boolean
  hydrateTheme: () => void
  setTheme: (mode: ThemeMode) => void
  toggleTheme: () => void
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: readStoredTheme(),
  resolvedTheme: resolveTheme(readStoredTheme()),
  isDark: resolveTheme(readStoredTheme()) === 'dark',

  hydrateTheme: () => {
    const theme = readStoredTheme()
    const resolved = resolveTheme(theme)
    applyTheme(resolved)
    set({ theme, resolvedTheme: resolved, isDark: resolved === 'dark' })
  },

  setTheme: (theme) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    const resolved = resolveTheme(theme)
    applyTheme(resolved)
    set({ theme, resolvedTheme: resolved, isDark: resolved === 'dark' })
  },

  toggleTheme: () => {
    const nextTheme: ThemeMode = get().resolvedTheme === 'dark' ? 'light' : 'dark'
    get().setTheme(nextTheme)
  },
}))

applyTheme(resolveTheme(readStoredTheme()))

// Suit en direct le thème de l'OS tant que l'utilisateur n'a pas forcé clair/sombre.
getSystemMediaQuery()?.addEventListener('change', () => {
  const { theme } = useTheme.getState()
  if (theme !== 'system') return
  const resolved = resolveTheme('system')
  applyTheme(resolved)
  useTheme.setState({ resolvedTheme: resolved, isDark: resolved === 'dark' })
})
