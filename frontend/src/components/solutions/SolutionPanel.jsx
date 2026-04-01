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

export default function SolutionPanel() {
  const {
    solutions, conflicts, selectedSolutionId, currentTrains,
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
      const r = await api.applySolution(selectedSolutionId, currentTrains)
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {solutions.map((sol) => {
          const style = TYPE_STYLE[sol.type] || TYPE_STYLE.none
          const isSelected = selectedSolutionId === sol.solution_id

          return (
            <div
              key={sol.solution_id}
              className={`solution-card ${isSelected ? 'selected' : ''}`}
              onClick={() => handleSelect(sol)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleSelect(sol)}
            >
              <span
                className="solution-type-badge"
                style={{ background: style.bg, color: style.color, border: `1px solid ${style.color}` }}
              >
                {style.label}
              </span>

              <div className="solution-desc">{sol.description}</div>
              <div className="solution-impact" style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                {sol.impact}
              </div>

              <div className="solution-metrics">
                <div className="metric">
                  <Clock size={12}/>
                  <span>Delay:</span>
                  <strong>{sol.delay_seconds}s</strong>
                </div>
                <div className="metric" style={{ flex: 1 }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Confidence</span>
                  <div className="confidence-bar" style={{ marginLeft: 6 }}>
                    <div
                      className="confidence-fill"
                      style={{
                        width: `${sol.confidence * 100}%`,
                        background: sol.confidence > 0.8 ? 'var(--gradient-success)' : sol.confidence > 0.6 ? 'linear-gradient(90deg,#f59e0b,#ef4444)' : 'var(--gradient-danger)',
                      }}
                    />
                  </div>
                  <strong style={{ fontSize: '0.7rem', marginLeft: 4 }}>{Math.round(sol.confidence * 100)}%</strong>
                </div>
                {isSelected && <CheckCircle size={14} style={{ color: 'var(--primary)' }} />}
              </div>

              {sol.actions?.length > 0 && (
                <div style={{
                  marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)',
                  background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', padding: '6px 10px',
                }}>
                  {sol.actions.map((a, i) => (
                    <div key={i}>• <strong>{a.train_id}</strong>: {a.action}{a.new_speed !== undefined ? ` → ${a.new_speed} km/h` : ''}</div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
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
