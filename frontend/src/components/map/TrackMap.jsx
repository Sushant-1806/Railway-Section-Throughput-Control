/**
 * components/map/TrackMap.jsx — Tactical railway network visualizer with D3.
 *
 * "War-room" style animated map showing:
 *   - Trains as animated dots moving along track paths in real-time
 *   - Direction arrows showing movement heading
 *   - Speed labels and status indicators on each train
 *   - Collision ETA countdown at conflict zones
 *   - Pulsing conflict zones with severity rings
 *   - Movement trails showing recent train path
 */

import { useEffect, useRef, useMemo } from 'react'
import * as d3 from 'd3'
import useRailwayStore from '../../store/railwayStore'

const MAP_W = 900
const MAP_H = 560
const VISUAL_TIME_SCALE = 1800
const MIN_VISUAL_DURATION = 3
const MAX_VISUAL_DURATION = 12
const TRAIL_LENGTH = 5 // number of trail ghost positions
const IDLE_FRAME_INTERVAL = 250 // ms between frames when sim is off (~4fps)

const TYPE_COLORS = {
  Express:   '#3b82f6',
  Passenger: '#22c55e',
  Freight:   '#f59e0b',
  Local:     '#a78bfa',
}

const STATUS_STROKE = {
  active:        '#22c55e',
  stopped:       '#ef4444',
  speed_reduced: '#f59e0b',
  rerouted:      '#06b6d4',
  conflict:      '#ef4444',
  arrived:       '#10b981',
}

const STATUS_LABELS = {
  active: 'MOVING',
  stopped: 'HELD',
  speed_reduced: 'SLOW',
  rerouted: 'DETOUR',
  arrived: 'ARRIVED',
  conflict: 'ALERT',
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

/* ── Graph utilities ──────────────────────────────────────────────────────── */

function buildAdjacency(edges) {
  const adjacency = new Map()
  edges.forEach((edge) => {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, [])
    adjacency.get(edge.from).push({ to: edge.to, distance: Number(edge.distance) || 1 })
  })
  return adjacency
}

function buildEdgeLookup(edges) {
  const lookup = new Map()
  edges.forEach((edge) => {
    lookup.set(`${edge.from}->${edge.to}`, edge)
  })
  return lookup
}

function shortestPath(source, target, adjacency) {
  if (!source || !target) return []
  if (source === target) return [source]

  const distances = new Map([[source, 0]])
  const previous = new Map()
  const queue = [[0, source]]
  const visited = new Set()

  while (queue.length > 0) {
    queue.sort((a, b) => a[0] - b[0])
    const [distance, node] = queue.shift()
    if (visited.has(node)) continue
    visited.add(node)

    if (node === target) break

    const neighbors = adjacency.get(node) || []
    neighbors.forEach(({ to, distance: segmentDistance }) => {
      const nextDistance = distance + segmentDistance
      if (nextDistance < (distances.get(to) ?? Infinity)) {
        distances.set(to, nextDistance)
        previous.set(to, node)
        queue.push([nextDistance, to])
      }
    })
  }

  if (!distances.has(target)) return []

  const path = [target]
  while (path[0] !== source) {
    const previousNode = previous.get(path[0])
    if (!previousNode) return []
    path.unshift(previousNode)
  }
  return path
}

function buildGeometry(path, nodeMap, edgeLookup) {
  const fallback = path.length > 0 && nodeMap[path[0]]
    ? { x: nodeMap[path[0]].x, y: nodeMap[path[0]].y }
    : { x: MAP_W / 2, y: MAP_H / 2 }

  if (path.length < 2) {
    return { nodes: path, segments: [], totalDistance: 0, fallback }
  }

  const segments = []
  let totalDistance = 0

  for (let index = 0; index < path.length - 1; index += 1) {
    const fromNode = nodeMap[path[index]]
    const toNode = nodeMap[path[index + 1]]
    if (!fromNode || !toNode) continue

    const edge = edgeLookup.get(`${path[index]}->${path[index + 1]}`)
    const distance = Number(edge?.distance) || Math.max(1, Math.hypot(toNode.x - fromNode.x, toNode.y - fromNode.y) / 10)

    segments.push({
      from: fromNode,
      to: toNode,
      distance,
      start: totalDistance,
      end: totalDistance + distance,
    })

    totalDistance += distance
  }

  return { nodes: path, segments, totalDistance, fallback }
}

