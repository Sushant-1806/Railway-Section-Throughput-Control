/**
 * store/authStore.js — Zustand store for authentication state.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,  // { username, role }

      setAuth: (token, user) => set({ token, user }),

      logout: () => {
        set({ token: null, user: null })
      },

      isAuthenticated: () => {
        const state = useAuthStore.getState()
        return !!state.token
      },
    }),
    { name: 'railway-auth' }
  )
)

export default useAuthStore
