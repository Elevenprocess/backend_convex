import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark'

const THEME_STORAGE_KEY = 'ecoi.theme'

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  return stored === 'dark' ? 'dark' : 'light'
}

function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = mode
  document.documentElement.style.colorScheme = mode
}

type ThemeState = {
  theme: ThemeMode
  isDark: boolean
  hydrateTheme: () => void
  setTheme: (mode: ThemeMode) => void
  toggleTheme: () => void
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: readStoredTheme(),
  isDark: readStoredTheme() === 'dark',

  hydrateTheme: () => {
    const theme = readStoredTheme()
    applyTheme(theme)
    set({ theme, isDark: theme === 'dark' })
  },

  setTheme: (theme) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    applyTheme(theme)
    set({ theme, isDark: theme === 'dark' })
  },

  toggleTheme: () => {
    const nextTheme: ThemeMode = get().theme === 'dark' ? 'light' : 'dark'
    get().setTheme(nextTheme)
  },
}))

applyTheme(readStoredTheme())
