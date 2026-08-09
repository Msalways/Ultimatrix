'use client'

import { useEffect, useState } from 'react'
import { MousePointerClick, X } from 'lucide-react'
import { useBudgetStore } from '@/stores/budget-store'
import { useSessionStore } from '@/stores/session-store'
import { cn } from '@/lib/utils'
import { dataFetcher } from '@/services/data-fetcher'

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

interface WebStatus {
  initialized?: boolean
  running?: boolean
  targetCount?: number
  deployed?: boolean
  browser?: {
    active: boolean
    headless: boolean | null
    env: string | null
    pageCount: number | null
    currentUrl: string | null
    humanCaptureActive: boolean
  }
}

export function StatusBar() {
  const { phase, tokensUsed, tokensMax, durationMs, findingsCount, toolCallsCount, isRunning } = useBudgetStore()
  const activeTarget = useSessionStore((s) => s.activeTarget)
  const [webStatus, setWebStatus] = useState<WebStatus | null>(null)
  const [closingBrowser, setClosingBrowser] = useState(false)

  useEffect(() => {
    dataFetcher.loadStatus().then((data) => {
      if (data.ok) setWebStatus(data as unknown as WebStatus)
    })
  }, [])

  useEffect(() => {
    return dataFetcher.onSSE('browser:', () => {
      dataFetcher.loadStatus().then((data) => {
        if (data.ok) setWebStatus(data as unknown as WebStatus)
      })
    })
  }, [])

  async function closeAutomationBrowser() {
    setClosingBrowser(true)
    try {
      const res = await fetch('/api/browser', { method: 'DELETE' })
      const data = await res.json()
      if (data.ok) {
        setWebStatus((prev) => ({ ...(prev || {}), browser: data.browser }))
      }
    } finally {
      setClosingBrowser(false)
    }
  }

  return (
    <div className="flex min-h-8 items-center gap-3 overflow-x-auto border-t border-zinc-800/80 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-500 sm:px-4">
      {activeTarget && (
        <span className="hidden max-w-[220px] truncate text-zinc-400 md:inline">{activeTarget}</span>
      )}
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className={cn('h-1.5 w-1.5 rounded-full', isRunning ? 'bg-emerald-400' : 'bg-zinc-700')} />
        <span className={cn('font-medium', phaseColors[phase || 'idle'] || 'text-zinc-500')}>
          {isRunning ? (phase || 'thinking') : 'idle'}
        </span>
      </span>
      <span className="h-3 w-px bg-zinc-800" />
      <span className="whitespace-nowrap">{toolCallsCount} tool calls</span>
      <span className="h-3 w-px bg-zinc-800" />
      <span className={cn('whitespace-nowrap', findingsCount > 0 && 'text-red-300')}>{findingsCount} findings</span>
      <span className="h-3 w-px bg-zinc-800" />
      <span className="whitespace-nowrap">{formatDuration(durationMs)}</span>
      {webStatus && (
        <>
          <span className="hidden h-3 w-px bg-zinc-800 sm:inline-block" />
          <span className="hidden whitespace-nowrap sm:inline">{webStatus.targetCount ?? 0} targets</span>
          <span className={cn('hidden whitespace-nowrap sm:inline', webStatus.initialized ? 'text-emerald-400/80' : 'text-zinc-600')}>
            {webStatus.initialized ? 'initialized' : 'not initialized'}
          </span>
          {webStatus.browser?.active && (
            <>
              <span className="hidden h-3 w-px bg-zinc-800 md:inline-block" />
              <span
                className={cn(
                  'hidden items-center gap-1.5 whitespace-nowrap md:inline-flex',
                  webStatus.browser.humanCaptureActive ? 'text-emerald-300/80' : 'text-amber-300/80',
                )}
                title={webStatus.browser.currentUrl || undefined}
              >
                <MousePointerClick size={12} />
                {webStatus.browser.humanCaptureActive ? 'capture on' : 'capture off'}
                {webStatus.browser.pageCount != null ? ` · ${webStatus.browser.pageCount} page${webStatus.browser.pageCount === 1 ? '' : 's'}` : ''}
              </span>
              <button
                type="button"
                onClick={closeAutomationBrowser}
                disabled={closingBrowser}
                className="hidden h-6 w-6 items-center justify-center rounded-md border border-zinc-800 text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300 disabled:opacity-50 md:inline-flex"
                title="Close automation browser"
                aria-label="Close automation browser"
              >
                <X size={12} />
              </button>
            </>
          )}
        </>
      )}
      {tokensUsed > 0 && (
        <>
          <span className="h-3 w-px bg-zinc-800" />
          <span className="whitespace-nowrap">{Math.round(tokensUsed / 1000)}k tokens</span>
        </>
      )}
      <div className="ml-auto hidden items-center gap-2 sm:flex">
        {isRunning && (
          <div className="h-1 w-20 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-emerald-400/70 transition-all"
              style={{ width: `${Math.min((tokensUsed / tokensMax) * 100, 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
