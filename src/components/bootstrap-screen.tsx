'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { useResourceStore, type ResourceKey } from '@/stores/resource-store'
import { cn } from '@/lib/utils'

interface BootstrapPhase {
  key: ResourceKey
  label: string
}

const BOOTSTRAP_PHASES: BootstrapPhase[] = [
  { key: 'config', label: 'Loading configuration' },
  { key: 'session', label: 'Restoring workspace' },
  { key: 'chatHistory', label: 'Loading chat history' },
  { key: 'graph', label: 'Loading graph' },
  { key: 'skills', label: 'Indexing capabilities' },
]

const STATE_PRIORITY: Record<string, number> = {
  loading: 0,
  refreshing: 0,
  error: 1,
  idle: 2,
  ready: 3,
}

interface BootstrapScreenProps {
  onComplete: () => void
}

export function BootstrapScreen({ onComplete }: BootstrapScreenProps) {
  const resources = useResourceStore((s) => s.resources)
  const [visible, setVisible] = useState(true)
  const [fadingOut, setFadingOut] = useState(false)

  const coreReady =
    (resources.config.state === 'ready' || resources.config.state === 'error') &&
    (resources.session.state === 'ready' || resources.session.state === 'error')
  const allReady = BOOTSTRAP_PHASES.every(
    (p) => resources[p.key].state === 'ready' || resources[p.key].state === 'error',
  )

  const sortedPhases = useMemo(() => {
    return [...BOOTSTRAP_PHASES].sort((a, b) => {
      const sa = STATE_PRIORITY[resources[a.key].state] ?? 2
      const sb = STATE_PRIORITY[resources[b.key].state] ?? 2
      return sa - sb
    })
  }, [resources])

  useEffect(() => {
    if (coreReady && !fadingOut) {
      const timer = setTimeout(() => {
        setFadingOut(true)
        setTimeout(() => {
          setVisible(false)
          onComplete()
        }, 300)
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [coreReady, fadingOut, onComplete])

  if (!visible) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-zinc-950 transition-opacity duration-300',
        fadingOut ? 'opacity-0' : 'opacity-100',
      )}
    >
      <div className="w-full max-w-sm space-y-4 px-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-zinc-800 flex items-center justify-center">
            <span className="text-sm font-bold text-zinc-300">U</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-zinc-200">Ultimatrix</h1>
            <p className="text-[11px] text-zinc-500">Security research workspace</p>
          </div>
        </div>

        <div className="space-y-2">
          {sortedPhases.map((phase) => {
            const state = resources[phase.key].state
            return (
              <div key={phase.key} className="flex items-center gap-2.5">
                <BootstrapIcon state={state} />
                <span className={cn(
                  'text-xs',
                  state === 'ready' ? 'text-zinc-400' :
                  state === 'loading' ? 'text-zinc-200' :
                  state === 'error' ? 'text-red-400' :
                  'text-zinc-600',
                )}>
                  {phase.label}
                </span>
                {state === 'error' && resources[phase.key].error && (
                  <span className="ml-auto text-[10px] text-red-500">failed</span>
                )}
              </div>
            )
          })}
        </div>

        {allReady && !coreReady && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 size={12} className="animate-spin" />
            Finalizing…
          </div>
        )}
      </div>
    </div>
  )
}

function BootstrapIcon({ state }: { state: string }) {
  if (state === 'ready') {
    return <CheckCircle2 size={14} className="text-emerald-400" />
  }
  if (state === 'loading' || state === 'refreshing') {
    return <Loader2 size={14} className="animate-spin text-zinc-300" />
  }
  if (state === 'error') {
    return <Circle size={14} className="text-red-400" />
  }
  return <Circle size={14} className="text-zinc-700" />
}
