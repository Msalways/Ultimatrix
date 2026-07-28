'use client'

import { useState, useCallback } from 'react'
import { Plus, X, Trash2, Globe } from 'lucide-react'
import { useSessionStore, type Session } from '@/stores/session-store'
import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'

export function SessionSidebar() {
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const closeSidebar = useUIStore((s) => s.closeSidebar)
  const addSession = useSessionStore((s) => s.addSession)
  const removeSession = useSessionStore((s) => s.removeSession)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)
  const setActiveTarget = useSessionStore((s) => s.setActiveTarget)
  const [newTarget, setNewTarget] = useState('')

  const handleCreate = useCallback(async () => {
    const target = newTarget.trim()
    if (!target) return

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      })
      const data = await res.json()
      if (data.target) {
        const session: Session = {
          id: data.engineId,
          target: data.target,
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          status: 'idle',
        }
        addSession(session)
        setActiveSession(session.id)
        setActiveTarget(session.target)
        setNewTarget('')
      }
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }, [newTarget, addSession, setActiveSession, setActiveTarget])

  const handleSelect = useCallback((session: Session) => {
    setActiveSession(session.id)
    setActiveTarget(session.target)
  }, [setActiveSession, setActiveTarget])

  const handleDelete = useCallback(async (id: string, target: string) => {
    try {
      await fetch(`/api/sessions/${encodeURIComponent(target)}`, { method: 'DELETE' })
    } catch {}
    removeSession(id)
  }, [removeSession])

  if (!sidebarOpen) return null

  return (
    <div className="w-64 border-r border-zinc-800 bg-zinc-950 flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-xs font-medium text-zinc-400">Targets</span>
        <button onClick={closeSidebar} className="text-zinc-500 hover:text-zinc-300">
          <X size={14} />
        </button>
      </div>

      <div className="p-2 border-b border-zinc-800">
        <div className="flex gap-1">
          <input
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="https://target.com"
            className="flex-1 px-2 py-1 text-xs bg-zinc-900 border border-zinc-800 rounded text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-700"
          />
          <button
            onClick={handleCreate}
            disabled={!newTarget.trim()}
            className="p-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-zinc-600">
            No targets yet. Enter a URL above.
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                'flex items-center gap-2 px-3 py-2 cursor-pointer group',
                session.id === activeSessionId
                  ? 'bg-zinc-800/50 text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-900',
              )}
              onClick={() => handleSelect(session)}
            >
              <Globe size={12} className="flex-shrink-0 text-zinc-600" />
              <span className="text-xs truncate flex-1">{session.target}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(session.id, session.target) }}
                className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

