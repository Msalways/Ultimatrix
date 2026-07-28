'use client'

import { useConfigStore } from '@/stores/config-store'
import { ConfigField } from '../config-field'
import { ConfigSection } from '../config-section'
import { useState, useEffect } from 'react'

interface ProviderInfo {
  id: string
  name: string
  defaultBaseUrl: string
  envVar: string
}

const KNOWN_PROVIDERS = [
  'openai', 'anthropic', 'google', 'groq', 'nvidia', 'together',
  'deepseek', 'mistral', 'xai', 'perplexity', 'cerebras', 'deepinfra',
  'openrouter', 'azure', 'bedrock', 'cohere', 'ollama', 'custom',
]

export function ProvidersTab() {
  const config = useConfigStore((s) => s.config)
  const update = useConfigStore((s) => s.update)
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({})
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

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
    } else if (provider === 'custom') {
      currentCreds[provider] = { apiKey: '', baseUrl: '' }
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

  const toggleReveal = (provider: string) => {
    setRevealed((prev) => ({ ...prev, [provider]: !prev[provider] }))
  }

  return (
    <div className="space-y-4">
      {configuredProviders.map((provider) => {
        const entry = creds[provider]
        if (!entry) return null
        const info = providers[provider]
        const isRevealed = revealed[provider]

        return (
          <ConfigSection
            key={provider}
            title={info?.name || provider}
            description={info?.envVar ? `Env: ${info.envVar}` : undefined}
            defaultOpen={true}
          >
            <div className="space-y-3">
              <ConfigField label="API Key">
                <div className="flex gap-2">
                  <input
                    type={isRevealed ? 'text' : 'password'}
                    value={(entry as any).apiKey || ''}
                    onChange={(e) => updateCred(provider, 'apiKey', e.target.value)}
                    className="flex-1 px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600 font-mono"
                    placeholder={isRevealed ? 'sk-...' : '••••••••'}
                  />
                  <button
                    type="button"
                    onClick={() => toggleReveal(provider)}
                    className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 border border-zinc-700 rounded"
                  >
                    {isRevealed ? 'Hide' : 'Reveal'}
                  </button>
                </div>
              </ConfigField>

              {provider !== 'azure' && provider !== 'bedrock' && (
                <ConfigField label="Base URL" description={info?.defaultBaseUrl ? `Default: ${info.defaultBaseUrl}` : undefined}>
                  <input
                    value={(entry as any).baseUrl || ''}
                    onChange={(e) => updateCred(provider, 'baseUrl', e.target.value)}
                    className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                    placeholder={info?.defaultBaseUrl || 'https://...'}
                  />
                </ConfigField>
              )}

              {provider === 'azure' && (
                <>
                  <ConfigField label="Endpoint">
                    <input
                      value={(entry as any).endpoint || ''}
                      onChange={(e) => updateCred(provider, 'endpoint', e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                      placeholder="https://your-resource.openai.azure.com"
                    />
                  </ConfigField>
                  <ConfigField label="Deployment">
                    <input
                      value={(entry as any).deployment || ''}
                      onChange={(e) => updateCred(provider, 'deployment', e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                    />
                  </ConfigField>
                  <ConfigField label="API Version">
                    <input
                      value={(entry as any).apiVersion || '2024-10-21'}
                      onChange={(e) => updateCred(provider, 'apiVersion', e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                    />
                  </ConfigField>
                </>
              )}

              {provider === 'bedrock' && (
                <>
                  <ConfigField label="Auth Method">
                    <select
                      value={(entry as any).authMethod || 'iam'}
                      onChange={(e) => updateCred(provider, 'authMethod', e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                    >
                      <option value="iam">IAM (Access Key)</option>
                      <option value="api_key">API Key</option>
                    </select>
                  </ConfigField>
                  {(entry as any).authMethod === 'iam' ? (
                    <>
                      <ConfigField label="Access Key ID">
                        <input
                          value={(entry as any).accessKeyId || ''}
                          onChange={(e) => updateCred(provider, 'accessKeyId', e.target.value)}
                          className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                        />
                      </ConfigField>
                      <ConfigField label="Secret Access Key">
                        <input
                          type="password"
                          value={(entry as any).secretAccessKey || ''}
                          onChange={(e) => updateCred(provider, 'secretAccessKey', e.target.value)}
                          className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                        />
                      </ConfigField>
                    </>
                  ) : (
                    <ConfigField label="API Key">
                      <input
                        type="password"
                        value={(entry as any).apiKey || ''}
                        onChange={(e) => updateCred(provider, 'apiKey', e.target.value)}
                        className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                      />
                    </ConfigField>
                  )}
                  <ConfigField label="Region">
                    <input
                      value={(entry as any).region || ''}
                      onChange={(e) => updateCred(provider, 'region', e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                      placeholder="us-east-1"
                    />
                  </ConfigField>
                </>
              )}

              <button
                type="button"
                onClick={() => removeProvider(provider)}
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
