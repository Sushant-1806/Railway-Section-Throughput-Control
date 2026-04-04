/**
 * pages/MapPage.jsx — Full-screen track map with live controls.
 */

import { useEffect } from 'react'
import { Map, Play, Square } from 'lucide-react'
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

  return (
    <div>
      <div className="flex items-center justify-between mb-4" style={{ marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em' }}>Track Map</h1>
          <p className="text-muted text-sm" style={{ marginTop: 4 }}>
            Live railway network visualization · {currentTrains.length} trains
            {conflicts.length > 0 && <span className="text-danger"> · {conflicts.length} conflicts</span>}
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

      {/* Legend */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 20px' }}>
        <div className="flex gap-4" style={{ flexWrap: 'wrap' }}>
          {[
            { color: '#3b82f6', label: 'Express' },
            { color: '#22c55e', label: 'Passenger' },
            { color: '#f59e0b', label: 'Freight' },
            { color: '#a78bfa', label: 'Local' },
            { color: '#ef4444', label: 'Conflict' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display:'flex', alignItems:'center', gap:6 }}>
              <div style={{ width:10, height:10, borderRadius:'50%', background:color }} />
              <span className="text-sm text-muted">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <TrackMap />
    </div>
  )
}
