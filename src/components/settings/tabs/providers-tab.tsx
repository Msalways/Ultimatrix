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
    update({ creds: currentCreds })
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
