/**
 * pages/Dashboard.jsx — Main operator dashboard.
 */

import { useEffect, useState, useCallback } from 'react'
import { Activity, BrainCircuit, Play, Square, RefreshCw, Zap, Train, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'

import useRailwayStore from '../store/railwayStore'
import { useSocket } from '../hooks/useSocket'
import * as api from '../services/api'
import TrainCard from '../components/trains/TrainCard'
import SolutionPanel from '../components/solutions/SolutionPanel'

export default function Dashboard() {
  const {
    scenarios, currentScenarioId, currentTrains, conflicts,
    simulationRunning, isAnalyzing,
    setScenarios, setCurrentScenario, setAnalysisResult,
    setSimulationRunning, setAnalyzing,
  } = useRailwayStore()

  const [selectedScenarioId, setSelectedScenarioId] = useState('')
  const [loading, setLoading] = useState(false)

  useSocket(currentScenarioId)

  // Load scenario list on mount
  useEffect(() => {
    api.fetchScenarios()
      .then((r) => setScenarios(r.data))
      .catch(() => toast.error('Failed to load scenarios'))
  }, [])

  // Load network graph once
  useEffect(() => {
    const { setNetwork, networkNodes } = useRailwayStore.getState()
    if (networkNodes.length === 0) {
      api.fetchNetwork()
        .then((r) => setNetwork(r.data.nodes, r.data.edges))
        .catch(() => {})
    }
  }, [])

  const handleLoadScenario = async () => {
    if (!selectedScenarioId) return toast.error('Select a scenario first')
    setLoading(true)
    try {
      const r = await api.fetchScenario(selectedScenarioId)
      setCurrentScenario(Number(selectedScenarioId), r.data.trains)
      setAnalysisResult([], [])
      toast.success(`Loaded: ${r.data.scenario.name}`)
    } catch {
      toast.error('Failed to load scenario')
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyze = async () => {
    if (!currentTrains.length) return toast.error('No trains loaded')
    setAnalyzing(true)
    try {
      const r = await api.analyzeTraffic(currentTrains)
      setAnalysisResult(r.data.conflicts, r.data.solutions)
      if (r.data.conflicts.length === 0) {
        toast.success('✅ No conflicts detected!')
      } else {
        toast.error(`⚠️ ${r.data.conflicts.length} conflict(s) detected`)
      }
    } catch {
      toast.error('Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleStartSim = async () => {
    if (!currentScenarioId) return toast.error('Load a scenario first')
    try {
      await api.startSimulation(currentScenarioId)
      setSimulationRunning(true)
      toast.success('Simulation started')
    } catch { toast.error('Failed to start simulation') }
  }

  const handleStopSim = async () => {
    if (!currentScenarioId) return
    try {
      await api.stopSimulation(currentScenarioId)
      setSimulationRunning(false)
      toast.success('Simulation stopped')
    } catch { toast.error('Failed to stop simulation') }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'a' || e.key === 'A') handleAnalyze()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentTrains])

  const activeTrains  = currentTrains.filter((t) => t.status === 'active').length
  const stoppedTrains = currentTrains.filter((t) => t.status === 'stopped').length

  return (
    <div>
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
            Traffic Dashboard
          </h1>
          <p className="text-muted text-sm" style={{ marginTop: 4 }}>
            Real-time train monitoring {currentTrains.length > 0 && `· ${currentTrains.length} trains`}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm" onClick={handleAnalyze} disabled={!currentTrains.length || isAnalyzing} title="Shortcut: A">
            {isAnalyzing ? <><span className="spinner" style={{width:14,height:14,borderWidth:2}}/> Analyzing…</> : <><BrainCircuit size={15}/> Analyze (A)</>}
          </button>
          {!simulationRunning ? (
            <button className="btn btn-success btn-sm" onClick={handleStartSim} disabled={!currentScenarioId}>
              <Play size={14}/> Start Sim
            </button>
          ) : (
            <button className="btn btn-danger btn-sm" onClick={handleStopSim}>
              <Square size={14}/> Stop Sim
            </button>
          )}
        </div>
      </div>

      {/* ── Stats Row ───────────────────────────────────────────────────── */}
      <div className="stats-grid">
        <div className="stat-block">
          <div className="icon-wrap" style={{background:'rgba(59,130,246,0.15)'}}>🚂</div>
          <div className="val">{currentTrains.length}</div>
          <div className="lbl">Total Trains</div>
        </div>
        <div className="stat-block">
          <div className="icon-wrap" style={{background:'rgba(34,197,94,0.15)'}}>✅</div>
          <div className="val" style={{color:'var(--success)'}}>{activeTrains}</div>
          <div className="lbl">Active</div>
        </div>
        <div className="stat-block">
          <div className="icon-wrap" style={{background:'rgba(239,68,68,0.15)'}}>⚠️</div>
          <div className="val" style={{color: conflicts.length > 0 ? 'var(--danger)' : 'var(--text-primary)'}}>
            {conflicts.length}
          </div>
          <div className="lbl">Conflicts</div>
        </div>
        <div className="stat-block">
          <div className="icon-wrap" style={{background:'rgba(107,114,128,0.15)'}}>🔴</div>
          <div className="val">{stoppedTrains}</div>
          <div className="lbl">Stopped</div>
        </div>
      </div>

      {/* ── Scenario Selector ───────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title"><Zap size={18}/>Scenario Control</div>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <select
            className="form-select"
            style={{ flex: 1, minWidth: 200, maxWidth: 320 }}
            value={selectedScenarioId}
            onChange={(e) => setSelectedScenarioId(e.target.value)}
          >
            <option value="">— Select a scenario —</option>
            {scenarios.map((s) => (
              <option key={s.scenario_id} value={s.scenario_id}>{s.name}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={handleLoadScenario} disabled={loading || !selectedScenarioId}>
            {loading ? 'Loading…' : <><RefreshCw size={15}/> Load</>}
          </button>
        </div>
      </div>

      {/* ── Conflict Banner ──────────────────────────────────────────────── */}
      {conflicts.length > 0 && (
        <div className="conflict-banner">
          <div className="conflict-banner-icon">⚠️</div>
          <div>
            <div className="conflict-banner-title">{conflicts.length} Conflict{conflicts.length > 1 ? 's' : ''} Detected</div>
            <div className="conflict-banner-desc">
              {conflicts.map((c) => `${c.type} at ${c.section} (${c.severity})`).join(' · ')}
            </div>
          </div>
        </div>
      )}

      {/* ── Main Content Grid ────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>

        {/* Train Cards */}
        <div>
          {currentTrains.length === 0 ? (
            <div className="empty-state" style={{ paddingTop: 60 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
              </svg>
              <p>Load a scenario to view trains</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
              {currentTrains.map((train) => (
                <TrainCard
                  key={train.train_id}
                  train={train}
                  isConflict={conflicts.some((c) => c.trains?.includes(train.train_id))}
                />
              ))}
            </div>
          )}
        </div>

        {/* Solutions Panel */}
        <SolutionPanel />
      </div>
    </div>
  )
}