function pointAtDistance(geometry, distance) {
  if (geometry.segments.length === 0 || geometry.totalDistance <= 0) {
    return { x: geometry.fallback.x, y: geometry.fallback.y, angle: 0 }
  }

  const clampedDistance = clamp(distance, 0, geometry.totalDistance)
  const segment = geometry.segments.find((entry) => clampedDistance <= entry.end) || geometry.segments[geometry.segments.length - 1]
  const localDistance = clampedDistance - segment.start
  const ratio = segment.distance <= 0 ? 1 : clamp(localDistance / segment.distance, 0, 1)
  const x = segment.from.x + (segment.to.x - segment.from.x) * ratio
  const y = segment.from.y + (segment.to.y - segment.from.y) * ratio
  const angle = Math.atan2(segment.to.y - segment.from.y, segment.to.x - segment.from.x) * 180 / Math.PI

  return { x, y, angle }
}

function getTrainSignature(train) {
  return [
    train.current_section,
    train.destination,
    train.current_speed,
    train.status,
    train.direction || 'forward',
  ].join('|')
}

function getVisualDuration(train, geometry) {
  const speed = Math.max(Number(train.current_speed) || 0, 1)
  const travelDistance = Math.max(
    Number(train.distance_to_destination) || 0,
    geometry.totalDistance || 0,
    1,
  )
  const etaSeconds = (travelDistance / speed) * 3600
  return clamp(etaSeconds / VISUAL_TIME_SCALE, MIN_VISUAL_DURATION, MAX_VISUAL_DURATION)
}

function getConflictAnchor(conflict, nodeMap) {
  if (!conflict?.section) return null

  if (conflict.section.includes('-')) {
    const [from, to] = conflict.section.split('-')
    const fromNode = nodeMap[from]
    const toNode = nodeMap[to]
    if (fromNode && toNode) {
      return { x: (fromNode.x + toNode.x) / 2, y: (fromNode.y + toNode.y) / 2 }
    }
  }

  const node = nodeMap[conflict.section]
  if (!node) return null
  return { x: node.x, y: node.y }
}

/* ── Component ────────────────────────────────────────────────────────────── */

