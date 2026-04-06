/**
 * components/solutions/SolutionPanel.jsx — Compact AI solutions panel.
 *
 * Redesigned as a horizontal card grid for quick scanning.
 * Apply button works during active simulation by directly calling overrideTrain.
 */

import { useState } from 'react'
import { BrainCircuit, CheckCircle, Clock, Zap, Download, ArrowRight, Shield } from 'lucide-react'
import toast from 'react-hot-toast'
import useRailwayStore from '../../store/railwayStore'
import * as api from '../../services/api'

const TYPE_STYLE = {
  reroute: { bg: 'rgba(6,182,212,0.15)', color: '#06b6d4', label: 'Reroute', icon: '🔀' },
  reduce_speed: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', label: 'Slow', icon: '🐢' },
  hold: { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af', label: 'Hold', icon: '✋' },
  none: { bg: 'rgba(34,197,94,0.15)', color: '#22c55e', label: 'Clear', icon: '✅' },
}

function formatDelay(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.round(seconds % 60)
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`
}

function formatActionShort(action) {
  if (action.action === 'reduce_speed') {
    return `${action.train_id} → ${action.new_speed}km/h`
  }
  if (action.action === 'reroute') {
    return `${action.train_id} → ${action.new_section || 'reroute'}`
  }
  if (action.action === 'stop') {
    return `${action.train_id} → stop`
  }
  return `${action.train_id} → ${action.action}`
}

export default function SolutionPanel() {
  const {
    solutions, conflicts, selectedSolutionId, currentTrains,
    currentScenarioId, simulationRunning,
    setSelectedSolution, setAnalysisResult, updateTrains,
    clearCrashedTrains, clearResumingTrains,
  } = useRailwayStore()

  const [applying, setApplying] = useState(false)

  const handleSelect = (sol) => {
    setSelectedSolution(selectedSolutionId === sol.solution_id ? null : sol.solution_id)
  }

  const handleApply = async () => {
    if (!selectedSolutionId) return toast.error('Select a solution first')
    setApplying(true)
    try {
      const selectedSolution = useRailwayStore.getState().getSelectedSolution()
      if (!selectedSolution) {
        toast.error('Solution not found')
        return
      }

      // During simulation: directly apply overrides via overrideTrain API
      // This bypasses the problematic applySolution endpoint that re-analyzes
      if (simulationRunning && currentScenarioId && selectedSolution.actions?.length) {
        const affectedTrainIds = []

        await Promise.all(
          selectedSolution.actions.map((action) => {
            const updates = {}
            affectedTrainIds.push(action.train_id)

            if (action.action === 'reduce_speed' && action.new_speed !== undefined) {
              updates.current_speed = action.new_speed
              updates.status = 'speed_reduced'
            } else if (action.action === 'reroute' && action.new_section) {
              updates.current_section = action.new_section
              updates.status = 'rerouted'
            } else if (action.action === 'stop') {
              updates.current_speed = 0
              updates.status = 'stopped'
              const trainData = currentTrains.find((t) => t.train_id === action.train_id)
              updates._original_speed = action.original_speed || trainData?.current_speed || 60
            }

            if (Object.keys(updates).length === 0) return null
            return api.overrideTrain(currentScenarioId, action.train_id, updates)
          }).filter(Boolean)
        )

        // Clear crashed state for affected trains — they'll show RESUMING briefly
        clearCrashedTrains(affectedTrainIds)
        // Clear resuming state after 3 seconds
        setTimeout(() => {
          clearResumingTrains(affectedTrainIds)
        }, 3000)

        setAnalysisResult([], [])
        setSelectedSolution(null)
        toast.success('✅ Solution applied!')

        // Re-analyze after 2s to check for remaining conflicts
        setTimeout(async () => {
          try {
            const r2 = await api.analyzeTraffic(useRailwayStore.getState().currentTrains)
            setAnalysisResult(r2.data.conflicts, r2.data.solutions)
          } catch { }
        }, 2000)
      } else {
        // Not during simulation: use the standard applySolution endpoint
        const r = await api.applySolution(selectedSolutionId, currentTrains, currentScenarioId)
        updateTrains(r.data.trains)
        setAnalysisResult([], [])
        setSelectedSolution(null)
        toast.success('✅ Solution applied!')

        setTimeout(async () => {
          try {
            const r2 = await api.analyzeTraffic(useRailwayStore.getState().currentTrains)
            setAnalysisResult(r2.data.conflicts, r2.data.solutions)
          } catch { }
        }, 1500)
      }
    } catch {
      toast.error('Failed to apply solution')
    } finally {
      setApplying(false)
    }
  }

  const handleExport = () => {
    const data = {
      timestamp: new Date().toISOString(),
      conflicts,
      solutions,
      trains: currentTrains,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `railway_report_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Report exported!')
  }

  if (solutions.length === 0) {
    return (
      <div className="card solutions-panel-empty" style={{ height: 'fit-content' }}>
        <div className="card-header">
          <div className="card-title"><BrainCircuit size={18} />AI Solutions</div>
        </div>
        <div className="empty-state" style={{ padding: '24px 16px' }}>
          <BrainCircuit size={32} style={{ opacity: 0.2 }} />
          <p style={{ fontSize: '0.82rem' }}>Click "Analyze" to get AI-generated solutions</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card solutions-panel" style={{ height: 'fit-content' }}>
      {/* Header */}
      <div className="solutions-panel-header">
        <div className="card-title">
          <BrainCircuit size={16} />
          AI Solutions
          <span className="solutions-count">{solutions.length}</span>
        </div>
        <div className="solutions-header-actions">
          <button className="btn btn-ghost btn-sm" onClick={handleExport} title="Export JSON report" style={{ padding: '4px 8px', fontSize: '0.72rem' }}>
            <Download size={12} /> Export
          </button>
          {selectedSolutionId && (
            <button
              className="btn btn-primary btn-sm solutions-apply-btn"
              onClick={handleApply}
              disabled={applying}
            >
              {applying
                ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Applying…</>
                : <><Zap size={13} /> Apply</>
              }
            </button>
          )}
        </div>
      </div>

      {/* Compact horizontal solution cards */}
      <div className="solutions-compact-grid">
        {solutions.map((sol) => {
          const style = TYPE_STYLE[sol.type] || TYPE_STYLE.none
          const isSelected = selectedSolutionId === sol.solution_id

          return (
            <div
              key={sol.solution_id}
              className={`solution-compact-card ${isSelected ? 'selected' : ''}`}
              onClick={() => handleSelect(sol)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleSelect(sol)}
            >
              {/* Top row: type badge + confidence */}
              <div className="solution-compact-top">
                <span
                  className="solution-compact-badge"
                  style={{ background: style.bg, color: style.color, borderColor: style.color }}
                >
                  {style.icon} {style.label}
                </span>
                <div className="solution-compact-conf">
                  <Shield size={10} style={{ color: sol.confidence > 0.8 ? '#22c55e' : sol.confidence > 0.6 ? '#f59e0b' : '#ef4444' }} />
                  <span>{Math.round(sol.confidence * 100)}%</span>
                </div>
                {isSelected && <CheckCircle size={14} className="solution-check" />}
              </div>

              {/* Actions summary (compact) */}
              <div className="solution-compact-actions">
                {sol.actions?.length > 0 ? (
                  sol.actions.map((action, i) => (
                    <span key={`${action.train_id}-${i}`} className="solution-compact-action">
                      {formatActionShort(action)}
                    </span>
                  ))
                ) : (
                  <span className="solution-compact-action muted">No action needed</span>
                )}
              </div>

              {/* Bottom: delay */}
              <div className="solution-compact-meta">
                <Clock size={10} />
                <span>Delay: {formatDelay(sol.delay_seconds)}</span>
              </div>

              {/* Tooltip with full description */}
              <div className="solution-compact-tooltip">
                <strong>{sol.description}</strong>
                {sol.impact && <p>{sol.impact}</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
