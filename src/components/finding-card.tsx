'use client'

import { AlertTriangle, Info, ShieldAlert, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FindingMessage } from '@/stores/chat-store'

const severityConfig: Record<string, { color: string; bg: string; icon: typeof AlertTriangle }> = {
  critical: { color: 'text-red-400', bg: 'bg-red-950/30 border-red-900/50', icon: ShieldAlert },
  high: { color: 'text-orange-400', bg: 'bg-orange-950/30 border-orange-900/50', icon: AlertTriangle },
  medium: { color: 'text-yellow-400', bg: 'bg-yellow-950/30 border-yellow-900/50', icon: AlertTriangle },
  low: { color: 'text-blue-400', bg: 'bg-blue-950/30 border-blue-900/50', icon: Info },
  info: { color: 'text-zinc-400', bg: 'bg-zinc-800/30 border-zinc-700/50', icon: Info },
}

export function FindingCard({ message }: { message: FindingMessage }) {
  const config = severityConfig[message.severity] || severityConfig.info
  const Icon = config.icon

  return (
    <div className={cn('ml-8 my-2 p-3 rounded-lg border', config.bg)}>
      <div className="flex items-start gap-2">
        <Icon size={14} className={cn('mt-0.5 flex-shrink-0', config.color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('text-xs font-semibold uppercase', config.color)}>
              {message.severity}
            </span>
            <span className="text-xs text-zinc-500">{message.technique}</span>
          </div>
          {message.endpoint && (
            <div className="text-xs text-zinc-400 font-mono truncate">
              {message.endpoint}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
