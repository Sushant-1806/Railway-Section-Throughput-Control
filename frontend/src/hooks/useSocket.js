/**
 * hooks/useSocket.js — Socket.IO connection with scenario room management.
 */

import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import useRailwayStore from '../store/railwayStore'
import toast from 'react-hot-toast'

let socket = null

export function getSocket() {
  if (!socket) {
    socket = io('/', {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    })
  }
  return socket
}

export function useSocket(scenarioId) {
  const socketRef = useRef(null)
  const conflictToastRef = useRef('')
  const { updateTrains, setConflicts, setAnalysisResult } = useRailwayStore()

  const getConflictKey = (conflicts = []) => conflicts
    .map((conflict) => `${conflict.conflict_id}:${conflict.section}:${(conflict.trains || []).join('|')}:${conflict.severity}`)
    .join('||')

  useEffect(() => {
    const s = getSocket()
    socketRef.current = s

    if (scenarioId) {
      s.emit('join_scenario', { scenario_id: scenarioId })
    }

    s.on('train_update', (data) => {
      if (data.scenario_id === scenarioId) {
        updateTrains(data.trains)
        const conflicts = data.conflicts || []
        setConflicts(conflicts)
        if (conflicts.length === 0) {
          conflictToastRef.current = ''
        }
      }
    })

    s.on('conflict_detected', (data) => {
      if (data.scenario_id === scenarioId) {
        setAnalysisResult(data.conflicts, data.solutions)
        const conflictKey = getConflictKey(data.conflicts)
        if (data.conflicts.length > 0 && conflictKey !== conflictToastRef.current) {
          conflictToastRef.current = conflictKey
          toast.error(
            `⚠️ ${data.conflicts.length} conflict${data.conflicts.length > 1 ? 's' : ''} detected!`,
            { duration: 4000 }
          )
        }
        if (data.conflicts.length === 0) {
          conflictToastRef.current = ''
        }
      }
    })

    s.on('connect', () => console.log('Socket connected:', s.id))
    s.on('disconnect', () => console.warn('Socket disconnected'))

    return () => {
      s.off('train_update')
      s.off('conflict_detected')
      if (scenarioId) {
        s.emit('leave_scenario', { scenario_id: scenarioId })
      }
      conflictToastRef.current = ''
    }
  }, [scenarioId, setAnalysisResult, setConflicts, updateTrains])

  return socketRef.current
}
