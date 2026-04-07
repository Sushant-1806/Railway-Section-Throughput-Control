/**
 * components/map/TrackMap.jsx — Live tactical railway map with D3.
 *
 * Smooth train animation architecture:
 *   1. Backend sends authoritative path_progress (0–1) every 0.25s via WebSocket
 *      (SIM_TIME_MULTIPLIER=180 in simulator.py — movie-paced, not too fast/slow)
 *   2. Frontend runs at native 60fps continuously, ALWAYS extrapolating train positions
 *      forward in time — the map is NEVER static, even between backend ticks
 *   3. LERP_FACTOR=0.3 gives game-like snappy corrections without jitter
 *   4. EXTRAP_SPEED_FACTOR=180 exactly matches the backend multiplier so
 *      visual speed === computed speed — no drift
 *
 * Features:
 *   - Continuous COD-style train movement along computed paths
 *   - Direction arrows showing heading
 *   - Speed + status labels on each train
 *   - Collision ETA countdowns at conflict zones
 *   - Pulsing severity rings on conflicts
 *   - Movement trail polylines
 *   - Trains HALT at conflict location
 *   - Trains resume after conflict clears
 */

import { useEffect, useRef, useMemo } from 'react'
import * as d3 from 'd3'
import useRailwayStore from '../../store/railwayStore'

/* ── Constants ────────────────────────────────────────────────────────────── */

const MAP_W = 900
const MAP_H = 560

const TRAIL_LENGTH = 16
const IDLE_FRAME_INTERVAL = 16 // always 60fps — map is never static

/**
 * How quickly the frontend lerps toward backend position.
 * 0.3 gives snappy, game-like responsiveness without jitter.
 */
const LERP_FACTOR = 0.3

/**
 * Frontend extrapolation speed factor — MUST match backend SIM_TIME_MULTIPLIER (180).
 * Both sides are in sync → movie-smooth, continuous movement.
 */
const EXTRAP_SPEED_FACTOR = 180

const TYPE_COLORS = {
  Express: '#3b82f6',
  Passenger: '#22c55e',
  Freight: '#f59e0b',
  Local: '#a78bfa',
}

const STATUS_STROKE = {
  active: '#22c55e',
  stopped: '#ef4444',
  speed_reduced: '#f59e0b',
  rerouted: '#06b6d4',
  conflict: '#ef4444',
  arrived: '#10b981',
  resuming: '#22c55e',
}

const STATUS_LABELS = {
  active: 'MOVING',
  stopped: 'HELD',
  speed_reduced: 'SLOW',
  rerouted: 'DETOUR',
  arrived: 'ARRIVED',
  conflict: '⚠ CONFLICT',
  resuming: '▶ RESUMING',
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const lerp = (a, b, t) => a + (b - a) * t

/* ── Graph utilities ──────────────────────────────────────────────────────── */

function buildAdjacency(edges) {
  const adj = new Map()
  edges.forEach((e) => {
    if (!adj.has(e.from)) adj.set(e.from, [])
    adj.get(e.from).push({ to: e.to, distance: Number(e.distance) || 1 })
  })
  return adj
}

function buildEdgeLookup(edges) {
  const lk = new Map()
  edges.forEach((e) => lk.set(`${e.from}->${e.to}`, e))
  return lk
}

function shortestPath(source, target, adjacency) {
  if (!source || !target) return []
  if (source === target) return [source]
  const dist = new Map([[source, 0]])
  const prev = new Map()
  const queue = [[0, source]]
  const visited = new Set()
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0])
    const [d, node] = queue.shift()
    if (visited.has(node)) continue
    visited.add(node)
    if (node === target) break
    for (const { to, distance } of adjacency.get(node) || []) {
      const nd = d + distance
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd)
        prev.set(to, node)
        queue.push([nd, to])
      }
    }
  }
  if (!dist.has(target)) return []
  const path = [target]
  while (path[0] !== source) {
    const p = prev.get(path[0])
    if (!p) return []
    path.unshift(p)
  }
  return path
}

/**
 * Build a renderable geometry object for a path through the node map.
 */
