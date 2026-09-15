'use client'

import { useConfigStore } from '@/stores/config-store'
import { ConfigSection } from '../config-section'
import { useEffect, useState } from 'react'
import { ProviderConfigForm, type CredentialValue } from '@/components/provider-config-form'
import type { ProviderInfo } from '@/components/provider-picker'

const KNOWN_PROVIDERS = [
  'openai', 'anthropic', 'google', 'groq', 'nvidia', 'together',
  'deepseek', 'mistral', 'xai', 'perplexity', 'cerebras', 'deepinfra',
  'openrouter', 'azure', 'bedrock', 'cohere', 'ollama',
]

export function ProvidersTab() {
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

  const creds = config.creds || {}
  const configuredProviders = Object.keys(creds).filter((k) => creds[k])
  const availableProviders = KNOWN_PROVIDERS.filter((p) => !configuredProviders.includes(p))

  const updateCred = (provider: string, field: string, value: string) => {
    const currentCreds = { ...config.creds }
    currentCreds[provider] = { ...(currentCreds[provider] || {}), [field]: value }
    update({ creds: currentCreds })
  }

  const addProvider = (provider: string) => {
    const currentCreds = { ...config.creds }
    if (provider === 'azure') {
      currentCreds[provider] = { apiKey: '', endpoint: '', deployment: '', apiVersion: '2024-10-21' }
    } else if (provider === 'bedrock') {
      currentCreds[provider] = { authMethod: 'iam', accessKeyId: '', secretAccessKey: '', region: '' }
    } else {
      currentCreds[provider] = { apiKey: '', baseUrl: providers[provider]?.defaultBaseUrl || '' }
    }
    update({ creds: currentCreds })
  }

  const removeProvider = (provider: string) => {
    const currentCreds = { ...config.creds }
    delete currentCreds[provider]
    const patch: Record<string, any> = { creds: currentCreds }
    // Cascade: drop tier assignments, capability entries, and role overrides
    // that point at the removed provider so they can't resurrect it.
    if (config.modelTiers) {
      const tiers: Record<string, any> = {}
      for (const [tier, entry] of Object.entries(config.modelTiers)) {
        if ((entry as any)?.provider !== provider) tiers[tier] = entry
      }
      patch.modelTiers = tiers
    }
    if (config.modelCapabilities) {
      const caps: Record<string, any> = {}
      for (const [id, cap] of Object.entries(config.modelCapabilities)) {
        if (!id.startsWith(`${provider}/`)) caps[id] = cap
      }
      patch.modelCapabilities = caps
    }
    if (config.modelRoles) {
      const roles: Record<string, any> = { ...config.modelRoles }
      for (const [role, entry] of Object.entries(roles)) {
        if (role === 'worker' && entry && typeof entry === 'object') {
          const worker: Record<string, any> = {}
          for (const [complexity, w] of Object.entries(entry as Record<string, any>)) {
            if ((w as any)?.provider !== provider) worker[complexity] = w
          }
          roles[role] = worker
        } else if ((entry as any)?.provider === provider) {
          delete roles[role]
        }
      }
      patch.modelRoles = roles
    }
    if (config.provider === provider) {
      const remaining = Object.keys(currentCreds).filter((k) => (currentCreds as any)[k])
      patch.provider = remaining[0] ?? ''
      patch.model = ''
    }
    update(patch)
  }

  return (
    <div className="space-y-4">
      {configuredProviders.map((providerId) => {
        const entry = creds[providerId]
        if (!entry) return null
        const info = providers[providerId]
        return (
          <ConfigSection
            key={providerId}
            title={info?.name || providerId}
            description={info?.envVar ? `Env: ${info.envVar}` : undefined}
            defaultOpen={true}
          >
            <div className="space-y-3">
              <ProviderConfigForm
                provider={info ?? { id: providerId, name: providerId, defaultBaseUrl: '', envVar: '' }}
                value={entry as CredentialValue}
                onChange={(field, value) => updateCred(providerId, field, value)}
              />
              <button
                type="button"
                onClick={() => removeProvider(providerId)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Remove
              </button>
            </div>
          </ConfigSection>
        )
      })}

      {availableProviders.length > 0 && (
        <div>
          <div className="text-xs text-zinc-500 mb-2">Add provider:</div>
          <div className="flex flex-wrap gap-1.5">
            {availableProviders.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => addProvider(p)}
                className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
              >
                + {providers[p]?.name || p}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
