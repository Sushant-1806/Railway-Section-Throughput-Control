/**
 * components/scenarios/ScenarioModal.jsx — Create custom scenario modal.
 */

import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import * as api from '../../services/api'
import useRailwayStore from '../../store/railwayStore'

const emptyTrain = () => ({
  train_id: '',
  train_type: 'Express',
  priority: 2,
  current_speed: 80,
  current_section: 'A',
  destination: 'E',
  distance_to_destination: 300,
  direction: 'forward',
})

const STATIONS = ['A','B','C','D','E','F','G','H','I','J','K','L']

export default function ScenarioModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [trains, setTrains] = useState([emptyTrain(), emptyTrain()])
  const [loading, setLoading] = useState(false)

  const addTrain = () => setTrains([...trains, emptyTrain()])
  const removeTrain = (i) => setTrains(trains.filter((_, idx) => idx !== i))
  const updateTrain = (i, field, val) => {
    const t = [...trains]
    t[i] = { ...t[i], [field]: val }
    setTrains(t)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    // Validate unique train IDs
    const ids = trains.map((t) => t.train_id.toUpperCase())
    if (new Set(ids).size !== ids.length) {
      return toast.error('Train IDs must be unique')
    }
    if (ids.some((id) => !id)) {
      return toast.error('All trains need an ID')
    }

    setLoading(true)
    try {
      const r = await api.createScenario({
        name, description,
        trains: trains.map((t) => ({ ...t, train_id: t.train_id.toUpperCase() })),
      })
      toast.success(`Scenario "${name}" created!`)
      onCreated?.(r.data.scenario_id)
      onClose()
    } catch (err) {
      const msg = err.response?.data?.message
      toast.error(typeof msg === 'string' ? msg : 'Failed to create scenario')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content">
        <div className="modal-header">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Create Custom Scenario</h2>
          <button className="modal-close" onClick={onClose}><X size={20}/></button>
        </div>

        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Scenario Name *</label>
              <input className="form-input" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rush Hour Conflict" required />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input className="form-input" value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description..." />
            </div>

            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <label className="form-label" style={{ margin:0 }}>Trains ({trains.length})</label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addTrain}><Plus size={14}/> Add Train</button>
            </div>

            {trains.map((train, i) => (
              <div key={i} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', padding:16, marginBottom:14 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                  <strong style={{ fontSize:'0.85rem' }}>Train {i + 1}</strong>
                  {trains.length > 1 && (
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => removeTrain(i)}>
                      <Trash2 size={12}/>
                    </button>
                  )}
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Train ID *</label>
                    <input className="form-input" value={train.train_id}
                      onChange={(e) => updateTrain(i, 'train_id', e.target.value)}
                      placeholder="T101" required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Type</label>
                    <select className="form-select" value={train.train_type}
                      onChange={(e) => updateTrain(i, 'train_type', e.target.value)}>
                      {['Express','Passenger','Freight','Local'].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Priority (1=highest)</label>
                    <input className="form-input" type="number" min={1} max={5} value={train.priority}
                      onChange={(e) => updateTrain(i, 'priority', Number(e.target.value))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Speed (km/h)</label>
                    <input className="form-input" type="number" min={0} max={250} value={train.current_speed}
                      onChange={(e) => updateTrain(i, 'current_speed', Number(e.target.value))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Current Station</label>
                    <select className="form-select" value={train.current_section}
                      onChange={(e) => updateTrain(i, 'current_section', e.target.value)}>
                      {STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Destination</label>
                    <select className="form-select" value={train.destination}
                      onChange={(e) => updateTrain(i, 'destination', e.target.value)}>
                      {STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Distance (km)</label>
                    <input className="form-input" type="number" min={1} value={train.distance_to_destination}
                      onChange={(e) => updateTrain(i, 'distance_to_destination', Number(e.target.value))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Direction</label>
                    <select className="form-select" value={train.direction}
                      onChange={(e) => updateTrain(i, 'direction', e.target.value)}>
                      <option value="forward">Forward</option>
                      <option value="backward">Backward</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating…' : 'Create Scenario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
