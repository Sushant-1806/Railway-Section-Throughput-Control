/**
 * store/themeStore.js — Persisted light/dark theme state.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const STORAGE_KEY = 'railway-theme'

const getStoredTheme = () => {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const theme = parsed?.state?.theme
    return theme === 'light' || theme === 'dark' ? theme : null
  } catch {
    return null
  }
}

const getInitialTheme = () => {
  const storedTheme = getStoredTheme()
  if (storedTheme) return storedTheme

  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light'
  }

  return 'dark'
}

const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: getInitialTheme(),

      setTheme: (theme) => set({ theme }),

      toggleTheme: () => {
        const nextTheme = get().theme === 'dark' ? 'light' : 'dark'
        set({ theme: nextTheme })
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({ theme: state.theme }),
    },
  ),
)

export default useThemeStore