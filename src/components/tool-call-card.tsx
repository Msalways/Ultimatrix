'use client'

import { useState, useEffect, useRef } from 'react'
import { ChevronRight, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolCallMessage } from '@/stores/chat-store'

export function ToolCallCard({ message }: { message: ToolCallMessage }) {
  const [expanded, setExpanded] = useState(false)
  const [elapsed, setElapsed] = useState<number>(0)
  const startRef = useRef<number>(message.timestamp)

  // UX1: Live ticking elapsed time while running
  useEffect(() => {
    if (message.status !== 'running') return
    const interval = setInterval(() => {
      setElapsed(Date.now() - startRef.current)
    }, 100)
    return () => clearInterval(interval)
  }, [message.status])

  const displayDuration = message.duration != null
    ? `${message.duration}ms`
    : message.status === 'running'
      ? `${(elapsed / 1000).toFixed(1)}s`
      : null

  return (
    <div className="ml-8 my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono w-full text-left',
          'hover:bg-zinc-800/50 transition-colors',
          message.status === 'running' && 'text-zinc-400',
          message.status === 'done' && 'text-emerald-400/80',
          message.status === 'error' && 'text-red-400/80',
        )}
      >
        <ChevronRight
          size={12}
          className={cn('transition-transform', expanded && 'rotate-90')}
        />
        {message.status === 'running' && <Loader2 size={12} className="animate-spin" />}
        {message.status === 'done' && <Check size={12} />}
        {message.status === 'error' && <X size={12} />}
        <span className="text-zinc-500">→</span>
        <span>{message.name}</span>
        {message.args && Object.keys(message.args).length > 0 && (
          <span className="text-zinc-600 truncate max-w-[300px]">
            {Object.entries(message.args).slice(0, 2).map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 30) : '...'}`).join(' ')}
          </span>
        )}
        {/* UX2: Worker attribution */}
        {message.workerName && (
          <span className="text-zinc-600 text-[10px]">({message.workerName})</span>
        )}
        {/* UX1: Live elapsed time */}
        {displayDuration && (
          <span className="text-zinc-600 ml-auto">{displayDuration}</span>
        )}
      </button>
      {expanded && message.result && (
        <div className="ml-6 mt-1 p-2 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
          {message.result.slice(0, 2000)}
        </div>
      )}
    </div>
  )
}
