'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'

interface StatusData {
  ok: boolean
  initialized: boolean
  browserReady: boolean
  oastPort: number | null
  initError: string | null
  model: string | null
  target: string | null
  uptime: number
  findings: number
  deployed: boolean
  phase: 'off' | 'starting' | 'ready'
}

export function StatusBar() {
  const [status, setStatus] = useState<StatusData | null>(null)
  const [error, setError] = useState(false)
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    let mounted = true
    async function fetchStatus() {
      try {
        const res = await fetch('/api/status')
        if (!res.ok) throw new Error('status failed')
        const data = await res.json()
        if (mounted) {
          setStatus(data)
          setError(false)
        }
      } catch {
        if (mounted) setError(true)
      }
    }
    fetchStatus()
    const id = setInterval(fetchStatus, 3000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  const phaseLabel = status?.phase === 'ready' ? 'Ready' : status?.phase === 'starting' ? 'Starting...' : error ? 'Offline' : 'Off'
  const dotColor = error ? 'bg-destructive' : status?.phase === 'ready' ? 'bg-green-500' : 'bg-yellow-500'

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
      <span>{phaseLabel}</span>
      {status?.model && <span className="hidden sm:inline">· {status.model.split('/')[1] || status.model}</span>}
      {status?.oastPort && <span className="hidden lg:inline">· OAST :{status.oastPort}</span>}
      {status?.target && <span className="hidden md:inline">· {status.target.length > 30 ? status.target.slice(0, 30) + '…' : status.target}</span>}
      {status !== null && <span className="hidden xl:inline">· {status.findings} finding{status.findings !== 1 ? 's' : ''}</span>}
      {mounted && (
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-1 rounded hover:bg-accent transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
        </button>
      )}
    </div>
  )
}
