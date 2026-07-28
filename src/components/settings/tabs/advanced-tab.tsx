'use client'

import { useConfigStore } from '@/stores/config-store'
import { ConfigField } from '../config-field'
import { ConfigToggle } from '../config-toggle'
import { ConfigNumber } from '../config-number'
import { ConfigSection } from '../config-section'
import { useState } from 'react'

export function AdvancedTab() {
  const config = useConfigStore((s) => s.config)
  const update = useConfigStore((s) => s.update)
  const [newSkillDir, setNewSkillDir] = useState('')
  const [newExclude, setNewExclude] = useState('')

  if (!config) return null

  const campaign = config.campaign || {}
  const oast = config.oast || {}
  const compression = config.compression?.headroom || {}
  const truncation = config.truncation || {}
  const memory = config.memory || { lastMessages: 10, semanticRecall: false, workingMemory: true }
  const agent = config.agent || { maxSteps: 25, scansDir: './scans' }
  const context = config.context || {}
  const council = config.council || {}
  const mcp = config.mcp || []
  const plugins = config.plugins || []
  const skillsDirs = config.skillsDirs || []
  const skillsExclude = config.skills?.exclude || []

  return (
    <div className="space-y-6">
      <ConfigSection title="Campaign" description="Autonomous coverage planning">
        <div className="space-y-3">
          <ConfigToggle
            checked={campaign.auto ?? false}
            onChange={(v) => update({ campaign: { ...campaign, auto: v } })}
            label="Auto-plan campaigns"
          />
          <ConfigField label="Max Slices">
            <ConfigNumber
              value={campaign.maxSlices ?? 50}
              onChange={(v) => update({ campaign: { ...campaign, maxSlices: v } })}
              min={1}
            />
          </ConfigField>
          <ConfigField label="Max Concurrency">
            <ConfigNumber
              value={campaign.maxConcurrency ?? 3}
              onChange={(v) => update({ campaign: { ...campaign, maxConcurrency: v } })}
              min={1}
            />
          </ConfigField>
        </div>
      </ConfigSection>

      <ConfigSection title="OAST" description="Out-of-band testing">
        <div className="space-y-3">
          <ConfigField label="External Host" description="e.g., oast.pro, interact.sh">
            <input
              value={oast.externalHost || ''}
              onChange={(e) => update({ oast: { ...oast, externalHost: e.target.value } })}
              className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
              placeholder="oast.pro"
            />
          </ConfigField>
          <ConfigField label="Callback TTL (ms)">
            <ConfigNumber
              value={oast.callbackTtlMs ?? 3600000}
              onChange={(v) => update({ oast: { ...oast, callbackTtlMs: v } })}
              min={60000}
              step={60000}
            />
          </ConfigField>
        </div>
      </ConfigSection>

      <ConfigSection title="Compression">
        <div className="space-y-3">
          <ConfigToggle
            checked={compression.enabled ?? true}
            onChange={(v) => update({ compression: { ...compression, enabled: v } })}
            label="Enable compression"
          />
          <ConfigField label="Token Budget">
            <ConfigNumber
              value={compression.tokenBudget ?? 100000}
              onChange={(v) => update({ compression: { ...compression, tokenBudget: v } })}
              min={10000}
              step={10000}
            />
          </ConfigField>
          <ConfigField label="Max Response Size">
            <ConfigNumber
              value={compression.maxResponseSize ?? 200000}
              onChange={(v) => update({ compression: { ...compression, maxResponseSize: v } })}
              min={10000}
              step={10000}
            />
          </ConfigField>
          <ConfigToggle
            checked={compression.fallbackToTruncation ?? true}
            onChange={(v) => update({ compression: { ...compression, fallbackToTruncation: v } })}
            label="Fallback to truncation"
          />
        </div>
      </ConfigSection>

      <ConfigSection title="Truncation">
        <div className="space-y-3">
          <ConfigField label="Max Response Size">
            <ConfigNumber
              value={truncation.maxResponseSize ?? 50000}
              onChange={(v) => update({ truncation: { ...truncation, maxResponseSize: v } })}
              min={1000}
              step={1000}
            />
          </ConfigField>
          <ConfigToggle
            checked={truncation.fallbackEnabled ?? true}
            onChange={(v) => update({ truncation: { ...truncation, fallbackEnabled: v } })}
            label="Enable fallback"
          />
        </div>
      </ConfigSection>

      <ConfigSection title="Memory">
        <div className="space-y-3">
          <ConfigField label="Last Messages">
            <ConfigNumber
              value={memory.lastMessages ?? 10}
              onChange={(v) => update({ memory: { ...memory, lastMessages: v } })}
              min={1}
            />
          </ConfigField>
          <ConfigToggle
            checked={memory.semanticRecall ?? false}
            onChange={(v) => update({ memory: { ...memory, semanticRecall: v } })}
            label="Semantic recall"
          />
          <ConfigToggle
            checked={memory.workingMemory ?? true}
            onChange={(v) => update({ memory: { ...memory, workingMemory: v } })}
            label="Working memory"
          />
        </div>
      </ConfigSection>

      <ConfigSection title="Agent">
        <div className="space-y-3">
          <ConfigField label="Max Steps">
            <ConfigNumber
              value={agent.maxSteps ?? 25}
              onChange={(v) => update({ agent: { ...agent, maxSteps: v } })}
              min={1}
            />
          </ConfigField>
          <ConfigField label="Scans Directory">
            <input
              value={agent.scansDir || './scans'}
              onChange={(e) => update({ agent: { ...agent, scansDir: e.target.value } })}
              className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
            />
          </ConfigField>
        </div>
      </ConfigSection>

      <ConfigSection title="Context">
        <div className="space-y-3">
          <ConfigField label="Max Endpoints In Summary">
            <ConfigNumber
              value={context.maxEndpointsInSummary ?? 10}
              onChange={(v) => update({ context: { ...context, maxEndpointsInSummary: v } })}
              min={1}
            />
          </ConfigField>
          <ConfigField label="Max Findings Per Turn">
            <ConfigNumber
              value={context.maxFindingsPerTurn ?? 20}
              onChange={(v) => update({ context: { ...context, maxFindingsPerTurn: v } })}
              min={1}
            />
          </ConfigField>
        </div>
      </ConfigSection>

      <ConfigSection title="Council">
        <div className="space-y-3">
          <ConfigToggle
            checked={council.enabled ?? true}
            onChange={(v) => update({ council: { ...council, enabled: v } })}
            label="Enable council"
          />
          <ConfigField label="Max Rounds">
            <ConfigNumber
              value={council.maxRounds ?? 3}
              onChange={(v) => update({ council: { ...council, maxRounds: v } })}
              min={1}
            />
          </ConfigField>
          <ConfigField label="Budget Per Round">
            <ConfigNumber
              value={council.budgetPerRound ?? 5000}
              onChange={(v) => update({ council: { ...council, budgetPerRound: v } })}
              min={1000}
              step={1000}
            />
          </ConfigField>
          <ConfigField label="Approval Mode">
            <select
              value={council.approvalMode || 'auto'}
              onChange={(e) => update({ council: { ...council, approvalMode: e.target.value } })}
              className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
            >
              <option value="auto">Auto</option>
              <option value="manual">Manual</option>
              <option value="disabled">Disabled</option>
            </select>
          </ConfigField>
        </div>
      </ConfigSection>

      <ConfigSection title="Skills">
        <div className="space-y-3">
          <ConfigField label="Additional Skill Directories">
            <div className="flex gap-2">
              <input
                value={newSkillDir}
                onChange={(e) => setNewSkillDir(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newSkillDir.trim()) {
                    update({ skillsDirs: [...skillsDirs, newSkillDir.trim()] })
                    setNewSkillDir('')
                  }
                }}
                className="flex-1 px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                placeholder="./custom-skills"
              />
              <button
                type="button"
                onClick={() => {
                  if (newSkillDir.trim()) {
                    update({ skillsDirs: [...skillsDirs, newSkillDir.trim()] })
                    setNewSkillDir('')
                  }
                }}
                className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200"
              >
                Add
              </button>
            </div>
            {skillsDirs.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {skillsDirs.map((d: string) => (
                  <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300">
                    {d}
                    <button onClick={() => update({ skillsDirs: skillsDirs.filter((x: string) => x !== d) })} className="text-zinc-500 hover:text-red-400">×</button>
                  </span>
                ))}
              </div>
            )}
          </ConfigField>

          <ConfigField label="Excluded Skills">
            <div className="flex gap-2">
              <input
                value={newExclude}
                onChange={(e) => setNewExclude(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newExclude.trim()) {
                    update({ skills: { exclude: [...skillsExclude, newExclude.trim()] } })
                    setNewExclude('')
                  }
                }}
                className="flex-1 px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
                placeholder="skill-name"
              />
              <button
                type="button"
                onClick={() => {
                  if (newExclude.trim()) {
                    update({ skills: { exclude: [...skillsExclude, newExclude.trim()] } })
                    setNewExclude('')
                  }
                }}
                className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200"
              >
                Add
              </button>
            </div>
            {skillsExclude.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {skillsExclude.map((s: string) => (
                  <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300">
                    {s}
                    <button onClick={() => update({ skills: { exclude: skillsExclude.filter((x: string) => x !== s) } })} className="text-zinc-500 hover:text-red-400">×</button>
                  </span>
                ))}
              </div>
            )}
          </ConfigField>
        </div>
      </ConfigSection>

      <ConfigSection title="MCP Servers">
        <div className="text-xs text-zinc-500">
          {mcp.length === 0 ? 'No MCP servers configured.' : `${mcp.length} server(s) configured.`}
        </div>
      </ConfigSection>

      <ConfigSection title="Plugins">
        <div className="text-xs text-zinc-500">
          {plugins.length === 0 ? 'No plugins configured.' : `${plugins.length} plugin(s) configured.`}
        </div>
      </ConfigSection>
    </div>
  )
}
