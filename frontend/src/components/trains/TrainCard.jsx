/**
 * components/trains/TrainCard.jsx — Individual train status card.
 */

import { Gauge, MapPin, Navigation, Star } from 'lucide-react'

export default function TrainCard({ train, isConflict }) {
  const statusMap = {
    active:        'active',
    stopped:       'stopped',
    speed_reduced: 'rerouted',
    rerouted:      'rerouted',
    conflict:      'conflict',
    arrived:       'arrived',
  }

  return (
    <div className={`train-card ${isConflict ? 'conflict' : ''}`}>
      <div className="train-card-header">
        <span className="train-id">{train.train_id}</span>
        <span className="train-type-badge">{train.train_type}</span>
      </div>

      <div className="train-stats">
        <div className="stat-item">
          <span className="stat-label">Speed</span>
          <span className="stat-value">
            <Gauge size={12} style={{ display: 'inline', marginRight: 4 }} />
            {train.current_speed} km/h
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Priority</span>
          <span className="stat-value">
            <Star size={12} style={{ display: 'inline', marginRight: 4 }} />
            Level {train.priority}
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Section</span>
          <span className="stat-value">
            <MapPin size={12} style={{ display: 'inline', marginRight: 4 }} />
            {train.current_section}
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Distance</span>
          <span className="stat-value">{train.distance_to_destination} km</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', marginTop: 12, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        <span className={`status-dot ${statusMap[train.status] || 'active'}`} />
        <Navigation size={11} style={{ marginRight: 4 }} />
        {train.destination}
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', background: 'var(--bg-base)', padding: '2px 8px', borderRadius: 999, color: 'var(--text-muted)' }}>
          {train.direction || 'forward'}
        </span>
      </div>
    </div>
  )
}
