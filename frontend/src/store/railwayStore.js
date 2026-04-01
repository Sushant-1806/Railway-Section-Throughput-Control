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
  setSelectedSolution: (id) => set({ selectedSolutionId: id }),
  setAnalyzing: (val) => set({ isAnalyzing: val }),

  getSelectedSolution: () => {
    const { solutions, selectedSolutionId } = get()
    return solutions.find((s) => s.solution_id === selectedSolutionId) || null
  },

  // ── Simulation ───────────────────────────────────────────────────────────
  simulationRunning: false,
  setSimulationRunning: (val) => set({ simulationRunning: val }),

  // ── Network graph ─────────────────────────────────────────────────────────
  networkNodes: [],
  networkEdges: [],
  setNetwork: (nodes, edges) => set({ networkNodes: nodes, networkEdges: edges }),

  // ── UI ────────────────────────────────────────────────────────────────────
  activeTab: 'dashboard',  // 'dashboard' | 'map' | 'scenarios' | 'analysis'
  setActiveTab: (tab) => set({ activeTab: tab }),
}))

export default useRailwayStore
