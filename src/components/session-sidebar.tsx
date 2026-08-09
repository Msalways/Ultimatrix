'use client'

import { useState, useCallback, useEffect } from 'react'
import { AlertCircle, Loader2, Plus, X, Trash2, Globe } from 'lucide-react'
import { useSessionStore, type Session } from '@/stores/session-store'
import { useUIStore } from '@/stores/ui-store'
import { useResourceStore } from '@/stores/resource-store'
import { cn } from '@/lib/utils'
import { dataFetcher } from '@/services/data-fetcher'

interface SessionTargetInfo {
  target: string
  engineId: string
  running?: boolean
  createdAt?: number
  lastActiveAt?: number
}

export function SessionSidebar() {
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const closeSidebar = useUIStore((s) => s.closeSidebar)
  const setSessions = useSessionStore((s) => s.setSessions)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)
  const setActiveTarget = useSessionStore((s) => s.setActiveTarget)
  const markResource = useResourceStore((s) => s.mark)
  const sessionState = useResourceStore((s) => s.resources.session.state)
  const [newTarget, setNewTarget] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    const loaded = await dataFetcher.loadSessions()
    setSessions(loaded as Session[])
    const activeStillExists = activeSessionId
      ? loaded.some((session) => session.id === activeSessionId)
      : false
    if ((!activeSessionId || !activeStillExists) && loaded.length > 0) {
      const latest = loaded[loaded.length - 1]
      setActiveSession(latest.id)
      setActiveTarget(latest.target)
    } else if (activeSessionId && !activeStillExists) {
      setActiveSession(null)
      setActiveTarget(null)
    }
  }, [activeSessionId, setActiveSession, setActiveTarget, setSessions])

  // Fetch once on mount — no polling
  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  // Re-fetch when sidebar opens (user may have run a scan from CLI)
  useEffect(() => {
    if (sidebarOpen) loadSessions()
  }, [sidebarOpen, loadSessions])

  const handleCreate = useCallback(async () => {
    const target = newTarget.trim()
    if (!target || creating) return

    setCreating(true)
    setError(null)

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create target workspace.')
      if (data.target) {
        setActiveSession(data.engineId)
        setActiveTarget(data.target)
        setNewTarget('')
        await loadSessions()
        if (window.innerWidth < 768) closeSidebar()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create target workspace.')
    } finally {
      setCreating(false)
    }
  }, [newTarget, creating, setActiveSession, setActiveTarget, closeSidebar, loadSessions])

  const handleSelect = useCallback((session: Session) => {
    setActiveSession(session.id)
    setActiveTarget(session.target)
    if (window.innerWidth < 768) closeSidebar()
  }, [setActiveSession, setActiveTarget, closeSidebar])

  const handleDelete = useCallback(async (id: string, target: string) => {
    if (!window.confirm(`Remove ${target} from the workspace? Scan artifacts will be kept on disk.`)) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/sessions?target=${encodeURIComponent(target)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not remove target.')
      await loadSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove target.')
    } finally {
      setDeletingId(null)
    }
  }, [loadSessions])

  if (!sidebarOpen) return null

  return (
    <>
    <button
      aria-label="Close targets"
      className="fixed inset-0 z-30 bg-black/50 md:hidden"
      onClick={closeSidebar}
    />
    <aside className="fixed inset-y-0 left-0 z-40 flex h-full w-72 flex-col border-r border-zinc-800/80 bg-zinc-950 shadow-2xl shadow-black/40 md:relative md:z-auto md:w-72 md:shadow-none">
      <div className="flex h-12 items-center justify-between border-b border-zinc-800/80 px-3">
        <span className="text-xs font-semibold uppercase text-zinc-400">Targets</span>
        <button
          onClick={closeSidebar}
          aria-label="Close targets"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
        >
          <X size={14} />
        </button>
      </div>

      <div className="border-b border-zinc-800/80 p-3">
        <div className="flex gap-1">
          <input
            value={newTarget}
            onChange={(e) => { setNewTarget(e.target.value); setError(null) }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="https://target.com"
            className="h-9 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-700"
          />
          <button
            onClick={handleCreate}
            disabled={!newTarget.trim() || creating}
            aria-label="Add target"
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          </button>
        </div>
        {error && (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-red-400/90">
            <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs leading-relaxed text-zinc-600">
            No targets yet. Enter a URL above.
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                'group flex w-full items-center gap-1 border-l-2 pr-2 transition-colors',
                session.id === activeSessionId
                  ? 'border-emerald-400/70 bg-zinc-900 text-zinc-100'
                  : 'border-transparent text-zinc-400 hover:bg-zinc-900',
              )}
            >
              <button
                onClick={() => handleSelect(session)}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-600"
              >
                <Globe size={12} className="flex-shrink-0 text-zinc-600" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{targetLabel(session.target)}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-zinc-600">{session.target}</span>
                </span>
                {session.status === 'running' && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(session.id, session.target) }}
                aria-label={`Delete ${session.target}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-600 opacity-0 transition-opacity hover:bg-red-950/40 hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
              >
                {deletingId === session.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
    </>
  )
}

function targetLabel(target: string): string {
  try {
    return new URL(target).hostname
  } catch {
    return target
  }
}
