'use client'

import { useBudgetStore } from '@/stores/budget-store'
import { useSessionStore } from '@/stores/session-store'
import { cn } from '@/lib/utils'

const phaseColors: Record<string, string> = {
  observe: 'text-blue-400',
  reason: 'text-purple-400',
  explore: 'text-emerald-400',
  conclude: 'text-amber-400',
  idle: 'text-zinc-500',
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`
}

export function StatusBar() {
  const { phase, tokensUsed, tokensMax, durationMs, findingsCount, toolCallsCount, isRunning } = useBudgetStore()
  const activeTarget = useSessionStore((s) => s.activeTarget)

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-1.5 flex items-center gap-4 text-xs text-zinc-500">
      {activeTarget && (
        <span className="text-zinc-400 truncate max-w-[200px]">{activeTarget}</span>
      )}
      <span className={cn('font-medium', phaseColors[phase || 'idle'] || 'text-zinc-500')}>
        {isRunning ? (phase || 'thinking') : 'idle'}
      </span>
      <span>·</span>
      <span>{toolCallsCount} tool calls</span>
      <span>·</span>
      <span>{findingsCount} findings</span>
      <span>·</span>
      <span>{formatDuration(durationMs)}</span>
      {tokensUsed > 0 && (
        <>
          <span>·</span>
          <span>{Math.round(tokensUsed / 1000)}k tokens</span>
        </>
      )}
      <div className="ml-auto flex items-center gap-2">
        {isRunning && (
          <div className="w-16 h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-zinc-600 rounded-full transition-all"
              style={{ width: `${Math.min((tokensUsed / tokensMax) * 100, 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
