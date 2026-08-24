'use client'

import { useEffect, useMemo, useState } from 'react'
import { useConfigStore } from '@/stores/config-store'
import { ConfigField } from '../config-field'
import { ConfigNumber } from '../config-number'
import { ConfigSelect } from '../config-select'
import { ConfigSection } from '../config-section'

interface ProviderInfo {
  id: string
  name: string
}
const TIERS = ['fast', 'balanced', 'powerful'] as const
const MODULES = ['brain', 'spider', 'crawlSummarizer', 'verifier', 'reporter', 'council'] as const
const DEFAULT_MODULE_TIERS: Record<string, string> = {
  brain: 'balanced',
  spider: 'fast',
  crawlSummarizer: 'fast',
  verifier: 'balanced',
  reporter: 'balanced',
  council: 'powerful',
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

  const modelIds = useMemo(() => {
    if (!config) return []
    const ids = new Set<string>()
    ids.add(`${config.provider}/${config.model}`)
    for (const tier of Object.values(config.modelTiers || {}) as any[]) {
      if (tier?.provider && tier?.model) ids.add(tier.model.includes('/') ? tier.model : `${tier.provider}/${tier.model}`)
    }
    for (const id of Object.keys(config.modelCapabilities || {})) ids.add(id)
    return [...ids].sort()
  }, [config])

  if (!config) return null

  const providerOptions = Object.entries(providers).map(([id, p]) => ({ value: id, label: p.name }))
  const tiers = config.modelTiers || {}
  const capabilities = config.modelCapabilities || {}
  const roleTiers = config.modelRoleTiers || {}

  const updateCapability = (modelId: string, field: string, value: number | boolean) => {
    const current = (capabilities as any)[modelId] || {}
    update({
      modelCapabilities: {
        ...capabilities,
        [modelId]: {
          contextWindow: current.contextWindow ?? 8192,
          maxOutputTokens: current.maxOutputTokens ?? 2048,
          strengths: current.strengths ?? [],
          supportsStreaming: current.supportsStreaming ?? true,
          supportsStructuredOutput: current.supportsStructuredOutput ?? false,
          ...current,
          [field]: value,
        },
      },
    })
  }

  const updateTier = (tier: string, field: string, value: string) => {
    update({ modelTiers: { ...tiers, [tier]: { ...((tiers as any)[tier] || {}), [field]: value } } })
  }

  const updateModuleTier = (role: string, tier: string) => {
    update({ modelRoleTiers: { ...roleTiers, [role]: tier } })
  }

  return (
    <div className="space-y-6">
      <div className="text-xs text-zinc-500">
        Configure models once, assign them to tiers, then map stable modules to tiers. Workers derive from tiers internally.
      </div>

      <ConfigSection title="Models" description="Context and max output belong to the model, not to modules.">
        <div className="space-y-2">
          {modelIds.map((modelId) => {
            const cap = (capabilities as any)[modelId] || {}
            return (
              <div key={modelId} className="grid grid-cols-12 gap-2 rounded-lg border border-zinc-800 p-2 text-xs">
                <div className="col-span-4 truncate text-zinc-300" title={modelId}>{modelId}</div>
                <div className="col-span-3">
                  <ConfigNumber
                    value={cap.contextWindow ?? 8192}
                    onChange={(v) => updateCapability(modelId, 'contextWindow', v)}
                    min={1}
                  />
                </div>
                <div className="col-span-3">
                  <ConfigNumber
                    value={cap.maxOutputTokens ?? 2048}
                    onChange={(v) => updateCapability(modelId, 'maxOutputTokens', v)}
                    min={1}
                  />
                </div>
                <div className="col-span-2 text-zinc-500">ctx / out</div>
              </div>
            )
          })}
        </div>
      </ConfigSection>

      <ConfigSection title="Tier assignment" description="Pick the model used for fast, balanced, and powerful work.">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <div key={tier} className="space-y-3 rounded-lg border border-zinc-800 p-4">
              <div className="text-xs font-medium text-zinc-200">{tier}</div>
              <ConfigField label="Provider">
                <ConfigSelect
                  value={(tiers as any)[tier]?.provider || config.provider}
                  onChange={(v) => updateTier(tier, 'provider', v)}
                  options={providerOptions}
                  placeholder="Select provider"
                />
              </ConfigField>
              <ConfigField label="Model">
                <input
                  value={(tiers as any)[tier]?.model || config.model}
                  onChange={(e) => updateTier(tier, 'model', e.target.value)}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                  placeholder="model-id"
                />
              </ConfigField>
            </div>
          ))}
        </div>
      </ConfigSection>

      <ConfigSection title="Module assignment" description="Stable modules choose tiers. Worker complexity routing is internal.">
        <div className="space-y-2">
          {MODULES.map((role) => (
            <div key={role} className="grid grid-cols-12 items-center gap-2 rounded-lg border border-zinc-800 p-2 text-xs">
              <div className="col-span-4 text-zinc-300">{role}</div>
              <div className="col-span-4">
                <ConfigSelect
                  value={(roleTiers as any)[role] || DEFAULT_MODULE_TIERS[role]}
                  onChange={(v) => updateModuleTier(role, v)}
                  options={TIERS.map((tier) => ({ value: tier, label: tier }))}
                />
              </div>
              <div className="col-span-4 text-zinc-500">
                default: {DEFAULT_MODULE_TIERS[role]}
              </div>
            </div>
          ))}
          <div className="pt-1 text-[11px] text-zinc-600">Workers: low→fast, medium→balanced, high/critical→powerful.</div>
        </div>
      </ConfigSection>
    </div>
  )
}
