/**
 * pages/MapPage.jsx — Full-screen tactical track map with live controls and status HUD.
 */

import { useEffect } from 'react'
import { Map, Play, Square, Activity, AlertTriangle, Pause } from 'lucide-react'
import toast from 'react-hot-toast'
import useRailwayStore from '../store/railwayStore'
import { useSocket } from '../hooks/useSocket'
import * as api from '../services/api'
import TrackMap from '../components/map/TrackMap'

export default function MapPage() {
  const {
    currentScenarioId, simulationRunning, conflicts, currentTrains,
    setNetwork, networkNodes, setSimulationRunning,
  } = useRailwayStore()

  useSocket(currentScenarioId)

  useEffect(() => {
    if (networkNodes.length === 0) {
      api.fetchNetwork()
        .then((r) => setNetwork(r.data.nodes, r.data.edges))
        .catch(() => toast.error('Failed to load network'))
    }
  }, [])

  const handleStartSim = async () => {
    if (!currentScenarioId) return toast.error('Load a scenario from the Dashboard first')
    setSimulationRunning(true)
    try {
      await api.startSimulation(currentScenarioId)
      toast.success('Simulation started')
    } catch {
      setSimulationRunning(false)
      toast.error('Failed to start simulation')
    }
  }

  const handleStopSim = async () => {
    if (!currentScenarioId) return
    setSimulationRunning(false)
    try {
      await api.stopSimulation(currentScenarioId)
      toast.success('Simulation stopped')
    } catch {
      setSimulationRunning(true)
      toast.error('Failed to stop simulation')
    }
  }

  const activeTrains = currentTrains.filter((t) => t.status === 'active' || t.status === 'speed_reduced' || t.status === 'rerouted').length
  const stoppedTrains = currentTrains.filter((t) => t.status === 'stopped').length
  const arrivedTrains = currentTrains.filter((t) => t.status === 'arrived').length
  const criticalConflicts = conflicts.filter((c) => c.severity === 'critical').length

  return (
    <div>
      <div className="flex items-center justify-between mb-4" style={{ marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
            Track Map
          </h1>
          <p className="text-muted text-sm" style={{ marginTop: 4 }}>
            Tactical railway network visualization
            {simulationRunning && <span style={{ color: 'var(--success)', fontWeight: 600 }}> · LIVE</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {!simulationRunning ? (
            <button className="btn btn-success btn-sm" onClick={handleStartSim}>
              <Play size={14}/> Start Simulation
            </button>
          ) : (
            <button className="btn btn-danger btn-sm" onClick={handleStopSim}>
              <Square size={14}/> Stop Simulation
            </button>
          )}
        </div>
      </div>

      {/* Status HUD Bar */}
      <div className="card" style={{ marginBottom: 16, padding: '10px 20px' }}>
        <div className="flex gap-4" style={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>

          {/* Left: train type legend */}
          <div className="flex gap-4" style={{ flexWrap: 'wrap' }}>
            {[
              { color: '#3b82f6', label: 'Express' },
              { color: '#22c55e', label: 'Passenger' },
              { color: '#f59e0b', label: 'Freight' },
              { color: '#a78bfa', label: 'Local' },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
                <span className="text-sm text-muted">{label}</span>
              </div>
            ))}
          </div>

          {/* Right: live counters */}
          <div className="flex gap-4" style={{ flexWrap: 'wrap' }}>
            <div className="hud-stat">
              <Activity size={13} style={{ color: 'var(--success)' }} />
              <span className="text-sm">
                <strong>{activeTrains}</strong> Moving
              </span>
            </div>
            <div className="hud-stat">
              <Pause size={13} style={{ color: 'var(--text-muted)' }} />
              <span className="text-sm">
                <strong>{stoppedTrains}</strong> Held
              </span>
            </div>
            {arrivedTrains > 0 && (
              <div className="hud-stat">
                <span className="text-sm" style={{ color: 'var(--success)' }}>
                  <strong>{arrivedTrains}</strong> Arrived
                </span>
              </div>
            )}
            {conflicts.length > 0 && (
              <div className="hud-stat" style={{ color: 'var(--danger)' }}>
                <AlertTriangle size={13} />
                <span className="text-sm">
                  <strong>{conflicts.length}</strong> Conflict{conflicts.length > 1 ? 's' : ''}
                  {criticalConflicts > 0 && <span> ({criticalConflicts} critical)</span>}
                </span>
              </div>
            )}
            <div className="hud-stat">
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: simulationRunning ? '#22c55e' : '#6b7280',
                boxShadow: simulationRunning ? '0 0 6px #22c55e' : 'none',
              }} />
              <span className="text-sm text-muted">{simulationRunning ? 'LIVE' : 'PAUSED'}</span>
            </div>
          </div>
        </div>
      </div>

      <TrackMap />
    </div>
  )
}