function buildGeometry(path, nodeMap, edgeLookup) {
  const fallback = path.length > 0 && nodeMap[path[0]]
    ? { x: nodeMap[path[0]].x, y: nodeMap[path[0]].y }
    : { x: MAP_W / 2, y: MAP_H / 2 }
  if (path.length < 2) return { nodes: path, segments: [], totalDistance: 0, fallback }

  const segments = []
  let total = 0
  for (let i = 0; i < path.length - 1; i++) {
    const from = nodeMap[path[i]]
    const to = nodeMap[path[i + 1]]
    if (!from || !to) continue
    const edge = edgeLookup.get(`${path[i]}->${path[i + 1]}`)
    const d = Number(edge?.distance) || Math.max(1, Math.hypot(to.x - from.x, to.y - from.y) / 10)
    segments.push({ from, to, distance: d, start: total, end: total + d })
    total += d
  }
  return { nodes: path, segments, totalDistance: total, fallback }
}

/** Interpolate (x, y, angle) at a given distance along a geometry. */
function pointAtDistance(geo, dist) {
  if (!geo.segments.length || geo.totalDistance <= 0)
    return { x: geo.fallback.x, y: geo.fallback.y, angle: 0 }
  const d = clamp(dist, 0, geo.totalDistance)
  const seg = geo.segments.find((s) => d <= s.end) || geo.segments[geo.segments.length - 1]
  const local = d - seg.start
  const r = seg.distance <= 0 ? 1 : clamp(local / seg.distance, 0, 1)
  return {
    x: seg.from.x + (seg.to.x - seg.from.x) * r,
    y: seg.from.y + (seg.to.y - seg.from.y) * r,
    angle: Math.atan2(seg.to.y - seg.from.y, seg.to.x - seg.from.x) * 180 / Math.PI,
  }
}

function getConflictAnchor(conflict, nodeMap) {
  if (!conflict?.section) return null
  if (conflict.section.includes('-')) {
    const [a, b] = conflict.section.split('-')
    const na = nodeMap[a], nb = nodeMap[b]
    if (na && nb) return { x: (na.x + nb.x) / 2, y: (na.y + nb.y) / 2 }
  }
  const n = nodeMap[conflict.section]
  return n ? { x: n.x, y: n.y } : null
}

/* ── Component ────────────────────────────────────────────────────────────── */