export default function TrackMap() {
  const svgRef = useRef(null)
  const trainLayerRef = useRef(null)
  const conflictLayerRef = useRef(null)
  const motionRef = useRef(new Map())
  const pathCacheRef = useRef(new Map())
  const currentTrainsRef = useRef([])
  const conflictsRef = useRef([])
  const conflictIdsRef = useRef(new Set())
  const simRunningRef = useRef(false)
  const frameRef = useRef(null)
  const lastFrameTimeRef = useRef(0)
  const trailHistoryRef = useRef(new Map()) // train_id -> [{x,y}...]

  const { networkNodes, networkEdges, currentTrains, conflicts, simulationRunning } = useRailwayStore()

  const nodeMap = useMemo(() => Object.fromEntries(networkNodes.map((node) => [node.id, node])), [networkNodes])
  const adjacency = useMemo(() => buildAdjacency(networkEdges), [networkEdges])
  const edgeLookup = useMemo(() => buildEdgeLookup(networkEdges), [networkEdges])

  // Map of which trains are in conflict (for highlight)
  const conflictTrainIds = useMemo(() => {
    const ids = new Set()
    conflicts.forEach((c) => c.trains?.forEach((t) => ids.add(t)))
    return ids
  }, [conflicts])

  // ── Sync React state into refs for the animation loop ──────────────────
  useEffect(() => { currentTrainsRef.current = currentTrains }, [currentTrains])
  useEffect(() => { conflictsRef.current = conflicts }, [conflicts])
  useEffect(() => { conflictIdsRef.current = conflictTrainIds }, [conflictTrainIds])
  useEffect(() => { simRunningRef.current = simulationRunning }, [simulationRunning])

  useEffect(() => {
    motionRef.current = new Map()
    pathCacheRef.current = new Map()
  }, [adjacency, edgeLookup])

  /* ── Main D3 setup effect (runs only when network topology changes) ───── */
  useEffect(() => {
    if (!svgRef.current || networkNodes.length === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const nodeMapLocal = Object.fromEntries(networkNodes.map((n) => [n.id, n]))

    // ── Defs (markers, filters, gradients) ──────────────────────────────
    const defs = svg.append('defs')

    // Arrow marker for tracks
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 18).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', 'var(--map-arrow)')

    // Direction arrow marker for trains
    defs.append('marker')
      .attr('id', 'train-dir')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 6).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
        .attr('d', 'M0,-4L8,0L0,4Z')
        .attr('fill', '#fff')
        .attr('opacity', 0.9)

    // Glow filter
    const glowFilter = defs.append('filter').attr('id', 'glow')
    glowFilter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur')
    const feMerge = glowFilter.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'coloredBlur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    // Strong glow for conflicts
    const conflictGlow = defs.append('filter').attr('id', 'conflict-glow')
    conflictGlow.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'blur')
    const fm3 = conflictGlow.append('feMerge')
    fm3.append('feMergeNode').attr('in', 'blur')
    fm3.append('feMergeNode').attr('in', 'SourceGraphic')

    // Rail filter
    const railFilter = defs.append('filter').attr('id', 'rail')
    railFilter.append('feGaussianBlur').attr('stdDeviation', '1').attr('result', 'c')
    const fm2 = railFilter.append('feMerge')
    fm2.append('feMergeNode').attr('in', 'c')
    fm2.append('feMergeNode').attr('in', 'SourceGraphic')

    // ── Background grid (subtle tactical grid) ──────────────────────────
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

    // ── Tracks (edges) ──────────────────────────────────────────────────
    const drawnEdges = new Set()
    const edgeGroup = svg.append('g').attr('class', 'edges')

    networkEdges.forEach((edge) => {
      const key = [edge.from, edge.to].sort().join('-')
      if (drawnEdges.has(key)) return
      drawnEdges.add(key)

      const src = nodeMapLocal[edge.from]
      const dst = nodeMapLocal[edge.to]
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

    // ── Stations (nodes) ────────────────────────────────────────────────
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

    // ── Dynamic Layers ──────────────────────────────────────────────────
    const trailLayer = svg.append('g').attr('class', 'trail-layer')
    const conflictLayer = svg.append('g').attr('class', 'conflict-markers')
    const trainGroup = svg.append('g').attr('class', 'trains')
    trainLayerRef.current = trainGroup
    conflictLayerRef.current = conflictLayer

    // ── Legend ─────────────────────────────────────────────────────────
    const legendGroup = svg.append('g').attr('transform', `translate(16, ${MAP_H - 80})`)
    const types = Object.entries(TYPE_COLORS)
    types.forEach(([type, color], i) => {
      legendGroup.append('circle').attr('cx', 8).attr('cy', i * 18).attr('r', 5).attr('fill', color)
      legendGroup.append('text')
        .attr('x', 18).attr('y', i * 18 + 4)
        .attr('fill', 'var(--map-legend-text)').attr('font-size', '10px').attr('font-family', 'Manrope, sans-serif')
        .text(type)
    })

    /* ── Geometry helper ─────────────────────────────────────────────── */
    const getGeometryForTrain = (train) => {
      const cacheKey = `${train.current_section}->${train.destination}`
      const cached = pathCacheRef.current.get(cacheKey)
      if (cached) return cached

      const path = shortestPath(train.current_section, train.destination, adjacency)
      const geometry = buildGeometry(path, nodeMapLocal, edgeLookup)
      pathCacheRef.current.set(cacheKey, geometry)
      return geometry
    }

    /* ── Animation loop ──────────────────────────────────────────────── */
    const renderFrame = (now) => {
      const isSimRunning = simRunningRef.current

      // Throttle frame rate when simulation is off (just enough for subtle pulses)
      if (!isSimRunning) {
        const elapsed = now - lastFrameTimeRef.current
        if (elapsed < IDLE_FRAME_INTERVAL) {
          frameRef.current = window.requestAnimationFrame(renderFrame)
          return
        }
      }
      lastFrameTimeRef.current = now

      const liveTrains = currentTrainsRef.current
      const liveConflicts = conflictsRef.current || []
      const conflictIds = conflictIdsRef.current

      /* ═══ TRAINS ═══════════════════════════════════════════════════ */

      const renderedTrains = liveTrains.map((train, index) => {
        const signature = getTrainSignature(train)
        let motion = motionRef.current.get(train.train_id)

        if (!motion || motion.signature !== signature) {
          const geometry = getGeometryForTrain(train)
          const durationMs = getVisualDuration(train, geometry) * 1000
          motion = {
            signature,
            geometry,
            durationMs,
            startTime: now,
          }
          motionRef.current.set(train.train_id, motion)
        }

        const geometry = motion.geometry
        const status = train.status || 'active'
        const isStopped = status === 'stopped' || status === 'arrived' || Number(train.current_speed) <= 0
        const totalDistance = geometry.totalDistance || 0
        const shouldAnimate = isSimRunning && totalDistance > 0 && !isStopped

        let travelled = 0
        if (status === 'arrived') {
          travelled = totalDistance
        } else if (shouldAnimate && Number.isFinite(motion.durationMs) && motion.durationMs > 0) {
          travelled = clamp((now - motion.startTime) / motion.durationMs, 0, 1) * totalDistance
        }

        const position = pointAtDistance(geometry, travelled)
        const speed = Number(train.current_speed) || 0
        const conflict = conflictIds.has(train.train_id)
        const color = TYPE_COLORS[train.train_type] || '#94a3b8'
        const strokeColor = conflict ? STATUS_STROKE.conflict : STATUS_STROKE[status] || STATUS_STROKE.active
        const auraOpacity = conflict
          ? 0.42 + 0.18 * Math.sin(now / 180 + index)
          : (shouldAnimate ? 0.22 + 0.1 * Math.sin(now / 520 + index) : 0.10)

        // Update trail history
        const trailKey = train.train_id
        let history = trailHistoryRef.current.get(trailKey) || []
        if (shouldAnimate) {
          const lastPoint = history[history.length - 1]
          if (!lastPoint || Math.hypot(position.x - lastPoint.x, position.y - lastPoint.y) > 2) {
            history.push({ x: position.x, y: position.y })
            if (history.length > TRAIL_LENGTH) history = history.slice(-TRAIL_LENGTH)
            trailHistoryRef.current.set(trailKey, history)
          }
        }

        return {
          ...train,
          x: position.x,
          y: position.y,
          angle: position.angle,
          trail: history,
          speed,
          color,
          strokeColor,
          auraOpacity,
          isConflict: conflict,
          isStopped,
          shouldAnimate,
          statusLabel: conflict ? STATUS_LABELS.conflict : STATUS_LABELS[status] || 'MOVING',
        }
      })

      // ── Trail rendering ─────────────────────────────────────────────
      const trailData = renderedTrains.filter((t) => t.trail.length > 1 && t.shouldAnimate)
      const trailSel = trailLayer.selectAll('g.trail-group').data(trailData, (d) => d.train_id)

      trailSel.exit().remove()

      const trailEnter = trailSel.enter().append('g').attr('class', 'trail-group')
      trailEnter.append('polyline').attr('class', 'trail-line')

      const trailMerged = trailEnter.merge(trailSel)
      trailMerged.select('polyline.trail-line')
        .attr('points', (d) => d.trail.map((p) => `${p.x},${p.y}`).join(' '))
        .attr('fill', 'none')
        .attr('stroke', (d) => d.color)
        .attr('stroke-width', 3)
        .attr('stroke-opacity', 0.35)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')

      // ── Train rendering ─────────────────────────────────────────────
      const trainSelection = trainGroup.selectAll('g.train-group').data(renderedTrains, (d) => d.train_id)
      const trainEnter = trainSelection.enter().append('g').attr('class', 'train-group')

      // Aura ring
      trainEnter.append('circle').attr('class', 'train-aura').attr('r', 18).attr('fill', 'none').attr('stroke-width', 2)
      // Body circle
      trainEnter.append('circle').attr('class', 'train-body').attr('r', 12)
      // Core
      trainEnter.append('circle').attr('class', 'train-core').attr('r', 7)
      // Direction arrow (line extending from train center in direction of movement)
      trainEnter.append('line').attr('class', 'train-dir-arrow')
      // Speed label
      trainEnter.append('text').attr('class', 'train-speed-label')
      // Status label
      trainEnter.append('text').attr('class', 'train-status-label')
      // ID label
      trainEnter.append('text').attr('class', 'train-id-label')
      // Tooltip
      trainEnter.append('title')

      const trainMerged = trainEnter.merge(trainSelection)
      trainMerged.attr('transform', (d) => `translate(${d.x},${d.y})`)

      // Aura
      trainMerged.select('circle.train-aura')
        .attr('stroke', (d) => d.isConflict ? '#ef4444' : d.color)
        .attr('opacity', (d) => d.auraOpacity)
        .attr('r', (d) => d.isConflict ? 20 + 2 * Math.sin(now / 200) : 18)
        .attr('filter', (d) => d.isConflict ? 'url(#conflict-glow)' : 'url(#glow)')

      // Body
      trainMerged.select('circle.train-body')
        .attr('fill', (d) => d.color)
        .attr('fill-opacity', (d) => d.status === 'arrived' ? 0.15 : d.isStopped ? 0.25 : 0.22)
        .attr('stroke', (d) => d.strokeColor)
        .attr('stroke-width', (d) => d.isConflict ? 3 : 2)
        .attr('filter', 'url(#glow)')

      // Core
      trainMerged.select('circle.train-core')
        .attr('fill', (d) => d.color)
        .attr('opacity', (d) => d.isStopped ? 0.5 : 1)

      // Direction arrow — a line extending from train center in direction of travel
      trainMerged.select('line.train-dir-arrow')
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', (d) => d.shouldAnimate ? Math.cos(d.angle * Math.PI / 180) * 22 : 0)
        .attr('y2', (d) => d.shouldAnimate ? Math.sin(d.angle * Math.PI / 180) * 22 : 0)
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)
        .attr('stroke-opacity', (d) => d.shouldAnimate ? 0.8 : 0)
        .attr('marker-end', (d) => d.shouldAnimate ? 'url(#train-dir)' : '')

      // Speed label (below train)
      trainMerged.select('text.train-speed-label')
        .attr('text-anchor', 'middle')
        .attr('dy', '28px')
        .attr('fill', (d) => d.isStopped ? '#ef4444' : 'var(--map-legend-text)')
        .attr('font-size', '9px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', '600')
        .text((d) => d.isStopped && d.status !== 'arrived' ? `0 km/h` : `${d.speed} km/h`)

      // Status label (above train)
      trainMerged.select('text.train-status-label')
        .attr('text-anchor', 'middle')
        .attr('dy', '-24px')
        .attr('fill', (d) => d.isConflict ? '#ef4444' : d.isStopped ? '#f59e0b' : 'var(--map-legend-text)')
        .attr('font-size', '8px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', '700')
        .attr('letter-spacing', '0.05em')
        .attr('opacity', (d) => d.isConflict ? 0.7 + 0.3 * Math.sin(now / 300) : 0.7)
        .text((d) => d.statusLabel)

      // Train ID label (further above)
      trainMerged.select('text.train-id-label')
        .attr('text-anchor', 'middle')
        .attr('dy', '-34px')
        .attr('fill', (d) => d.color)
        .attr('font-size', '9px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', '700')
        .text((d) => d.train_id)

      // Tooltip
      trainMerged.select('title').text((d) => (
        `${d.train_id} (${d.train_type})\n`
        + `Speed: ${d.speed} km/h\n`
        + `Section: ${d.current_section} → ${d.destination}\n`
        + `Status: ${d.status}\n`
        + `Priority: ${d.priority}`
      ))

      trainSelection.exit().remove()

      /* ═══ CONFLICT ZONES ═══════════════════════════════════════════ */

      const renderedConflicts = liveConflicts
        .map((conflict, index) => {
          const anchor = getConflictAnchor(conflict, nodeMapLocal)
          if (!anchor) return null

          const severity = conflict.severity || 'medium'
          const baseRadius = severity === 'critical' ? 22 : severity === 'high' ? 18 : 14
          const eta = conflict.predicted_in_seconds || 0

          // Format ETA for display
          let etaLabel = ''
          if (eta > 0) {
            const mins = Math.floor(eta / 60)
            const secs = Math.round(eta % 60)
            etaLabel = mins > 0 ? `ETA ${mins}m ${secs}s` : `ETA ${secs}s`
          } else {
            etaLabel = 'NOW'
          }

          return {
            ...conflict,
            key: `${conflict.conflict_id}-${conflict.section}`,
            x: anchor.x,
            y: anchor.y,
            severity,
            baseRadius,
            pulse: Math.sin(now / 220 + index),
            etaLabel,
            eta,
          }
        })
        .filter(Boolean)

      const conflictSelection = conflictLayer.selectAll('g.conflict-marker').data(renderedConflicts, (d) => d.key)
      const conflictEnter = conflictSelection.enter().append('g').attr('class', 'conflict-marker')

      // Outer pulse ring
      conflictEnter.append('circle').attr('class', 'conflict-pulse-ring')
      // Inner pulse ring
      conflictEnter.append('circle').attr('class', 'conflict-inner-ring')
      // Core dot
      conflictEnter.append('circle').attr('class', 'conflict-marker-core').attr('r', 5)
      // ETA label
      conflictEnter.append('text').attr('class', 'conflict-eta-label')
      // Section label
      conflictEnter.append('text').attr('class', 'conflict-section-label')
      // Tooltip
      conflictEnter.append('title')

      const conflictMerged = conflictEnter.merge(conflictSelection)
      conflictMerged.attr('transform', (d) => `translate(${d.x},${d.y})`)

      // Outer pulse
      conflictMerged.select('circle.conflict-pulse-ring')
        .attr('r', (d) => d.baseRadius + 6 + d.pulse * 4)
        .attr('fill', 'none')
        .attr('stroke', (d) => d.severity === 'critical' ? '#ef4444' : d.severity === 'high' ? '#f59e0b' : '#fb7185')
        .attr('stroke-width', 2)
        .attr('opacity', (d) => d.severity === 'critical' ? 0.5 + 0.2 * Math.sin(now / 140) : 0.4 + 0.15 * Math.sin(now / 160))

      // Inner pulse
      conflictMerged.select('circle.conflict-inner-ring')
        .attr('r', (d) => d.baseRadius + d.pulse * 2)
        .attr('fill', (d) => d.severity === 'critical' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.06)')
        .attr('stroke', (d) => d.severity === 'critical' ? '#ef4444' : '#f59e0b')
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.6)

      // Core
      conflictMerged.select('circle.conflict-marker-core')
        .attr('fill', (d) => d.severity === 'critical' ? '#ef4444' : d.severity === 'high' ? '#f59e0b' : '#fb7185')
        .attr('r', (d) => 4 + Math.abs(d.pulse))

      // ETA label (below conflict zone)
      conflictMerged.select('text.conflict-eta-label')
        .attr('text-anchor', 'middle')
        .attr('dy', (d) => d.baseRadius + 18)
        .attr('fill', (d) => d.eta === 0 ? '#ef4444' : '#f59e0b')
        .attr('font-size', '10px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', '800')
        .attr('opacity', (d) => d.eta === 0 ? 0.7 + 0.3 * Math.sin(now / 200) : 0.85)
        .text((d) => d.etaLabel)

      // Section label (above conflict zone)
      conflictMerged.select('text.conflict-section-label')
        .attr('text-anchor', 'middle')
        .attr('dy', (d) => -(d.baseRadius + 8))
        .attr('fill', (d) => d.severity === 'critical' ? '#ef4444' : '#f59e0b')
        .attr('font-size', '8px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', '600')
        .attr('letter-spacing', '0.06em')
        .text((d) => `⚠ ${d.type?.replace('_', ' ').toUpperCase()}`)

      // Tooltip
      conflictMerged.select('title').text((d) => (
        `${d.conflict_id} · ${d.type?.replace('_', ' ')}\n`
        + `Section: ${d.section}\n`
        + `Trains: ${(d.trains || []).join(', ')}\n`
        + `Severity: ${d.severity}\n`
        + `ETA: ${d.etaLabel}`
      ))

      conflictSelection.exit().remove()

      // Schedule next frame
      frameRef.current = window.requestAnimationFrame(renderFrame)
    }

    frameRef.current = window.requestAnimationFrame(renderFrame)

    return () => {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current)
      }
      frameRef.current = null
      trainLayerRef.current = null
      conflictLayerRef.current = null
      svg.selectAll('*').remove()
    }

  }, [networkNodes, networkEdges, nodeMap, adjacency, edgeLookup])
  //     ^ NOTE: simulationRunning deliberately removed from deps

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
