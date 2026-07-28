'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { ScrollArea } from './ui/scroll-area'
import { X, Pause, Play, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ActivityEntry {
  id: number
  type: 'tool-call' | 'tool-result' | 'error' | 'info' | 'reasoning' | 'heartbeat'
  message: string
  timestamp: number
}

const typeColors: Record<string, string> = {
  'tool-call': 'text-yellow-500',
  'tool-result': 'text-green-500',
  error: 'text-red-500',
  info: 'text-blue-400',
  reasoning: 'text-muted-foreground italic',
  heartbeat: 'text-gray-600',
}

const typeBadge: Record<string, string> = {
  'tool-call': 'call',
  'tool-result': 'done',
  error: 'err',
  info: 'info',
  reasoning: 'think',
  heartbeat: 'hb',
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

type FilterType = ActivityEntry['type'] | 'all';

const FILTER_OPTIONS: FilterType[] = ['all', 'tool-call', 'tool-result', 'error', 'info', 'reasoning'];

let nextId = 1

export function ActivityPanel({ onClose }: { onClose?: () => void }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState<FilterType>('all')
  const [search, setSearch] = useState('')
  const [connected, setConnected] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
    }

    const es = new EventSource('/api/activity')
    esRef.current = es

    es.onopen = () => setConnected(true)

    es.onmessage = (ev) => {
      try {
        const raw = JSON.parse(ev.data) as { type: string; message: string; timestamp: number }
        if (raw.type === 'heartbeat') return
        const entry: ActivityEntry = { ...raw, id: nextId++ } as ActivityEntry
        setEntries((prev) => [...prev.slice(-300), entry])
      } catch { /* ignore malformed */ }
    }

    es.onerror = () => {
      setConnected(false)
      es.close()
      // Reconnect after 3s
      reconnectTimer.current = setTimeout(connect, 3000)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      esRef.current?.close()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [connect])

  const filtered = entries.filter((e) => {
    if (filter !== 'all' && e.type !== filter) return false
    if (search && !e.message.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  useEffect(() => {
    if (!paused) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [filtered, paused])

  return (
    <aside className="w-80 border-l border-border bg-card flex flex-col">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Activity
          </h3>
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              connected ? 'bg-green-500' : 'bg-red-500',
            )}
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPaused(!paused)}
            className="text-muted-foreground hover:text-foreground p-1"
            title={paused ? 'Resume' : 'Pause'}
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
          </button>
          {onClose && (
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter activity..."
            className="w-full pl-6 pr-2 py-1 text-xs bg-secondary rounded-md border-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Type filter */}
      <div className="flex gap-1 px-3 py-1.5 border-b border-border overflow-x-auto">
        {FILTER_OPTIONS.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={cn(
              'px-1.5 py-0.5 text-[10px] rounded transition-colors shrink-0',
              filter === t
                ? 'bg-green-500/20 text-green-400'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'all' ? 'all' : typeBadge[t] ?? t}
          </button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 text-xs space-y-1">
          {filtered.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">
              {entries.length === 0 ? 'Waiting for tool activity...' : 'No matching entries'}
            </p>
          )}
          {filtered.map((e) => (
            <div key={e.id} className="flex gap-1.5 items-start group">
              <span className="text-[10px] text-muted-foreground font-mono shrink-0 w-16">
                {formatTime(e.timestamp)}
              </span>
              <span className="text-[10px] px-1 py-0 leading-none font-mono shrink-0 border border-border rounded">
                {typeBadge[e.type] ?? e.type}
              </span>
              <span className={cn(typeColors[e.type], 'break-words min-w-0')}>
                {e.message}
              </span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </aside>
  )
}
