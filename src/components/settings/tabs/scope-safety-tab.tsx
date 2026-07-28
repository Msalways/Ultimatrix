'use client'

import { useConfigStore } from '@/stores/config-store'
import { ConfigField } from '../config-field'
import { ConfigSelect } from '../config-select'
import { ConfigToggle } from '../config-toggle'
import { useState } from 'react'

export function ScopeSafetyTab() {
  const config = useConfigStore((s) => s.config)
  const update = useConfigStore((s) => s.update)
  const [newDomain, setNewDomain] = useState('')
  const [newPath, setNewPath] = useState('')

  if (!config) return null

  const scope = config.scope || { enforcement: 'warn' as const }
  const auth = config.authorization || { confirmed: false, method: 'self-owned' as const, target: '', timestamp: '' }

  const addDomain = () => {
    if (!newDomain.trim()) return
    const domains = [...(scope.allowedDomains || []), newDomain.trim()]
    update({ scope: { ...scope, allowedDomains: domains } })
    setNewDomain('')
  }

  const removeDomain = (d: string) => {
    update({ scope: { ...scope, allowedDomains: (scope.allowedDomains || []).filter((x: string) => x !== d) } })
  }

  const addPath = () => {
    if (!newPath.trim()) return
    const paths = [...(scope.allowedPaths || []), newPath.trim()]
    update({ scope: { ...scope, allowedPaths: paths } })
    setNewPath('')
  }

  const removePath = (p: string) => {
    update({ scope: { ...scope, allowedPaths: (scope.allowedPaths || []).filter((x: string) => x !== p) } })
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-medium text-zinc-200 mb-3">Scope</div>
        <div className="space-y-3">
          <ConfigField label="Allowed Domains" description="Domains the tool can access. Empty = all.">
            <div className="flex gap-2">
              <input
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addDomain()}
                className="flex-1 px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                placeholder="example.com"
              />
              <button
                type="button"
                onClick={addDomain}
                className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200"
              >
                Add
              </button>
            </div>
            {scope.allowedDomains && scope.allowedDomains.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {scope.allowedDomains.map((d: string) => (
                  <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300">
                    {d}
                    <button onClick={() => removeDomain(d)} className="text-zinc-500 hover:text-red-400">×</button>
                  </span>
                ))}
              </div>
            )}
          </ConfigField>

          <ConfigField label="Allowed Paths" description="URL path prefixes. Empty = all.">
            <div className="flex gap-2">
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPath()}
                className="flex-1 px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                placeholder="/api"
              />
              <button
                type="button"
                onClick={addPath}
                className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200"
              >
                Add
              </button>
            </div>
            {scope.allowedPaths && scope.allowedPaths.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {scope.allowedPaths.map((p: string) => (
                  <span key={p} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300">
                    {p}
                    <button onClick={() => removePath(p)} className="text-zinc-500 hover:text-red-400">×</button>
                  </span>
                ))}
              </div>
            )}
          </ConfigField>

          <ConfigField label="Enforcement">
            <ConfigSelect
              value={scope.enforcement || 'warn'}
              onChange={(v) => update({ scope: { ...scope, enforcement: v as 'hard' | 'warn' } })}
              options={[
                { value: 'warn', label: 'Warn (log violations)' },
                { value: 'hard', label: 'Hard (block out-of-scope)' },
              ]}
            />
          </ConfigField>
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-zinc-200 mb-3">Authorization</div>
        <div className="space-y-3">
          <ConfigField label="Authorization Method">
            <ConfigSelect
              value={auth.method || 'self-owned'}
              onChange={(v) => update({ authorization: { ...auth, method: v as any, confirmed: auth.confirmed, target: auth.target, timestamp: auth.timestamp } })}
              options={[
                { value: 'self-owned', label: 'Self-owned target' },
                { value: 'lab', label: 'Lab environment' },
                { value: 'bounty', label: 'Bug bounty program' },
                { value: 'pentest-contract', label: 'Penetration test contract' },
                { value: 'written-permission', label: 'Written permission' },
              ]}
            />
          </ConfigField>

          <ConfigField label="Target description" description="Who owns the target (for audit trail)">
            <input
              value={auth.target || ''}
              onChange={(e) => update({ authorization: { ...auth, target: e.target.value, confirmed: auth.confirmed, method: auth.method, timestamp: auth.timestamp } })}
              className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
              placeholder="e.g., my company's staging server"
            />
          </ConfigField>

          <ConfigToggle
            checked={auth.confirmed ?? false}
            onChange={(v) => update({ authorization: { ...auth, confirmed: v, method: auth.method, target: auth.target, timestamp: auth.timestamp } })}
            label="I confirm I have authorization to test this target"
          />
        </div>
      </div>
    </div>
  )
}
