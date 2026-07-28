'use client'

import { Menu, Settings2 } from 'lucide-react'
import { ChatStream } from '@/components/chat-stream'
import { GraphPanel } from '@/components/graph-panel'
import { SessionSidebar } from '@/components/session-sidebar'
import { StatusBar } from '@/components/status-bar'
import { SettingsModal } from '@/components/settings-modal'
import { useUIStore } from '@/stores/ui-store'
import { useSessionStore } from '@/stores/session-store'

export default function HomeClient() {
  const openSidebar = useUIStore((s) => s.toggleSidebar)
  const openSettings = useUIStore((s) => s.openSettings)
  const activeTarget = useSessionStore((s) => s.activeTarget)

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <SessionSidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800 bg-zinc-950">
          <button onClick={openSidebar} className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded-md hover:bg-zinc-800">
            <Menu size={16} />
          </button>
          <div className="text-sm font-medium text-zinc-300">Ultimatrix</div>
          {activeTarget && (
            <span className="text-xs text-zinc-500 font-mono truncate max-w-[300px]">{activeTarget}</span>
          )}
          <div className="flex-1" />
          <button onClick={openSettings} className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded-md hover:bg-zinc-800">
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
