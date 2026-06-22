'use client'

import { useState, useEffect } from 'react'
import { Bug, FileCode, Settings, Activity, MessageSquare } from 'lucide-react'
import { ChatPanel } from '@/components/chat'
import { FindingsPanel } from '@/components/findings-panel'
import { CodePanel } from '@/components/code-panel'
import { ActivityPanel } from '@/components/activity-panel'
import { SettingsPanel } from '@/components/settings-panel'
import { StatusBar } from '@/components/status-bar'

type TabId = 'chat' | 'findings' | 'code' | 'settings'

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('chat')
  const [showActivity, setShowActivity] = useState(false)
  const [findingCount, setFindingCount] = useState(0)

  useEffect(() => {
    function pollCount() {
      fetch('/api/findings')
        .then(r => r.json())
        .then(d => setFindingCount(d.findings?.length ?? 0))
        .catch(() => {})
    }
    pollCount()
    const id = setInterval(pollCount, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex h-screen">
      {/* Left sidebar */}
      <nav className="w-14 border-r border-border flex flex-col items-center py-4 gap-4 bg-card">
        <button
          onClick={() => setActiveTab('chat')}
          className={`p-2 rounded-lg transition-colors ${activeTab === 'chat' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          title="Chat"
        >
          <MessageSquare size={20} />
        </button>
        <button
          onClick={() => setActiveTab('findings')}
          className={`p-2 rounded-lg transition-colors relative ${activeTab === 'findings' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          title="Findings"
        >
          <Bug size={20} />
          {findingCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
              {findingCount > 99 ? '99+' : findingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('code')}
          className={`p-2 rounded-lg transition-colors ${activeTab === 'code' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          title="Playwright Code"
        >
          <FileCode size={20} />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setShowActivity(!showActivity)}
          className={`p-2 rounded-lg transition-colors ${showActivity ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          title="Activity Log"
        >
          <Activity size={20} />
        </button>
        <button
          className={`p-2 rounded-lg transition-colors ${activeTab === 'settings' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          title="Settings"
          onClick={() => setActiveTab('settings')}
        >
          <Settings size={20} />
        </button>
      </nav>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-border px-6 py-3 flex items-center justify-between bg-card">
          <h1 className="text-sm font-semibold text-foreground">Ultimatrix Security Assistant</h1>
          <StatusBar />
        </header>

        {activeTab === 'chat' && <ChatPanel />}
        {activeTab === 'findings' && <FindingsPanel />}
        {activeTab === 'code' && <CodePanel />}
        {activeTab === 'settings' && <SettingsPanel />}
      </main>

      {/* Activity sidebar */}
      {showActivity && <ActivityPanel onClose={() => setShowActivity(false)} />}
    </div>
  )
}
