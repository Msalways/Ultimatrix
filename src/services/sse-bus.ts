export interface SSEEvent {
  _event?: string
  type?: string
  [key: string]: unknown
}

type Listener = (evt: SSEEvent) => void

class SSEBus {
  private source: EventSource | null = null
  private listeners = new Map<string, Set<Listener>>()
  private connected = false

  connect() {
    if (this.connected) return
    this.source = new EventSource('/api/swarm-events')
    this.connected = true

    this.source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { events?: SSEEvent[] }
        if (!Array.isArray(payload.events)) return
        for (const evt of payload.events) {
          const eventType = evt._event ?? evt.type ?? ''
          if (!eventType || eventType === 'connected' || eventType === 'heartbeat') continue
          for (const [prefix, cbs] of this.listeners) {
            if (eventType.startsWith(prefix)) {
              for (const cb of cbs) cb(evt)
            }
          }
        }
      } catch {
        // Ignore malformed event batches.
      }
    }

    this.source.onerror = () => {
      this.connected = false
      this.source?.close()
      this.source = null
      setTimeout(() => this.connect(), 3000)
    }
  }

  on(prefix: string, cb: Listener): () => void {
    if (!this.listeners.has(prefix)) this.listeners.set(prefix, new Set())
    this.listeners.get(prefix)!.add(cb)
    if (!this.connected) this.connect()
    return () => {
      this.listeners.get(prefix)?.delete(cb)
    }
  }

  disconnect() {
    this.source?.close()
    this.source = null
    this.connected = false
    this.listeners.clear()
  }
}

export const sseBus = new SSEBus()
