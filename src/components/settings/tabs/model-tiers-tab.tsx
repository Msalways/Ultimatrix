'use client'

import { useConfigStore } from '@/stores/config-store'
import { ConfigField } from '../config-field'
import { ConfigSelect } from '../config-select'
import { ConfigSection } from '../config-section'
import { useEffect, useState } from 'react'

interface ProviderInfo {
  id: string
  name: string
}

const TIER_KEYS = ['fast', 'balanced', 'powerful'] as const
const TIER_LABELS: Record<string, string> = {
  fast: 'Fast (Quick tasks, low cost)',
  balanced: 'Balanced (Default, good quality)',
  powerful: 'Powerful (Complex reasoning, highest quality)',
}

export function ModelTiersTab() {
  const config = useConfigStore((s) => s.config)
  const update = useConfigStore((s) => s.update)
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({})

  useEffect(() => {
    fetch('/api/config/providers')
      .then((r) => r.json())
      .then(setProviders)
      .catch(() => {})
  }, [])

  if (!config) return null

  const tiers = config.modelTiers || {}
  const providerOptions = Object.entries(providers).map(([id, p]) => ({
    value: id,
    label: p.name,
  }))

  const updateTier = (tier: string, field: string, value: string) => {
    const newTiers = { ...tiers }
    newTiers[tier] = { ...(newTiers[tier] || {}), [field]: value }
    update({ modelTiers: newTiers })
  }

  return (
    <div className="space-y-6">
      <div className="text-xs text-zinc-500">
        Configure models for different task complexities. The multi-model engine selects the best tier per task.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {TIER_KEYS.map((tier) => (
          <div key={tier} className="border border-zinc-800 rounded-lg p-4 space-y-3">
            <div className="text-xs font-medium text-zinc-200 capitalize">{tier}</div>
            <div className="text-xs text-zinc-500">{TIER_LABELS[tier]}</div>

            <ConfigField label="Provider">
              <ConfigSelect
                value={(tiers as any)?.[tier]?.provider || ''}
                onChange={(v) => updateTier(tier, 'provider', v)}
                options={providerOptions}
                placeholder="Select..."
              />
            </ConfigField>

            <ConfigField label="Model">
              <input
                value={(tiers as any)?.[tier]?.model || ''}
                onChange={(e) => updateTier(tier, 'model', e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                placeholder="model-id"
              />
            </ConfigField>
          </div>
        ))}
      </div>

      {config.modelCapabilities && Object.keys(config.modelCapabilities).length > 0 && (
        <ConfigSection title="Model Capabilities" description="Per-model context window and capability overrides">
          <div className="space-y-2">
            {Object.entries(config.modelCapabilities).map(([modelId, cap]) => (
              <div key={modelId} className="grid grid-cols-4 gap-2 text-xs">
                <span className="text-zinc-400 truncate" title={modelId}>{modelId}</span>
                <span className="text-zinc-500">{(cap as any)?.contextWindow?.toLocaleString()} ctx</span>
                <span className="text-zinc-500">{(cap as any)?.maxOutputTokens?.toLocaleString()} out</span>
                <span className="text-zinc-600">{(cap as any)?.strengths?.join(', ')}</span>
              </div>
            ))}
          </div>
        </ConfigSection>
      )}
    </div>
  )
}
