/**
 * pages/AnalysisPage.jsx — Dedicated AI analysis and what-if simulation page.
 */

import { useState } from 'react'
import { BrainCircuit, FlaskConical, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import useRailwayStore from '../store/railwayStore'
import * as api from '../services/api'
import SolutionPanel from '../components/solutions/SolutionPanel'

export default function AnalysisPage() {
  const { currentTrains, conflicts, solutions, setAnalysisResult, setAnalyzing, isAnalyzing } = useRailwayStore()
  const [lookahead, setLookahead] = useState(120)
  const [whatIfTrains, setWhatIfTrains] = useState(null)  // null = use real trains
  const [isWhatIf, setIsWhatIf] = useState(false)

  const handleAnalyze = async (trains = null) => {
    const toAnalyze = trains || currentTrains
    if (!toAnalyze.length) return toast.error('No trains loaded. Go to Dashboard and load a scenario.')
    setAnalyzing(true)
    try {
      const r = await api.analyzeTraffic(toAnalyze, lookahead)
      setAnalysisResult(r.data.conflicts, r.data.solutions)
      toast.success(`Analysis complete — ${r.data.conflicts.length} conflict(s) found`)
    } catch { toast.error('Analysis failed') }
    finally { setAnalyzing(false) }
  }

  const handleWhatIfToggle = () => {
    if (!isWhatIf) {
      setWhatIfTrains(currentTrains.map((t) => ({ ...t })))
      setIsWhatIf(true)
    } else {
      setWhatIfTrains(null)
      setIsWhatIf(false)
    }
  }

  const updateWhatIfTrain = (idx, field, value) => {
    const updated = [...whatIfTrains]
    updated[idx] = { ...updated[idx], [field]: value }
    setWhatIfTrains(updated)
  }

  const trainList = isWhatIf ? whatIfTrains : currentTrains

  return (
    <div>
      <div className="flex items-center justify-between mb-4" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em' }}>AI Analysis</h1>
          <p className="text-muted text-sm" style={{ marginTop: 4 }}>
            Graph-based conflict prediction with Dijkstra rerouting
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title"><BrainCircuit size={18}/>Analysis Controls</div>
        </div>
        <div className="flex gap-4 items-center" style={{ flexWrap:'wrap' }}>
          <div className="form-group" style={{ margin:0, flex:'0 0 220px' }}>
            <label className="form-label">Lookahead (seconds)</label>
            <input
              className="form-input"
              type="number" min={10} max={600} value={lookahead}
              onChange={(e) => setLookahead(Number(e.target.value))}
            />
          </div>
          <div className="flex gap-2" style={{ marginTop: 20 }}>
            <button className="btn btn-primary" onClick={() => handleAnalyze(isWhatIf ? whatIfTrains : null)} disabled={isAnalyzing}>
              {isAnalyzing ? <><span className="spinner" style={{width:14,height:14,borderWidth:2}}/> Analyzing…</> : <><BrainCircuit size={15}/> Run Analysis</>}
            </button>
            <button
              className={`btn ${isWhatIf ? 'btn-danger' : 'btn-ghost'}`}
              onClick={handleWhatIfToggle}
              disabled={!currentTrains.length}
            >
              <FlaskConical size={15}/>
              {isWhatIf ? 'Exit What-If Mode' : 'What-If Mode'}
            </button>
          </div>
        </div>

        {isWhatIf && (
          <div style={{ marginTop: 16, padding:'12px 16px', background:'var(--bg-base)', borderRadius:'var(--radius-md)', border:'1px solid var(--warning)' }}>
            <p className="text-sm" style={{ color:'var(--warning)', marginBottom:12 }}>
              <FlaskConical size={12} style={{display:'inline', marginRight:6}}/>
              <strong>What-If Mode:</strong> Modify train parameters below and run analysis to preview outcomes without saving.
            </p>
            {whatIfTrains?.map((t, i) => (
              <div key={t.train_id} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8, flexWrap:'wrap' }}>
                <span className="font-mono text-sm" style={{ width:50 }}>{t.train_id}</span>
                <div className="form-group" style={{ margin:0 }}>
                  <label className="form-label">Speed</label>
                  <input className="form-input" type="number" min={0} max={250} value={t.current_speed}
                    onChange={(e) => updateWhatIfTrain(i, 'current_speed', Number(e.target.value))}
                    style={{ width:90 }} />
                </div>
                <div className="form-group" style={{ margin:0 }}>
                  <label className="form-label">Section</label>
                  <select className="form-select" value={t.current_section}
                    onChange={(e) => updateWhatIfTrain(i, 'current_section', e.target.value)}
                    style={{ width:80 }}>
                    {['A','B','C','D','E','F','G','H','I','J','K','L'].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 380px', gap:20 }}>
        {/* Conflict detail */}
        <div>
          <h2 style={{ fontSize:'1rem', fontWeight:600, marginBottom:12 }}>
            Detected Conflicts ({conflicts.length})
          </h2>
          {conflicts.length === 0 ? (
            <div className="empty-state">
              <BrainCircuit size={36} style={{ opacity:0.2 }} />
              <p>Run analysis to see conflict predictions</p>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {conflicts.map((c) => (
                <div key={c.conflict_id} className="card" style={{ padding:16, borderColor: c.severity === 'critical' ? 'var(--danger)' : c.severity === 'high' ? 'var(--warning)' : 'var(--border)' }}>
                  <div className="flex items-center justify-between mb-4" style={{ marginBottom:10 }}>
                    <span style={{
                      fontSize:'0.72rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em',
                      padding:'3px 10px', borderRadius:999,
                      background: c.severity === 'critical' ? 'rgba(239,68,68,0.15)' : c.severity === 'high' ? 'rgba(245,158,11,0.15)' : 'rgba(107,114,128,0.15)',
                      color: c.severity === 'critical' ? 'var(--danger)' : c.severity === 'high' ? 'var(--warning)' : 'var(--text-muted)',
                    }}>
                      {c.severity}
                    </span>
                    <span className="text-xs text-muted font-mono">{c.conflict_id}</span>
                  </div>
                  <div style={{ fontSize:'0.9rem', fontWeight:500, marginBottom:6 }}>
                    {c.type.replace('_', ' ').toUpperCase()} — Section: <strong>{c.section}</strong>
                  </div>
                  <div className="text-sm text-muted">
                    Trains: <span className="font-mono">{c.trains?.join(', ')}</span>
                  </div>
                  {c.predicted_in_seconds > 0 && (
                    <div className="text-sm" style={{ marginTop:4, color:'var(--warning)' }}>
                      ⏱ Predicted in {Math.round(c.predicted_in_seconds)}s
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <SolutionPanel />
      </div>
    </div>
  )
}
