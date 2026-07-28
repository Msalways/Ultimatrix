'use client'

import { ChevronRight, Loader2, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkerMessage } from '@/stores/chat-store'

export function WorkerCard({ message }: { message: WorkerMessage }) {
  const isRunning = message.type === 'worker-spawned'
  const isCompleted = message.type === 'worker-completed'

  return (
    <div className={cn(
      'ml-8 my-1 px-3 py-2 rounded-md text-xs border',
      isRunning && 'border-zinc-800 bg-zinc-900/50 text-zinc-400',
      isCompleted && message.status === 'completed' && 'border-emerald-900/50 bg-emerald-950/20 text-emerald-400/80',
      isCompleted && message.status === 'error' && 'border-red-900/50 bg-red-950/20 text-red-400/80',
    )}>
      <div className="flex items-center gap-2">
        {isRunning && <Loader2 size={12} className="animate-spin" />}
        {isCompleted && message.status === 'completed' && <Check size={12} />}
        {isCompleted && message.status === 'error' && <X size={12} />}
        <span className="font-medium">🐝 {message.name}</span>
        {message.skillId && (
          <span className="text-zinc-600 font-mono">{message.skillId}</span>
        )}
        {isCompleted && message.duration != null && (
          <span className="text-zinc-600 ml-auto">{(message.duration / 1000).toFixed(1)}s</span>
        )}
      </div>
      {message.task && (
        <div className="mt-1 text-zinc-500 truncate">{message.task}</div>
      )}
      {isCompleted && message.findings != null && message.findings > 0 && (
        <div className="mt-1 text-amber-400/80">{message.findings} finding(s)</div>
      )}
    </div>
  )
}
