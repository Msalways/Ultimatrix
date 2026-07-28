'use client'

import { useConfigStore } from '@/stores/config-store'
import { ConfigField } from '../config-field'
import { ConfigSelect } from '../config-select'
import { ConfigNumber } from '../config-number'
import { ConfigToggle } from '../config-toggle'
import { useEffect, useState } from 'react'

const ENGINE_OPTIONS = [
  { value: 'multi-model', label: 'Multi-Model (Recommended)' },
  { value: 'solver', label: 'Solver (Legacy)' },
  { value: 'legacy', label: 'Legacy Supervisor' },
]

interface ProviderInfo {
  id: string
  name: string
  envVar: string
}

export function GeneralTab() {
  const config = useConfigStore((s) => s.config)
  const update = useConfigStore((s) => s.update)
  const [providers, setProviders] = useState<ProviderInfo[]>([])

  useEffect(() => {
    fetch('/api/config/providers')
      .then((r) => r.json())
      .then((data) => setProviders(Object.values(data)))
      .catch(() => {})
  }, [])

  if (!config) return null

  const providerOptions = providers.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.envVar})`,
  }))

  return (
    <div className="space-y-4">
      <ConfigField label="Provider">
        <ConfigSelect
          value={config.provider || ''}
          onChange={(v) => update({ provider: v })}
          options={providerOptions}
          placeholder="Select provider..."
        />
      </ConfigField>

      <ConfigField label="Model" description="Model ID (e.g., llama3-8b-8192, gpt-4o)">
        <input
          value={config.model || ''}
          onChange={(e) => update({ model: e.target.value })}
          className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
          placeholder="model-id"
        />
      </ConfigField>

      <ConfigField label="Target" description="Target URL (optional, can be set per-session)">
        <input
          value={config.target || ''}
          onChange={(e) => update({ target: e.target.value })}
          className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
          placeholder="https://target.com"
        />
      </ConfigField>

      <ConfigField label="Engine">
        <ConfigSelect
          value={config.engine || 'multi-model'}
          onChange={(v) => update({ engine: v })}
          options={ENGINE_OPTIONS}
        />
      </ConfigField>

      <div className="grid grid-cols-2 gap-4">
        <ConfigField label="Depth" description="Scan depth (1-10)">
          <ConfigNumber
            value={config.depth ?? 2}
            onChange={(v) => update({ depth: v })}
            min={1}
            max={10}
          />
        </ConfigField>

        <ConfigField label="Timeout (ms)" description="Request timeout">
          <ConfigNumber
            value={config.timeout ?? 60000}
            onChange={(v) => update({ timeout: v })}
            min={1000}
            step={1000}
          />
        </ConfigField>
      </div>

      <ConfigToggle
        checked={config.requireCapableModel ?? false}
        onChange={(v) => update({ requireCapableModel: v })}
        label="Require capable model (refuse sub-16K context models for complex goals)"
      />
    </div>
  )
}
