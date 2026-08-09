'use client'

import { Check, Cpu, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkerMessage } from '@/stores/chat-store'

export function WorkerCard({ message }: { message: WorkerMessage }) {
  const isRunning = message.type === 'worker-spawned'
  const isCompleted = message.type === 'worker-completed'

  return (
    <div className={cn(
      'ml-4 mr-4 my-1 rounded-md border px-3 py-2 text-xs sm:ml-8',
      isRunning && 'border-zinc-800 bg-zinc-900/50 text-zinc-400',
      isCompleted && message.status === 'completed' && 'border-emerald-900/50 bg-emerald-950/20 text-emerald-400/80',
      isCompleted && message.status === 'error' && 'border-red-900/50 bg-red-950/20 text-red-400/80',
    )}>
      <div className="flex items-center gap-2">
        {isRunning && <Loader2 size={12} className="animate-spin" />}
        {isCompleted && message.status === 'completed' && <Check size={12} />}
        {isCompleted && message.status === 'error' && <X size={12} />}
        <Cpu size={12} className="text-zinc-500" />
        <span className="min-w-0 truncate font-medium">{message.name}</span>
        {message.skillId && (
          <span className="hidden rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">{message.skillId}</span>
        )}
        {isCompleted && message.duration != null && (
          <span className="ml-auto flex-shrink-0 text-zinc-600">{(message.duration / 1000).toFixed(1)}s</span>
        )}
      </div>
      {message.task && (
        <div className="mt-1 truncate text-zinc-500">{message.task}</div>
      )}
      {isCompleted && message.findings != null && message.findings > 0 && (
        <div className="mt-1 text-amber-400/80">{message.findings} finding(s)</div>
      )}
    </div>
  )
}
