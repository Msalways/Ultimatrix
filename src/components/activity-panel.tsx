'use client'

import { useEffect, useRef, useState } from 'react'
import { ScrollArea } from './ui/scroll-area'
import { Badge } from './ui/badge'
import { X } from 'lucide-react'

interface ActivityEntry {
  id: number
  type: 'tool-call' | 'tool-result' | 'error' | 'info' | 'reasoning'
  message: string
  timestamp: number
}

const typeColors: Record<ActivityEntry['type'], string> = {
  'tool-call': 'text-yellow-500',
  'tool-result': 'text-green-500',
  error: 'text-red-500',
  info: 'text-blue-400',
  reasoning: 'text-muted-foreground italic',
}

const typeBadge: Record<ActivityEntry['type'], string> = {
  'tool-call': 'call',
  'tool-result': 'done',
  error: 'err',
  info: 'info',
  reasoning: 'think',
}

let nextId = 1

export function ActivityPanel({ onClose }: { onClose?: () => void }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const es = new EventSource('/api/activity')
    es.onmessage = (ev) => {
      try {
        const entry = JSON.parse(ev.data) as ActivityEntry
        entry.id = nextId++
        setEntries(prev => [...prev.slice(-200), entry])
      } catch { /* ignore malformed */ }
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries])

  return (
    <aside className="w-72 border-l border-border bg-card flex flex-col">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Activity</h3>
        {onClose && (
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 text-xs space-y-1">
          {entries.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">Waiting for tool activity...</p>
          )}
          {entries.map(e => (
            <div key={e.id} className="flex gap-1.5 items-start">
              <Badge variant="outline" className="text-[10px] px-1 py-0 leading-none font-mono">
                {e.type}
              </Badge>
              <span className={typeColors[e.type]}>{e.message}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </aside>
  )
}
