'use client'

import { useState } from 'react'
import { ChevronRight, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolCallMessage } from '@/stores/chat-store'

export function ToolCallCard({ message }: { message: ToolCallMessage }) {
  const [expanded, setExpanded] = useState(false)

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
        {message.duration != null && (
          <span className="text-zinc-600 ml-auto">{message.duration}ms</span>
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
