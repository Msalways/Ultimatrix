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
  envVar?: string
}

function providerHasKey(creds: Record<string, any> | undefined, provider: string): boolean {
  const entry = creds?.[provider] as Record<string, any> | undefined
  if (!entry || typeof entry !== 'object') return false
  if ('apiKey' in entry) return typeof entry.apiKey === 'string' && entry.apiKey.length > 0
  return true
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

  const clearTier = (tier: string) => {
    const next = { ...tiers }
    delete (next as any)[tier]
    update({ modelTiers: next })
  }

  const removeCapability = (modelId: string) => {
    const next = { ...capabilities }
    delete (next as any)[modelId]
    update({ modelCapabilities: next })
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
            const stored = (capabilities as any)[modelId] !== undefined
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
                <div className="col-span-1 text-zinc-500">ctx / out</div>
                <div className="col-span-1 text-right">
                  {stored && (
                    <button
                      type="button"
                      onClick={() => removeCapability(modelId)}
                      className="text-red-400 hover:text-red-300"
                      title={`Remove ${modelId}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </ConfigSection>

      <ConfigSection title="Tier assignment" description="Pick the model used for fast, balanced, and powerful work. Empty tiers fall back to the default model.">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {TIERS.map((tier) => {
            const entry = (tiers as any)[tier]
            const tierProvider = entry?.provider || config.provider
            const keyMissing = !providerHasKey(config.creds, tierProvider)
            return (
              <div key={tier} className="space-y-3 rounded-lg border border-zinc-800 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-zinc-200">{tier}</div>
                  {entry !== undefined && (
                    <button
                      type="button"
                      onClick={() => clearTier(tier)}
                      className="text-[11px] text-zinc-500 hover:text-red-400"
                      title={`Clear ${tier} (use default model)`}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {!entry && (
                  <div className="text-[11px] text-zinc-500">Using default model ({config.provider}/{config.model})</div>
                )}
                <ConfigField label="Provider">
                  <ConfigSelect
                    value={entry?.provider || ''}
                    onChange={(v) => updateTier(tier, 'provider', v)}
                    options={providerOptions}
                    placeholder={`Default (${config.provider})`}
                  />
                </ConfigField>
                <ConfigField label="Model">
                  <input
                    value={entry?.model || ''}
                    onChange={(e) => updateTier(tier, 'model', e.target.value)}
                    className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                    placeholder={`Default (${config.model})`}
                  />
                </ConfigField>
                {keyMissing && (
                  <div className="text-[11px] text-amber-400">
                    No API key saved for {tierProvider}
                    {providers[tierProvider]?.envVar ? ` (env: ${providers[tierProvider].envVar})` : ''} — add one in the Providers tab.
                  </div>
                )}
              </div>
            )
          })}
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