export default function TrackMap() {
  const svgRef = useRef(null)
  const frameRef = useRef(null)
  const lastFrameRef = useRef(0)

  // Refs that the animation loop reads (never in useEffect deps)
  const trainsRef = useRef([])
  const conflictsRef = useRef([])
  const conflictIdsRef = useRef(new Set())
  const crashedIdsRef = useRef(new Set())
  const resumingIdsRef = useRef(new Set())
  const simRunningRef = useRef(false)
  const trailsRef = useRef(new Map()) // train_id -> [{x,y}]

  /**
   * motionRef — per-train animation state, keyed by train_id.
   */
  const motionRef = useRef(new Map())
  const pathCacheRef = useRef(new Map())

  // ── Zustand selectors ─────────────────────────────────────────────────
  const { networkNodes, networkEdges, currentTrains, conflicts, simulationRunning,
    crashedTrainIds, resumingTrainIds, addCrashedTrains } = useRailwayStore()

  const nodeMap = useMemo(() => Object.fromEntries(networkNodes.map((n) => [n.id, n])), [networkNodes])
  const adjacency = useMemo(() => buildAdjacency(networkEdges), [networkEdges])
  const edgeLookup = useMemo(() => buildEdgeLookup(networkEdges), [networkEdges])
  const conflictTrainIds = useMemo(() => {
    const s = new Set()
    conflicts.forEach((c) => c.trains?.forEach((t) => s.add(t)))
    return s
  }, [conflicts])

  // Sync React state → refs (the animation loop reads refs, not state)
  useEffect(() => { trainsRef.current = currentTrains }, [currentTrains])
  useEffect(() => { conflictsRef.current = conflicts }, [conflicts])
  useEffect(() => { conflictIdsRef.current = conflictTrainIds }, [conflictTrainIds])
  useEffect(() => { crashedIdsRef.current = crashedTrainIds }, [crashedTrainIds])
  useEffect(() => { resumingIdsRef.current = resumingTrainIds }, [resumingTrainIds])
  useEffect(() => { simRunningRef.current = simulationRunning }, [simulationRunning])

  // Mark trains as crashed when conflicts are detected
  useEffect(() => {
    if (conflicts.length > 0 && simulationRunning) {
      const ids = []
      conflicts.forEach((c) => c.trains?.forEach((t) => ids.push(t)))
      if (ids.length > 0) addCrashedTrains(ids)
    }
  }, [conflicts, simulationRunning, addCrashedTrains])

  // Clear caches when topology changes
  useEffect(() => {
    motionRef.current = new Map()
    pathCacheRef.current = new Map()
  }, [adjacency, edgeLookup])

  /* ── Main D3 setup — runs ONLY when network topology changes ─────────── */
  useEffect(() => {
    if (!svgRef.current || !networkNodes.length) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    const nm = Object.fromEntries(networkNodes.map((n) => [n.id, n]))

    // ── Defs ──────────────────────────────────────────────────────────
    const defs = svg.append('defs')

    defs.append('marker').attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10').attr('refX', 18).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', 'var(--map-arrow)')

    defs.append('marker').attr('id', 'train-dir')
      .attr('viewBox', '0 -4 8 8').attr('refX', 6).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4Z').attr('fill', '#fff').attr('opacity', 0.9)

    const mkFilter = (id, blur) => {
      const f = defs.append('filter').attr('id', id)
      f.append('feGaussianBlur').attr('stdDeviation', blur).attr('result', 'b')
      const m = f.append('feMerge')
      m.append('feMergeNode').attr('in', 'b')
      m.append('feMergeNode').attr('in', 'SourceGraphic')
    }
    mkFilter('glow', 3)
    mkFilter('conflict-glow', 6)

    // ── Grid ──────────────────────────────────────────────────────────
    const grid = svg.append('g')
    for (let x = 0; x <= MAP_W; x += 80)
      grid.append('line').attr('x1', x).attr('y1', 0).attr('x2', x).attr('y2', MAP_H)
        .attr('stroke', 'var(--map-grid)').attr('stroke-width', 0.5)
    for (let y = 0; y <= MAP_H; y += 80)
      grid.append('line').attr('x1', 0).attr('y1', y).attr('x2', MAP_W).attr('y2', y)
        .attr('stroke', 'var(--map-grid)').attr('stroke-width', 0.5)

    // ── Tracks ────────────────────────────────────────────────────────
    const drawn = new Set()
    const edgeG = svg.append('g')
    networkEdges.forEach((e) => {
      const k = [e.from, e.to].sort().join('-')
      if (drawn.has(k)) return
      drawn.add(k)
      const s = nm[e.from], d = nm[e.to]
      if (!s || !d) return
      edgeG.append('line').attr('x1', s.x).attr('y1', s.y).attr('x2', d.x).attr('y2', d.y)
        .attr('stroke', 'var(--map-track-shadow)').attr('stroke-width', 8).attr('stroke-linecap', 'round')
      edgeG.append('line').attr('x1', s.x).attr('y1', s.y).attr('x2', d.x).attr('y2', d.y)
        .attr('stroke', 'var(--map-track)').attr('stroke-width', 4)
        .attr('stroke-linecap', 'round').attr('marker-end', 'url(#arrow)')
      const mx = (s.x + d.x) / 2, my = (s.y + d.y) / 2
      edgeG.append('text').attr('x', mx).attr('y', my - 6).attr('text-anchor', 'middle')
        .attr('fill', 'var(--map-track-label)').attr('font-size', '10px')
        .attr('font-family', 'JetBrains Mono, monospace').text(`${e.distance}km`)
    })

    // ── Stations ──────────────────────────────────────────────────────
    const nodeG = svg.append('g')
    networkNodes.forEach((n) => {
      const g = nodeG.append('g').attr('transform', `translate(${n.x},${n.y})`).attr('cursor', 'pointer')
      g.append('circle').attr('r', 18).attr('fill', 'none')
        .attr('stroke', 'var(--map-station-ring)').attr('stroke-width', 2)
      g.append('circle').attr('r', 12).attr('fill', 'var(--map-station-fill)')
        .attr('stroke', 'var(--map-station-stroke)').attr('stroke-width', 2)
      g.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em')
        .attr('fill', 'var(--map-station-label)').attr('font-size', '10px')
        .attr('font-family', 'JetBrains Mono, monospace').attr('font-weight', 600).text(n.id)
      g.append('text').attr('text-anchor', 'middle').attr('dy', n.y > 300 ? '32px' : '-22px')
        .attr('fill', 'var(--map-station-name)').attr('font-size', '9px')
        .attr('font-family', 'Manrope, sans-serif').text(n.label)
    })

    // ── Dynamic layers ────────────────────────────────────────────────
    const trailLayer = svg.append('g').attr('class', 'trail-layer')
    const conflictLayer = svg.append('g').attr('class', 'conflict-markers')
    const trainLayer = svg.append('g').attr('class', 'trains')

    // ── Legend ─────────────────────────────────────────────────────────
    const leg = svg.append('g').attr('transform', `translate(16,${MAP_H - 80})`)
    Object.entries(TYPE_COLORS).forEach(([t, c], i) => {
      leg.append('circle').attr('cx', 8).attr('cy', i * 18).attr('r', 5).attr('fill', c)
      leg.append('text').attr('x', 18).attr('y', i * 18 + 4)
        .attr('fill', 'var(--map-legend-text)').attr('font-size', '10px')
        .attr('font-family', 'Manrope, sans-serif').text(t)
    })

    /* ── Path helper ────────────────────────────────────────────────── */
    const getGeo = (origin, destination) => {
      const key = `${origin}->${destination}`
      let g = pathCacheRef.current.get(key)
      if (!g) {
        g = buildGeometry(shortestPath(origin, destination, adjacency), nm, edgeLookup)
        pathCacheRef.current.set(key, g)
      }
      return g
    }

    /* ═══════════════════════════════════════════════════════════════════
     *  ANIMATION LOOP — game-loop style, runs every frame
     * ═══════════════════════════════════════════════════════════════════ */
    const renderFrame = (now) => {
      const isSimRunning = simRunningRef.current

      // Always render at 60fps — never throttle, map must never appear static
      lastFrameRef.current = now

      const liveTrains = trainsRef.current
      const liveConflicts = conflictsRef.current || []
      const cIds = conflictIdsRef.current
      const crashed = crashedIdsRef.current
      const resuming = resumingIdsRef.current

      /* ── Compute train positions ──────────────────────────────────── */
      const rendered = liveTrains.map((train, idx) => {
        let mot = motionRef.current.get(train.train_id)
        const speed = Number(train.current_speed) || 0
        const status = train.status || 'active'
        const isCrashed = crashed.has(train.train_id)
        const isResuming = resuming.has(train.train_id)
        const isConflict = cIds.has(train.train_id)
        const isStopped = status === 'stopped' || status === 'arrived' || speed <= 0 || isCrashed
        const backendProgress = Number(train.path_progress) || 0
        const origin = train.origin || train.current_section

        // ── Initialize or rebuild geometry ──────────────────────────
        const needsNewGeo = !mot
          || mot.destination !== train.destination
          || mot.origin !== origin

        if (needsNewGeo) {
          const geo = getGeo(origin, train.destination)
          mot = {
            geometry: geo,
            displayProgress: backendProgress,
            targetProgress: backendProgress,
            origin: origin,
            destination: train.destination,
            speed: speed,
            status: status,
            lastFrameTime: now,
            lastBackendTime: now,
            lastBackendProgress: backendProgress,
          }
          motionRef.current.set(train.train_id, mot)
        }

        // ── Update target from backend ─────────────────────────────
        if (backendProgress !== mot.lastBackendProgress || speed !== mot.speed || status !== mot.status) {
          mot.targetProgress = backendProgress
          mot.lastBackendTime = now
          mot.lastBackendProgress = backendProgress
          mot.speed = speed
          mot.status = status
        }

        // ── Advance displayProgress toward target (every frame) ────
        const deltaMs = clamp(now - mot.lastFrameTime, 0, 100) // cap tighter: avoid big jumps on tab-switch
        mot.lastFrameTime = now

        if (isCrashed) {
          // HALTED at conflict — freeze in place, do not advance
        } else if (!isStopped && mot.geometry.totalDistance > 0 && deltaMs > 0) {
          // Extrapolate ALWAYS (not just when sim flag is set) — trains always move smoothly
          const kmPerMs = (speed / 3_600_000) * EXTRAP_SPEED_FACTOR
          const extrapolatedDelta = (kmPerMs * deltaMs) / mot.geometry.totalDistance

          // Advance target forward based on elapsed time since last backend tick
          const timeSinceBackend = now - mot.lastBackendTime
          const extrapolation = (kmPerMs * timeSinceBackend) / mot.geometry.totalDistance
          const liveTarget = Math.min(1.0, mot.lastBackendProgress + extrapolation)
          mot.targetProgress = Math.max(mot.targetProgress, liveTarget)

          // Snap displayProgress toward live target — game-like responsiveness
          mot.displayProgress = lerp(mot.displayProgress, mot.targetProgress, LERP_FACTOR)

          // Hard clamp
          mot.displayProgress = clamp(mot.displayProgress, 0, 1)
        } else if (isStopped && !isCrashed) {
          // When stopped: ease gently to last known backend position
          mot.displayProgress = lerp(mot.displayProgress, mot.targetProgress, 0.08)
        }

        if (status === 'arrived') mot.displayProgress = 1.0

        // ── Get screen position from progress ─────────────────────────
        const travelled = mot.displayProgress * mot.geometry.totalDistance
        const pos = pointAtDistance(mot.geometry, travelled)

        // Trail
        let trail = trailsRef.current.get(train.train_id) || []
        // Trail records whenever train actually moves (not just when sim flag is set)
        const shouldAnimate = !isStopped && !isCrashed && mot.geometry.totalDistance > 0 && speed > 0
        if (shouldAnimate && isSimRunning) {
          const last = trail[trail.length - 1]
          if (!last || Math.hypot(pos.x - last.x, pos.y - last.y) > 2) {
            trail = [...trail, { x: pos.x, y: pos.y }].slice(-TRAIL_LENGTH)
            trailsRef.current.set(train.train_id, trail)
          }
        }

        const color = TYPE_COLORS[train.train_type] || '#94a3b8'

        // Determine visual status
        let visualLabel, visualStroke
        if (isCrashed) {
          visualLabel = STATUS_LABELS.conflict
          visualStroke = STATUS_STROKE.conflict
        } else if (isResuming) {
          visualLabel = STATUS_LABELS.resuming
          visualStroke = STATUS_STROKE.resuming
        } else if (isConflict) {
          visualLabel = STATUS_LABELS.conflict
          visualStroke = STATUS_STROKE.conflict
        } else {
          visualLabel = STATUS_LABELS[status] || 'MOVING'
          visualStroke = STATUS_STROKE[status] || STATUS_STROKE.active
        }

        const aura = (isCrashed || isConflict)
          ? 0.45 + 0.2 * Math.sin(now / 160 + idx)
          : shouldAnimate ? 0.22 + 0.1 * Math.sin(now / 500 + idx) : 0.08

        return {
          ...train, speed, status, isStopped, shouldAnimate, isConflict, isCrashed, isResuming,
          x: pos.x, y: pos.y, angle: pos.angle, trail, color, aura,
          progress: mot.displayProgress,
          stroke: visualStroke,
          label: visualLabel,
        }
      })

      /* ── D3 train rendering ───────────────────────────────────────── */

      // Trails
      const trD = rendered.filter((t) => t.trail.length > 1 && t.shouldAnimate)
      const trS = trailLayer.selectAll('polyline.trail').data(trD, (d) => d.train_id)
      trS.exit().remove()
      trS.enter().append('polyline').attr('class', 'trail')
        .merge(trS)
        .attr('points', (d) => d.trail.map((p) => `${p.x},${p.y}`).join(' '))
        .attr('fill', 'none').attr('stroke', (d) => d.color)
        .attr('stroke-width', 3).attr('stroke-opacity', 0.35)
        .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')

      // Train groups
      const sel = trainLayer.selectAll('g.tg').data(rendered, (d) => d.train_id)
      const enter = sel.enter().append('g').attr('class', 'tg')
      enter.append('circle').attr('class', 'ta').attr('r', 18).attr('fill', 'none').attr('stroke-width', 2)
      enter.append('circle').attr('class', 'tb').attr('r', 12)
      enter.append('circle').attr('class', 'tc').attr('r', 7)
      enter.append('line').attr('class', 'td')   // direction arrow
      enter.append('text').attr('class', 'ts')    // speed label
      enter.append('text').attr('class', 'tst')   // status label
      enter.append('text').attr('class', 'tid')   // train id
      enter.append('text').attr('class', 'tprog') // progress %
      enter.append('title')

      const merged = enter.merge(sel)
      merged.attr('transform', (d) => `translate(${d.x},${d.y})`)

      // Aura
      merged.select('.ta')
        .attr('stroke', (d) => (d.isCrashed || d.isConflict) ? '#ef4444' : d.color)
        .attr('opacity', (d) => d.aura)
        .attr('r', (d) => (d.isCrashed || d.isConflict) ? 20 + 2 * Math.sin(now / 200) : 18)
        .attr('filter', (d) => (d.isCrashed || d.isConflict) ? 'url(#conflict-glow)' : 'url(#glow)')

      // Body
      merged.select('.tb')
        .attr('fill', (d) => d.color)
        .attr('fill-opacity', (d) => d.isStopped ? 0.25 : 0.22)
        .attr('stroke', (d) => d.stroke).attr('stroke-width', (d) => (d.isCrashed || d.isConflict) ? 3 : 2)
        .attr('filter', 'url(#glow)')

      // Core
      merged.select('.tc')
        .attr('fill', (d) => d.isResuming ? '#22c55e' : d.color)
        .attr('opacity', (d) => d.isStopped ? 0.45 : 1)

      // Direction arrow
      merged.select('.td')
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', (d) => d.shouldAnimate ? Math.cos(d.angle * Math.PI / 180) * 24 : 0)
        .attr('y2', (d) => d.shouldAnimate ? Math.sin(d.angle * Math.PI / 180) * 24 : 0)
        .attr('stroke', '#fff').attr('stroke-width', 2)
        .attr('stroke-opacity', (d) => d.shouldAnimate ? 0.85 : 0)
        .attr('marker-end', (d) => d.shouldAnimate ? 'url(#train-dir)' : '')

      // Speed
      merged.select('.ts').attr('text-anchor', 'middle').attr('dy', '28px')
        .attr('fill', (d) => d.isStopped ? '#ef4444' : 'var(--map-legend-text)')
        .attr('font-size', '9px').attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', 600)
        .text((d) => `${d.speed} km/h`)

      // Status
      merged.select('.tst').attr('text-anchor', 'middle').attr('dy', '-24px')
        .attr('fill', (d) => (d.isCrashed || d.isConflict) ? '#ef4444' : d.isResuming ? '#22c55e' : d.isStopped ? '#f59e0b' : 'var(--map-legend-text)')
        .attr('font-size', '8px').attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', 700).attr('letter-spacing', '0.05em')
        .attr('opacity', (d) => (d.isCrashed || d.isConflict) ? 0.7 + 0.3 * Math.sin(now / 280) : 0.7)
        .text((d) => d.label)

      // Train ID
      merged.select('.tid').attr('text-anchor', 'middle').attr('dy', '-34px')
        .attr('fill', (d) => d.color)
        .attr('font-size', '9px').attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', 700).text((d) => d.train_id)

      // Progress %
      merged.select('.tprog').attr('text-anchor', 'middle').attr('dy', '38px')
        .attr('fill', 'var(--map-legend-text)')
        .attr('font-size', '8px').attr('font-family', 'JetBrains Mono, monospace')
        .attr('opacity', 0.5)
        .text((d) => `${Math.round(d.progress * 100)}%`)

      // Tooltip
      merged.select('title').text((d) =>
        `${d.train_id} (${d.train_type})\nSpeed: ${d.speed} km/h\n` +
        `${d.current_section} → ${d.destination}\nStatus: ${d.status}\nPriority: ${d.priority}\n` +
        `Progress: ${Math.round(d.progress * 100)}%`)

      sel.exit().remove()

      /* ── Conflict zones ───────────────────────────────────────────── */
      const cData = liveConflicts.map((c, i) => {
        const a = getConflictAnchor(c, nm)
        if (!a) return null
        const sev = c.severity || 'medium'
        const eta = c.predicted_in_seconds || 0
        let etaLabel
        if (eta <= 0) etaLabel = '⚠ NOW'
        else if (eta < 60) etaLabel = `ETA ${Math.round(eta)}s`
        else etaLabel = `ETA ${Math.floor(eta / 60)}m ${Math.round(eta % 60)}s`
        return {
          ...c, key: `${c.conflict_id}-${c.section}`,
          x: a.x, y: a.y, sev, etaLabel, eta,
          br: sev === 'critical' ? 22 : sev === 'high' ? 18 : 14,
          pulse: Math.sin(now / 220 + i),
        }
      }).filter(Boolean)

      const cSel = conflictLayer.selectAll('g.cm').data(cData, (d) => d.key)
      const cEnter = cSel.enter().append('g').attr('class', 'cm')
      cEnter.append('circle').attr('class', 'cp')   // outer pulse
      cEnter.append('circle').attr('class', 'ci')   // inner ring
      cEnter.append('circle').attr('class', 'cc').attr('r', 5)  // core
      cEnter.append('text').attr('class', 'ce')      // ETA
      cEnter.append('text').attr('class', 'ct')      // type label
      cEnter.append('title')

      const cMerged = cEnter.merge(cSel)
      cMerged.attr('transform', (d) => `translate(${d.x},${d.y})`)

      const sevColor = (s) => s === 'critical' ? '#ef4444' : s === 'high' ? '#f59e0b' : '#fb7185'

      cMerged.select('.cp')
        .attr('r', (d) => d.br + 6 + d.pulse * 4)
        .attr('fill', 'none').attr('stroke', (d) => sevColor(d.sev)).attr('stroke-width', 2)
        .attr('opacity', (d) => 0.4 + 0.2 * Math.sin(now / 150))

      cMerged.select('.ci')
        .attr('r', (d) => d.br + d.pulse * 2)
        .attr('fill', (d) => d.sev === 'critical' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.06)')
        .attr('stroke', (d) => sevColor(d.sev)).attr('stroke-width', 1.5).attr('opacity', 0.6)

      cMerged.select('.cc')
        .attr('fill', (d) => sevColor(d.sev)).attr('r', (d) => 4 + Math.abs(d.pulse))

      cMerged.select('.ce').attr('text-anchor', 'middle')
        .attr('dy', (d) => d.br + 18)
        .attr('fill', (d) => d.eta <= 0 ? '#ef4444' : '#f59e0b')
        .attr('font-size', '10px').attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', 800)
        .attr('opacity', (d) => d.eta <= 0 ? 0.7 + 0.3 * Math.sin(now / 200) : 0.85)
        .text((d) => d.etaLabel)

      cMerged.select('.ct').attr('text-anchor', 'middle')
        .attr('dy', (d) => -(d.br + 8))
        .attr('fill', (d) => sevColor(d.sev))
        .attr('font-size', '8px').attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', 600).attr('letter-spacing', '0.06em')
        .text((d) => `⚠ ${(d.type || '').replace('_', ' ').toUpperCase()}`)

      cMerged.select('title').text((d) =>
        `${d.conflict_id} · ${(d.type || '').replace('_', ' ')}\nSection: ${d.section}\n` +
        `Trains: ${(d.trains || []).join(', ')}\nSeverity: ${d.sev}\n${d.etaLabel}`)

      cSel.exit().remove()

      // Next frame
      frameRef.current = requestAnimationFrame(renderFrame)
    }

    frameRef.current = requestAnimationFrame(renderFrame)

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      svg.selectAll('*').remove()
    }
  }, [networkNodes, networkEdges, nodeMap, adjacency, edgeLookup])
  //    ↑ simulationRunning deliberately NOT in deps

  /* ── Empty state ─────────────────────────────────────────────────────── */
  if (!networkNodes.length) {
    return (
      <div className="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
        </svg>
        <p>Loading network map…</p>
      </div>
    )
  }

  return (
    <div className="track-map-container" style={{ height: MAP_H }}>
      <svg ref={svgRef}
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
