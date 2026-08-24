'use client'

import { useEffect, useState } from 'react'
import { useConfigStore } from '@/stores/config-store'

type Effective = {
  status: 'ok' | 'warning' | 'error'
  errors: string[]
  warnings: string[]
  tiers: Record<string, { modelId: string; capability?: { contextWindow: number; maxOutputTokens: number }; credentialConfigured: boolean }>
  modules: Record<string, { tier: string; modelId: string; advancedOverride?: boolean }>
  mcp: Array<{ name: string; type: string; trusted: boolean; location: string; warnings: string[] }>
}

function badge(status: string) {
  if (status === 'ok') return 'text-emerald-400 bg-emerald-950/40 border-emerald-900'
  if (status === 'error') return 'text-red-400 bg-red-950/40 border-red-900'
  return 'text-amber-400 bg-amber-950/40 border-amber-900'
}

export function SetupHealthTab() {
  const config = useConfigStore((s) => s.config)
  const [effective, setEffective] = useState<Effective | null>(null)

  useEffect(() => {
    fetch('/api/config/effective', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setEffective(data.effective ?? null))
      .catch(() => setEffective(null))
  }, [config])

  if (!config) return null
  if (!effective) return <div className="text-xs text-zinc-500">Loading setup health...</div>

  return (
    <div className="space-y-5">
      <div className={`inline-flex rounded border px-2 py-1 text-xs ${badge(effective.status)}`}>
        Config health: {effective.status}
      </div>

      {(effective.errors.length > 0 || effective.warnings.length > 0) && (
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          {effective.errors.map((e) => <div key={e} className="text-xs text-red-400">Error: {e}</div>)}
          {effective.warnings.map((w) => <div key={w} className="text-xs text-amber-400">Warning: {w}</div>)}
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-medium text-zinc-300">Tier assignment</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {(['fast', 'balanced', 'powerful'] as const).map((tier) => {
            const row = effective.tiers[tier]
            return (
              <div key={tier} className="rounded-lg border border-zinc-800 p-3">
                <div className="text-xs font-medium text-zinc-200">{tier}</div>
                <div className="mt-1 truncate text-xs text-zinc-400" title={row.modelId}>{row.modelId}</div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {row.capability ? `${row.capability.contextWindow.toLocaleString()} ctx / ${row.capability.maxOutputTokens.toLocaleString()} out` : 'unknown limits'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-zinc-300">Runtime preview</div>
        <div className="space-y-1 rounded-lg border border-zinc-800 p-3">
          {Object.entries(effective.modules).map(([role, route]) => (
            <div key={role} className="grid grid-cols-12 gap-2 text-xs">
              <span className="col-span-3 text-zinc-300">{role}</span>
              <span className="col-span-2 text-zinc-500">{route.tier}</span>
              <span className="col-span-7 truncate text-zinc-400" title={route.modelId}>
                {route.modelId}{route.advancedOverride ? ' (advanced override)' : ''}
              </span>
            </div>
          ))}
          <div className="pt-2 text-[11px] text-zinc-600">Workers derive internally: low→fast, medium→balanced, high/critical→powerful.</div>
        </div>
      </div>
    </div>
  )
}

