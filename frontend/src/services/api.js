/**
 * services/api.js — Axios-based API client with JWT injection.
 */

import axios from 'axios'
import toast from 'react-hot-toast'
import useAuthStore from '../store/authStore'

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

// Inject JWT token on every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  return config
})

// Handle auth errors globally
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
      toast.error('Session expired. Please log in again.')
    }
    return Promise.reject(err)
  }
)

// ── Auth ──────────────────────────────────────────────────────────────────────

export const login = (data) => api.post('/auth/login', data)
export const register = (data) => api.post('/auth/register', data)

// ── Scenarios ─────────────────────────────────────────────────────────────────

export const fetchScenarios = () => api.get('/scenarios')
export const fetchScenario = (id) => api.get(`/scenario/${id}`)
export const createScenario = (data) => api.post('/scenario', data)
export const deleteScenario = (id) => api.delete(`/scenario/${id}`)

// ── Analysis ──────────────────────────────────────────────────────────────────

export const analyzeTraffic = (trains, lookahead = 120) =>
  api.post('/analyze', { trains, lookahead_seconds: lookahead })

export const applySolution = (solution_id, trains, scenario_id = null) =>
  api.post('/apply-solution', { solution_id, trains, scenario_id })

// ── Simulation ────────────────────────────────────────────────────────────────

export const startSimulation = (scenarioId) =>
  api.post(`/simulation/start/${scenarioId}`)

export const stopSimulation = (scenarioId) =>
  api.post(`/simulation/stop/${scenarioId}`)

export const overrideTrain = (scenario_id, train_id, updates) =>
  api.post('/simulation/override', { scenario_id, train_id, updates })

// ── Network graph ─────────────────────────────────────────────────────────────

export const fetchNetwork = () => api.get('/network')
