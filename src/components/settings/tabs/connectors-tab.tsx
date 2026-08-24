'use client'

import { useConfigStore } from '@/stores/config-store'
import { ConfigField } from '../config-field'

export function ConnectorsTab() {
  const config = useConfigStore((s) => s.config)
  const update = useConfigStore((s) => s.update)
  if (!config) return null

  const mcp = config.mcp || []
  const plugins = config.plugins || []
  const skillsDirs = config.skillsDirs || []

  const setTrusted = (name: string, trusted: boolean) => {
    update({ mcp: mcp.map((s: any) => s.name === name ? { ...s, trusted } : s) })
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-xs font-medium text-zinc-300">MCP connectors</div>
        {mcp.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 p-3 text-xs text-zinc-500">
            No MCP servers configured. Use the CLI for now: ultimatrix mcp add &lt;name&gt; --command &quot;...&quot;.
          </div>
        ) : (
          <div className="space-y-2">
            {mcp.map((server: any) => {
              const type = server.type || (server.url ? 'http' : 'stdio')
              const location = server.command || server.url || 'missing command/url'
              return (
                <div key={server.name} className="rounded-lg border border-zinc-800 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium text-zinc-200">{server.name}</div>
                      <div className="text-[11px] text-zinc-500">{type} · {location}</div>
                      {server.auth?.kind && <div className="text-[11px] text-zinc-600">auth: {server.auth.kind}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setTrusted(server.name, !server.trusted)}
                      className={`rounded border px-2 py-1 text-xs ${server.trusted ? 'border-emerald-900 bg-emerald-950/40 text-emerald-400' : 'border-amber-900 bg-amber-950/40 text-amber-400'}`}
                    >
                      {server.trusted ? 'Trusted' : 'Untrusted'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ConfigField label="Plugins">
        <div className="text-xs text-zinc-500">
          {plugins.length === 0 ? 'No plugins configured.' : `${plugins.length} plugin(s) configured.`}
        </div>
      </ConfigField>

      <ConfigField label="Skill directories">
        <div className="text-xs text-zinc-500">
          {skillsDirs.length === 0 ? 'Using bundled skills only.' : skillsDirs.join(', ')}
        </div>
      </ConfigField>
    </div>
  )
}

