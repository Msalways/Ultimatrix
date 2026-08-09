'use client'

import { useState, useEffect, useRef } from 'react'
import { ChevronRight, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolCallMessage } from '@/stores/chat-store'

export function ToolCallCard({ message }: { message: ToolCallMessage }) {
  const [expanded, setExpanded] = useState(false)
  const [elapsed, setElapsed] = useState<number>(0)
  const startRef = useRef<number>(message.timestamp)

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
    <div className="ml-4 mr-4 my-1 sm:ml-8">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-left font-mono text-xs',
          'transition-colors hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700',
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
        <span className="min-w-0 truncate text-zinc-300">{message.name}</span>
        {message.args && Object.keys(message.args).length > 0 && (
          <span className="hidden max-w-[300px] truncate text-zinc-600 md:inline">
            {Object.entries(message.args).slice(0, 2).map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 30) : '...'}`).join(' ')}
          </span>
        )}
        {message.workerName && (
          <span className="hidden rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 lg:inline">{message.workerName}</span>
        )}
        {displayDuration && (
          <span className="ml-auto flex-shrink-0 text-zinc-600">{displayDuration}</span>
        )}
      </button>
      {expanded && message.result && (
        <div className="ml-6 mt-1 max-h-48 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs whitespace-pre-wrap text-zinc-400">
          {message.result.slice(0, 2000)}
        </div>
      )}
    </div>
  )
}
