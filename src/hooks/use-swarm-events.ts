'use client'

import { useEffect, useRef } from 'react'
import { useAppStore, type SwarmEvent } from '@/stores/app-store'

/**
 * SSE hook that subscribes to /api/swarm-events and feeds events into the Zustand store.
 * Auto-reconnects on disconnect with exponential backoff (3s, 6s, 12s, max 30s).
 */
export function useSwarmEvents(opts?: { types?: string[]; workerId?: string }) {
  const onSwarmEvent = useAppStore(s => s.onSwarmEvent)
  const setSwarmConnected = useAppStore(s => s.setSwarmConnected)
  const backoffRef = useRef(3000)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true
    let source: EventSource | null = null

    const connect = () => {
      if (!activeRef.current) return

      const params = new URLSearchParams()
      if (opts?.types?.length) params.set('types', opts.types.join(','))
      if (opts?.workerId) params.set('workerId', opts.workerId)

      const url = `/api/swarm-events${params.toString() ? '?' + params.toString() : ''}`
      source = new EventSource(url)

      source.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          if (data.events && Array.isArray(data.events)) {
            for (const event of data.events) {
              onSwarmEvent(event as SwarmEvent)
            }
          } else if (data.type === 'connected') {
            setSwarmConnected(true)
            backoffRef.current = 3000
          } else if (data.type === 'heartbeat') {
            // Keep alive — no action needed
          }
        } catch {
          // Parse error — ignore
        }
      }

      source.onerror = () => {
        setSwarmConnected(false)
        source?.close()
        source = null
        // Exponential backoff reconnect
        if (activeRef.current) {
          timerRef.current = setTimeout(() => {
            backoffRef.current = Math.min(backoffRef.current * 2, 30000)
            connect()
          }, backoffRef.current)
        }
      }
    }

    connect()

    return () => {
      activeRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      source?.close()
      setSwarmConnected(false)
    }
  }, [onSwarmEvent, setSwarmConnected, opts?.types?.join(','), opts?.workerId])
}
