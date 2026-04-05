/**
 * components/solutions/SolutionPanel.jsx — AI solutions panel with apply button.
 */

import { useState } from 'react'
import { BrainCircuit, CheckCircle, Clock, Zap, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import useRailwayStore from '../../store/railwayStore'
import * as api from '../../services/api'

const TYPE_STYLE = {
  reroute:      { bg: 'rgba(6,182,212,0.15)', color: '#06b6d4', label: 'Reroute' },
  reduce_speed: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', label: 'Speed Reduce' },
  hold:         { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af', label: 'Hold' },
  none:         { bg: 'rgba(34,197,94,0.15)',  color: '#22c55e', label: 'No Action' },
}

function formatDelay(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.round(seconds % 60)
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`
}

function formatAction(action) {
  if (action.action === 'reduce_speed') {
    return `${action.train_id} → ${action.new_speed} km/h`
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
      const r = await api.applySolution(selectedSolutionId, currentTrains, currentScenarioId)

      if (simulationRunning && currentScenarioId && selectedSolution?.actions?.length) {
        await Promise.all(
          selectedSolution.actions.map((action) => {
            const updates = {}

            if (action.action === 'reduce_speed' && action.new_speed !== undefined) {
              updates.current_speed = action.new_speed
              updates.status = 'speed_reduced'
            } else if (action.action === 'reroute' && action.new_section) {
              updates.current_section = action.new_section
              updates.status = 'rerouted'
            } else if (action.action === 'stop') {
              updates.current_speed = 0
              updates.status = 'stopped'
              if (action.original_speed) {
                updates._original_speed = action.original_speed
              }
            }

            if (Object.keys(updates).length === 0) return null
            return api.overrideTrain(currentScenarioId, action.train_id, updates)
          }).filter(Boolean)
        )
      }

      updateTrains(r.data.trains)
      setAnalysisResult([], [])
      setSelectedSolution(null)
      toast.success('✅ Solution applied!')

      // Re-analyze after 1.5s
      setTimeout(async () => {
        try {
          const r2 = await api.analyzeTraffic(useRailwayStore.getState().currentTrains)
          setAnalysisResult(r2.data.conflicts, r2.data.solutions)
        } catch {}
      }, 1500)
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
      <div className="card" style={{ height: 'fit-content' }}>
        <div className="card-header">
          <div className="card-title"><BrainCircuit size={18}/>AI Solutions</div>
        </div>
        <div className="empty-state">
          <BrainCircuit size={40} style={{ opacity: 0.2 }} />
          <p>Click "Analyze" to get AI-generated solutions</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ height: 'fit-content' }}>
      <div className="card-header">
        <div className="card-title">
          <BrainCircuit size={18}/>
          AI Solutions
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
            ({solutions.length})
          </span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={handleExport} title="Export JSON report">
          <Download size={13}/> Export
        </button>
      </div>

      <div className="solution-table-wrap">
        <table className="solution-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Resolution</th>
              <th>Metrics</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {solutions.map((sol) => {
              const style = TYPE_STYLE[sol.type] || TYPE_STYLE.none
              const isSelected = selectedSolutionId === sol.solution_id

              return (
                <tr
                  key={sol.solution_id}
                  className={isSelected ? 'selected' : ''}
                  onClick={() => handleSelect(sol)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleSelect(sol)}
                >
                  <td>
                    <div className="solution-type-wrap">
                      <span
                        className="solution-type-badge"
                        style={{ background: style.bg, color: style.color, border: `1px solid ${style.color}` }}
                      >
                        {style.label}
                      </span>
                      {isSelected && <CheckCircle size={14} style={{ color: 'var(--primary)' }} />}
                    </div>
                  </td>
                  <td>
                    <div className="solution-text-block">
                      <div className="solution-desc">{sol.description}</div>
                      <div className="solution-impact">{sol.impact}</div>
                    </div>
                  </td>
                  <td>
                    <div className="solution-metrics-stack">
                      <div className="metric">
                        <Clock size={12}/>
                        <span>Delay</span>
                        <strong>{formatDelay(sol.delay_seconds)}</strong>
                      </div>
                      <div className="solution-confidence">
                        <span>Confidence</span>
                        <div className="confidence-bar">
                          <div
                            className="confidence-fill"
                            style={{
                              width: `${sol.confidence * 100}%`,
                              background: sol.confidence > 0.8 ? 'var(--gradient-success)' : sol.confidence > 0.6 ? 'linear-gradient(90deg,#f59e0b,#ef4444)' : 'var(--gradient-danger)',
                            }}
                          />
                        </div>
                        <strong>{Math.round(sol.confidence * 100)}%</strong>
                      </div>
                    </div>
                  </td>
                  <td>
                    {sol.actions?.length > 0 ? (
                      <div className="solution-action-list">
                        {sol.actions.map((action, index) => (
                          <div key={`${action.train_id}-${index}`} className="solution-action-item">
                            {formatAction(action)}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="solution-action-list muted">No actions required</div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selectedSolutionId && (
        <button
          className="btn btn-primary w-full"
          style={{ marginTop: 16 }}
          onClick={handleApply}
          disabled={applying}
        >
          {applying ? <><span className="spinner" style={{width:14,height:14,borderWidth:2}}/> Applying…</> : <><Zap size={15}/> Apply Selected Solution</>}
        </button>
      )}
    </div>
  )
}
