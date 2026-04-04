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
const VISUAL_TIME_SCALE = 1800
const MIN_VISUAL_DURATION = 3
const MAX_VISUAL_DURATION = 12
const TRAIL_MIN = 18
const TRAIL_MAX = 36

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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

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

export default function TrackMap() {
  const svgRef = useRef(null)
  const trainLayerRef = useRef(null)
  const conflictLayerRef = useRef(null)
  const motionRef = useRef(new Map())
  const pathCacheRef = useRef(new Map())
  const currentTrainsRef = useRef([])
  const conflictIdsRef = useRef(new Set())
  const frameRef = useRef(null)
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

  useEffect(() => {
    currentTrainsRef.current = currentTrains
  }, [currentTrains])

  useEffect(() => {
    conflictIdsRef.current = conflictTrainIds
  }, [conflictTrainIds])

  useEffect(() => {
    motionRef.current = new Map()
    pathCacheRef.current = new Map()
  }, [adjacency, edgeLookup])

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

    // ── Dynamic Layers ────────────────────────────────────────────────────
    const conflictLayer = svg.append('g').attr('class', 'conflict-markers')
    const trainGroup = svg.append('g').attr('class', 'trains')
    trainLayerRef.current = trainGroup
    conflictLayerRef.current = conflictLayer

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

    const getGeometryForTrain = (train) => {
      const cacheKey = `${train.current_section}->${train.destination}`
      const cached = pathCacheRef.current.get(cacheKey)
      if (cached) return cached

      const path = shortestPath(train.current_section, train.destination, adjacency)
      const geometry = buildGeometry(path, nodeMap, edgeLookup)
      pathCacheRef.current.set(cacheKey, geometry)
      return geometry
    }

    const renderFrame = (now) => {
      const liveTrains = currentTrainsRef.current
      const conflictIds = conflictIdsRef.current

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
        const shouldAnimate = simulationRunning && totalDistance > 0 && !isStopped

        let travelled = 0
        if (status === 'arrived') {
          travelled = totalDistance
        } else if (shouldAnimate && Number.isFinite(motion.durationMs) && motion.durationMs > 0) {
          travelled = clamp((now - motion.startTime) / motion.durationMs, 0, 1) * totalDistance
        }

        const trailDistance = Math.max(0, travelled - clamp(totalDistance * 0.08, TRAIL_MIN, TRAIL_MAX))
        const position = pointAtDistance(geometry, travelled)
        const trailPosition = pointAtDistance(geometry, trailDistance)
        const conflict = conflictIds.has(train.train_id)
        const color = TYPE_COLORS[train.train_type] || '#94a3b8'
        const strokeColor = conflict ? STATUS_STROKE.conflict : STATUS_STROKE[status] || STATUS_STROKE.active
        const auraOpacity = conflict ? 0.42 + 0.18 * Math.sin(now / 180 + index) : 0.18 + 0.08 * Math.sin(now / 520 + index)

        return {
          ...train,
          x: position.x,
          y: position.y,
          trailX: trailPosition.x,
          trailY: trailPosition.y,
          color,
          strokeColor,
          auraOpacity,
          isConflict: conflict,
        }
      })

      const trainSelection = trainGroup.selectAll('g.train-group').data(renderedTrains, (d) => d.train_id)
      const trainEnter = trainSelection.enter().append('g').attr('class', 'train-group')

      trainEnter.append('line').attr('class', 'train-trail')
      trainEnter.append('circle').attr('class', 'train-aura').attr('r', 17).attr('fill', 'none').attr('stroke-width', 2)
      trainEnter.append('circle').attr('class', 'train-body').attr('r', 12)
      trainEnter.append('circle').attr('class', 'train-core').attr('r', 7)
      trainEnter.append('title')

      const trainMerged = trainEnter.merge(trainSelection)
      trainMerged.attr('transform', (d) => `translate(${d.x},${d.y})`)

      trainMerged.select('line.train-trail')
        .attr('x1', (d) => d.trailX - d.x)
        .attr('y1', (d) => d.trailY - d.y)
        .attr('x2', 0)
        .attr('y2', 0)
        .attr('stroke', (d) => d.color)
        .attr('stroke-opacity', (d) => d.isConflict ? 0.72 : 0.5)
        .attr('stroke-width', (d) => d.isConflict ? 4 : 3)

      trainMerged.select('circle.train-aura')
        .attr('stroke', (d) => d.isConflict ? '#ef4444' : d.color)
        .attr('opacity', (d) => d.auraOpacity)
        .attr('filter', 'url(#glow)')

      trainMerged.select('circle.train-body')
        .attr('fill', (d) => d.color)
        .attr('fill-opacity', (d) => d.status === 'arrived' ? 0.2 : d.status === 'stopped' ? 0.14 : 0.22)
        .attr('stroke', (d) => d.strokeColor)
        .attr('stroke-width', 2)
        .attr('filter', 'url(#glow)')

      trainMerged.select('circle.train-core')
        .attr('fill', (d) => d.color)

      trainMerged.select('title').text((d) => (
        `${d.train_id} (${d.train_type})\n`
        + `Speed: ${d.current_speed} km/h\n`
        + `Section: ${d.current_section} → ${d.destination}\n`
        + `Status: ${d.status}\n`
        + `Priority: ${d.priority}`
      ))

      trainSelection.exit().remove()

      const renderedConflicts = (conflictsRef.current || [])
        .map((conflict, index) => {
          const anchor = getConflictAnchor(conflict, nodeMap)
          if (!anchor) return null

          const severity = conflict.severity || 'medium'
          const baseRadius = severity === 'critical' ? 16 : severity === 'high' ? 14 : 12

          return {
            ...conflict,
            key: `${conflict.conflict_id}-${conflict.section}`,
            x: anchor.x,
            y: anchor.y,
            severity,
            baseRadius,
            pulse: Math.sin(now / 220 + index),
          }
        })
        .filter(Boolean)

      const conflictSelection = conflictLayer.selectAll('g.conflict-marker').data(renderedConflicts, (d) => d.key)
      const conflictEnter = conflictSelection.enter().append('g').attr('class', 'conflict-marker')

      conflictEnter.append('circle').attr('class', 'conflict-marker-pulse').attr('fill', 'none')
      conflictEnter.append('circle').attr('class', 'conflict-marker-core').attr('r', 4)
      conflictEnter.append('title')

      const conflictMerged = conflictEnter.merge(conflictSelection)
      conflictMerged.attr('transform', (d) => `translate(${d.x},${d.y})`)

      conflictMerged.select('circle.conflict-marker-pulse')
        .attr('r', (d) => d.baseRadius + 4 + d.pulse * 2)
        .attr('stroke', (d) => (d.severity === 'critical' ? '#ef4444' : d.severity === 'high' ? '#f59e0b' : '#fb7185'))
        .attr('opacity', (d) => (d.severity === 'critical' ? 0.58 + 0.12 * Math.sin(now / 140) : 0.48 + 0.1 * Math.sin(now / 160)))

      conflictMerged.select('circle.conflict-marker-core')
        .attr('fill', (d) => (d.severity === 'critical' ? '#ef4444' : d.severity === 'high' ? '#f59e0b' : '#fb7185'))

      conflictMerged.select('title').text((d) => (
        `${d.conflict_id} · ${d.type.replace('_', ' ')}\n`
        + `Section: ${d.section}\n`
        + `Trains: ${(d.trains || []).join(', ')}\n`
        + `Severity: ${d.severity}`
      ))

      conflictSelection.exit().remove()

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

  }, [networkNodes, networkEdges, nodeMap, adjacency, edgeLookup, simulationRunning])

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
