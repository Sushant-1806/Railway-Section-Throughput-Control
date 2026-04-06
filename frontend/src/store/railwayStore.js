/**
 * store/railwayStore.js — Zustand store for railway control state.
 */

import { create } from 'zustand'

const useRailwayStore = create((set, get) => ({
  // ── Scenarios ────────────────────────────────────────────────────────────
  scenarios: [],
  currentScenarioId: null,
  currentTrains: [],

  setScenarios: (scenarios) => set({ scenarios }),
  setCurrentScenario: (id, trains) => set({ currentScenarioId: id, currentTrains: trains }),
  updateTrains: (trains) => set({ currentTrains: trains }),

  // ── AI Analysis ──────────────────────────────────────────────────────────
  conflicts: [],
  solutions: [],
  selectedSolutionId: null,
  isAnalyzing: false,

  setAnalysisResult: (conflicts, solutions) => set({ conflicts, solutions }),
  setConflicts: (conflicts) => set({ conflicts }),
  setSelectedSolution: (id) => set({ selectedSolutionId: id }),
  setAnalyzing: (val) => set({ isAnalyzing: val }),

  getSelectedSolution: () => {
    const { solutions, selectedSolutionId } = get()
    return solutions.find((s) => s.solution_id === selectedSolutionId) || null
  },

  // ── Simulation ───────────────────────────────────────────────────────────
  simulationRunning: false,
  setSimulationRunning: (val) => set({ simulationRunning: val }),

  // ── Conflict tracking ──────────────────────────────────────────────────────
  crashedTrainIds: new Set(),
  resumingTrainIds: new Set(),
  addCrashedTrains: (ids) => set((s) => {
    const next = new Set(s.crashedTrainIds)
    ids.forEach((id) => next.add(id))
    return { crashedTrainIds: next }
  }),
  clearCrashedTrains: (ids) => set((s) => {
    const nextCrashed = new Set(s.crashedTrainIds)
    const nextResuming = new Set(s.resumingTrainIds)
    ids.forEach((id) => { nextCrashed.delete(id); nextResuming.add(id) })
    return { crashedTrainIds: nextCrashed, resumingTrainIds: nextResuming }
  }),
  clearResumingTrains: (ids) => set((s) => {
    const next = new Set(s.resumingTrainIds)
    ids.forEach((id) => next.delete(id))
    return { resumingTrainIds: next }
  }),

  // ── Network graph ─────────────────────────────────────────────────────────
  networkNodes: [],
  networkEdges: [],
  setNetwork: (nodes, edges) => set({ networkNodes: nodes, networkEdges: edges }),

  // ── UI ────────────────────────────────────────────────────────────────────
  activeTab: 'dashboard',  // 'dashboard' | 'map' | 'scenarios' | 'analysis'
  setActiveTab: (tab) => set({ activeTab: tab }),
}))

export default useRailwayStore
