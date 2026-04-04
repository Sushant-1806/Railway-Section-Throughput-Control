/**
 * components/map/TrackMap.jsx — SVG railway network visualizer with D3.
 *
 * Renders stations as nodes, tracks as edges, and trains as animated
 * colored dots moving along the edges. Conflict zones pulse red.
 */

import { useEffect, useRef, useMemo } from 'react'
import * as d3 from 'd3'
import useRailwayStore from '../../store/railwayStore'

const MAP_W = 900
const MAP_H = 560

const TYPE_COLORS = {
  Express:   '#3b82f6',
  Passenger: '#22c55e',
  Freight:   '#f59e0b',
  Local:     '#a78bfa',
}

const STATUS_STROKE = {
  active:        '#22c55e',
  stopped:       '#6b7280',
  speed_reduced: '#f59e0b',
  rerouted:      '#06b6d4',
  conflict:      '#ef4444',
  arrived:       '#10b981',
}

export default function TrackMap() {
  const svgRef = useRef(null)
  const { networkNodes, networkEdges, currentTrains, conflicts } = useRailwayStore()

  // Map of which trains are in conflict (for highlight)
  const conflictTrainIds = useMemo(() => {
    const ids = new Set()
    conflicts.forEach((c) => c.trains?.forEach((t) => ids.add(t)))
    return ids
  }, [conflicts])

  useEffect(() => {
    if (!svgRef.current || networkNodes.length === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const nodeMap = Object.fromEntries(networkNodes.map((n) => [n.id, n]))

    // ── Defs (markers, filters) ────────────────────────────────────────────
    const defs = svg.append('defs')

    // Arrow marker
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 18).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', 'var(--map-arrow)')

    // Glow filter
    const glowFilter = defs.append('filter').attr('id', 'glow')
    glowFilter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur')
    const feMerge = glowFilter.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'coloredBlur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    // Rail filter
    const railFilter = defs.append('filter').attr('id', 'rail')
    railFilter.append('feGaussianBlur').attr('stdDeviation', '1').attr('result', 'c')
    const fm2 = railFilter.append('feMerge')
    fm2.append('feMergeNode').attr('in', 'c')
    fm2.append('feMergeNode').attr('in', 'SourceGraphic')

    // ── Background grid ───────────────────────────────────────────────────
    const grid = svg.append('g').attr('class', 'grid')
    for (let x = 0; x <= MAP_W; x += 80) {
      grid.append('line')
        .attr('x1', x).attr('y1', 0)
        .attr('x2', x).attr('y2', MAP_H)
        .attr('stroke', 'var(--map-grid)').attr('stroke-width', 0.5)
    }
    for (let y = 0; y <= MAP_H; y += 80) {
      grid.append('line')
        .attr('x1', 0).attr('y1', y)
        .attr('x2', MAP_W).attr('y2', y)
        .attr('stroke', 'var(--map-grid)').attr('stroke-width', 0.5)
    }

    // ── Tracks (edges) ────────────────────────────────────────────────────
    // Deduplicate bidirectional edges for rendering (draw once)
    const drawnEdges = new Set()
    const edgeGroup = svg.append('g').attr('class', 'edges')

    networkEdges.forEach((edge) => {
      const key = [edge.from, edge.to].sort().join('-')
      if (drawnEdges.has(key)) return
      drawnEdges.add(key)

      const src = nodeMap[edge.from]
      const dst = nodeMap[edge.to]
      if (!src || !dst) return

      // Shadow track
      edgeGroup.append('line')
        .attr('x1', src.x).attr('y1', src.y)
        .attr('x2', dst.x).attr('y2', dst.y)
        .attr('stroke', 'var(--map-track-shadow)')
        .attr('stroke-width', 8)
        .attr('stroke-linecap', 'round')

      // Rail line
      edgeGroup.append('line')
        .attr('x1', src.x).attr('y1', src.y)
        .attr('x2', dst.x).attr('y2', dst.y)
        .attr('stroke', 'var(--map-track)')
        .attr('stroke-width', 4)
        .attr('stroke-linecap', 'round')
        .attr('marker-end', 'url(#arrow)')

      // Distance label
      const mx = (src.x + dst.x) / 2
      const my = (src.y + dst.y) / 2
      edgeGroup.append('text')
        .attr('x', mx).attr('y', my - 6)
        .attr('text-anchor', 'middle')
        .attr('fill', 'var(--map-track-label)')
        .attr('font-size', '10px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(`${edge.distance}km`)
    })

    // ── Stations (nodes) ──────────────────────────────────────────────────
    const nodeGroup = svg.append('g').attr('class', 'nodes')

    networkNodes.forEach((node) => {
      const g = nodeGroup.append('g')
        .attr('transform', `translate(${node.x},${node.y})`)
        .attr('cursor', 'pointer')

      // Outer ring
      g.append('circle').attr('r', 18).attr('fill', 'none')
        .attr('stroke', 'var(--map-station-ring)').attr('stroke-width', 2)

      // Station dot
      g.append('circle').attr('r', 12)
        .attr('fill', 'var(--map-station-fill)')
        .attr('stroke', 'var(--map-station-stroke)')
        .attr('stroke-width', 2)

      // Station label (inner)
      g.append('text')
        .attr('text-anchor', 'middle').attr('dy', '0.35em')
        .attr('fill', 'var(--map-station-label)').attr('font-size', '10px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', '600')
        .text(node.id)

      // Station name (outer)
      const isBottom = node.y > 300
      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', isBottom ? '32px' : '-22px')
        .attr('fill', 'var(--map-station-name)').attr('font-size', '9px')
        .attr('font-family', 'Manrope, sans-serif')
        .text(node.label)
    })

    // ── Trains ────────────────────────────────────────────────────────────
    const trainGroup = svg.append('g').attr('class', 'trains')

    currentTrains.forEach((train, i) => {
      const node = nodeMap[train.current_section]
      if (!node) return

      const isConflict = conflictTrainIds.has(train.train_id)
      const color = TYPE_COLORS[train.train_type] || '#94a3b8'
      const strokeColor = isConflict ? '#ef4444' : STATUS_STROKE[train.status] || '#22c55e'

      // Jitter offset so overlapping trains are visible
      const ox = (i % 3 - 1) * 18
      const oy = Math.floor(i / 3) * -16

      const g = trainGroup.append('g')
        .attr('transform', `translate(${node.x + ox},${node.y + oy})`)

      // Glow aura for conflicting trains
      if (isConflict) {
        g.append('circle').attr('r', 20)
          .attr('fill', 'none').attr('stroke', '#ef4444')
          .attr('stroke-width', 1).attr('opacity', 0.3)
          .attr('filter', 'url(#glow)')
          .append('animate')
            .attr('attributeName', 'r')
            .attr('values', '16;22;16')
            .attr('dur', '1.5s').attr('repeatCount', 'indefinite')
      }

      // Train body
      g.append('circle').attr('r', 14)
        .attr('fill', `${color}22`)
        .attr('stroke', strokeColor)
        .attr('stroke-width', 2)
        .attr('filter', 'url(#glow)')

      g.append('circle').attr('r', 9)
        .attr('fill', color)

      // Train ID text
      g.append('text')
        .attr('text-anchor', 'middle').attr('dy', '0.35em')
        .attr('fill', 'white').attr('font-size', '7px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', '700')
        .text(train.train_id.replace('T', ''))

      // Tooltip (title)
      g.append('title').text(
        `${train.train_id} (${train.train_type})\n` +
        `Speed: ${train.current_speed} km/h\n` +
        `Section: ${train.current_section} → ${train.destination}\n` +
        `Status: ${train.status}\n` +
        `Priority: ${train.priority}`
      )
    })

    // ── Legend ─────────────────────────────────────────────────────────────
    const legendGroup = svg.append('g').attr('transform', `translate(16, ${MAP_H - 80})`)
    const types = Object.entries(TYPE_COLORS)
    types.forEach(([type, color], i) => {
      legendGroup.append('circle').attr('cx', 8).attr('cy', i * 18).attr('r', 5).attr('fill', color)
      legendGroup.append('text')
        .attr('x', 18).attr('y', i * 18 + 4)
        .attr('fill', 'var(--map-legend-text)').attr('font-size', '10px').attr('font-family', 'Manrope, sans-serif')
        .text(type)
    })

  }, [networkNodes, networkEdges, currentTrains, conflictTrainIds])

  if (networkNodes.length === 0) {
    return (
      <div className="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
        </svg>
        <p>Loading network map…</p>
      </div>
    )
  }

  return (
    <div className="track-map-container" style={{ height: MAP_H }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
