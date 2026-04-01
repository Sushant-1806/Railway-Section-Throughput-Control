/**
 * pages/ScenariosPage.jsx — Scenario list management page.
 */

import { useEffect, useState } from 'react'
import { Layers, Plus, Trash2, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import useRailwayStore from '../store/railwayStore'
import * as api from '../services/api'
import ScenarioModal from '../components/scenarios/ScenarioModal'

export default function ScenariosPage() {
  const { scenarios, setScenarios, setCurrentScenario } = useRailwayStore()
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const loadScenarios = async () => {
    setLoading(true)
    try {
      const r = await api.fetchScenarios()
      setScenarios(r.data)
    } catch { toast.error('Failed to load scenarios') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadScenarios() }, [])

  const handleDelete = async (id) => {
    if (!confirm('Delete this scenario?')) return
    setDeletingId(id)
    try {
      await api.deleteScenario(id)
      setScenarios(scenarios.filter((s) => s.scenario_id !== id))
      toast.success('Scenario deleted')
    } catch { toast.error('Delete failed') }
    finally { setDeletingId(null) }
  }

  const handleLoad = async (id) => {
    try {
      const r = await api.fetchScenario(id)
      setCurrentScenario(id, r.data.trains)
      toast.success(`Loaded: ${r.data.scenario.name}`)
    } catch { toast.error('Failed to load scenario') }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em' }}>Scenarios</h1>
          <p className="text-muted text-sm" style={{ marginTop: 4 }}>Manage traffic control scenarios</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm" onClick={loadScenarios} disabled={loading}>
            <RefreshCw size={14}/> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
            <Plus size={14}/> New Scenario
          </button>
        </div>
      </div>

      {scenarios.length === 0 && !loading ? (
        <div className="empty-state">
          <Layers size={48} style={{ opacity: 0.2 }} />
          <p>No scenarios yet. Create one to get started.</p>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={14}/> Create Scenario</button>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:16 }}>
          {scenarios.map((s) => (
            <div key={s.scenario_id} className="card" style={{ cursor:'pointer' }}>
              <div className="card-header">
                <div className="card-title">{s.name}</div>
                <div className="flex gap-2">
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s.scenario_id)}
                    disabled={deletingId === s.scenario_id}>
                    <Trash2 size={12}/>
                  </button>
                </div>
              </div>
              <p className="text-muted text-sm" style={{ marginBottom: 16 }}>{s.description || 'No description'}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted font-mono">ID: {s.scenario_id}</span>
                <span className="text-xs text-muted">{new Date(s.created_at).toLocaleDateString()}</span>
              </div>
              <button className="btn btn-ghost w-full" style={{ marginTop: 14 }} onClick={() => handleLoad(s.scenario_id)}>
                Load Scenario
              </button>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <ScenarioModal onClose={() => setShowModal(false)} onCreated={loadScenarios} />
      )}
    </div>
  )
}
