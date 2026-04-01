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
  const { updateTrains, setAnalysisResult } = useRailwayStore()

  useEffect(() => {
    const s = getSocket()
    socketRef.current = s

    if (scenarioId) {
      s.emit('join_scenario', { scenario_id: scenarioId })
    }

    s.on('train_update', (data) => {
      if (data.scenario_id === scenarioId) {
        updateTrains(data.trains)
        setAnalysisResult(data.conflicts || [], [])
      }
    })

    s.on('conflict_detected', (data) => {
      if (data.scenario_id === scenarioId) {
        setAnalysisResult(data.conflicts, data.solutions)
        if (data.conflicts.length > 0) {
          toast.error(
            `⚠️ ${data.conflicts.length} conflict${data.conflicts.length > 1 ? 's' : ''} detected!`,
            { duration: 4000 }
          )
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
    }
  }, [scenarioId])

  return socketRef.current
}
