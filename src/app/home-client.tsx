'use client'

import { useEffect, useState } from 'react'
import { Loader2, Menu, PanelRightOpen, Settings2, ShieldCheck, Trash2 } from 'lucide-react'
import { ChatStream } from '@/components/chat-stream'
import { GraphPanel } from '@/components/graph-panel'
import { SessionSidebar } from '@/components/session-sidebar'
import { StatusBar } from '@/components/status-bar'
import { SettingsModal } from '@/components/settings-modal'
import { BootstrapScreen } from '@/components/bootstrap-screen'
import { SetupWizard } from '@/components/setup-wizard'
import { useUIStore } from '@/stores/ui-store'
import { useSessionStore } from '@/stores/session-store'
import { useChatStore } from '@/stores/chat-store'
import { useConfigStore } from '@/stores/config-store'
import { useResourceStore } from '@/stores/resource-store'

export default function HomeClient() {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const openSidebar = useUIStore((s) => s.openSidebar)
  const openSettings = useUIStore((s) => s.openSettings)
  const openInspector = useUIStore((s) => s.openInspector)
  const activeTarget = useSessionStore((s) => s.activeTarget)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const loadConfig = useConfigStore((s) => s.load)
  const config = useConfigStore((s) => s.config)
  const configState = useResourceStore((s) => s.resources.config.state)
  const graphState = useResourceStore((s) => s.resources.graph.state)
  const [bootstrapComplete, setBootstrapComplete] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)

  useEffect(() => {
    loadConfig()
    if (window.matchMedia('(min-width: 768px)').matches) {
      openSidebar()
    }
  }, [openSidebar, loadConfig])

  useEffect(() => {
    if (bootstrapComplete && config && !config.provider) {
      setNeedsSetup(true)
    }
  }, [bootstrapComplete, config])

  async function clearConversation() {
    if (!activeTarget || !window.confirm('Clear the conversation for this target? Persisted scan data and findings will be kept.')) return
    const res = await fetch(`/api/chat-history?target=${encodeURIComponent(activeTarget)}`, { method: 'DELETE' })
    if (res.ok) clearMessages()
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {!bootstrapComplete && <BootstrapScreen onComplete={() => setBootstrapComplete(true)} />}
      {needsSetup && <SetupWizard onComplete={() => setNeedsSetup(false)} />}
      <SessionSidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex h-12 items-center gap-3 border-b border-zinc-800/80 bg-zinc-950/95 px-3 sm:px-4">
          <button
            onClick={toggleSidebar}
            aria-label="Toggle targets"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
          >
            <Menu size={16} />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck size={16} className="text-emerald-400/80" />
            <div className="text-sm font-semibold text-zinc-200">Ultimatrix</div>
          </div>
          {activeTarget && (
            <span className="hidden max-w-[34vw] truncate rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1 font-mono text-xs text-zinc-400 sm:inline">
              {activeTarget}
            </span>
          )}
          {graphState === 'loading' && activeTarget && (
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Loader2 size={10} className="animate-spin" />
              Restoring assessment…
            </span>
          )}
          {graphState === 'refreshing' && activeTarget && (
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-600">
              <Loader2 size={10} className="animate-spin" />
              Refreshing…
            </span>
          )}
          <div className="flex-1" />
          {activeTarget && (
            <button
              onClick={clearConversation}
              aria-label="Clear conversation"
              title="Clear conversation"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            onClick={openInspector}
            aria-label="Open intelligence workspace"
            title="Intelligence workspace"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 lg:hidden"
          >
            <PanelRightOpen size={16} />
          </button>
          <button
            onClick={openSettings}
            aria-label="Open settings"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
          >
            <Settings2 size={16} />
          </button>
        </header>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 min-w-0">
            <ChatStream />
          </div>
          <GraphPanel />
        </div>

        <StatusBar />
      </div>

      <SettingsModal />
    </div>
  )
}
