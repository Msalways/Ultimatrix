'use client'

import { useConfigStore } from '@/stores/config-store'
import { ConfigField } from '../config-field'
import { ConfigToggle } from '../config-toggle'
import { ConfigNumber } from '../config-number'
import { ConfigSection } from '../config-section'

export function SolverTab() {
  const config = useConfigStore((s) => s.config)
  const update = useConfigStore((s) => s.update)

  if (!config) return null

  const solver = config.solver || {}
  const antiLoop = config.antiLoop || {}
  const reflexion = config.reflexion || {}
  const verifier = config.verifier || {}
  const interaction = config.interaction || {}

  return (
    <div className="space-y-6">
      <ConfigSection title="Solver" defaultOpen={true}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <ConfigField label="Max Tool Calls" description="Per turn">
              <ConfigNumber
                value={solver.maxToolCalls ?? 50}
                onChange={(v) => update({ solver: { ...solver, maxToolCalls: v } })}
                min={1}
              />
            </ConfigField>
            <ConfigField label="Max Duration (ms)">
              <ConfigNumber
                value={solver.maxDurationMs ?? 300000}
                onChange={(v) => update({ solver: { ...solver, maxDurationMs: v } })}
                min={10000}
                step={10000}
              />
            </ConfigField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ConfigField label="Max Parallel">
              <ConfigNumber
                value={solver.maxParallel ?? 1}
                onChange={(v) => update({ solver: { ...solver, maxParallel: v } })}
                min={1}
              />
            </ConfigField>
            <ConfigField label="Max Rounds">
              <ConfigNumber
                value={solver.maxRounds ?? 5}
                onChange={(v) => update({ solver: { ...solver, maxRounds: v } })}
                min={1}
              />
            </ConfigField>
          </div>
          <ConfigField label="Max Active Chain Steps">
            <ConfigNumber
              value={solver.maxActiveChainSteps ?? 3}
              onChange={(v) => update({ solver: { ...solver, maxActiveChainSteps: v } })}
              min={0}
            />
          </ConfigField>
        </div>
      </ConfigSection>

      <ConfigSection title="Anti-Loop">
        <div className="space-y-3">
          <ConfigField label="Stale Threshold" description="Detect stalled progress after N identical steps">
            <ConfigNumber
              value={antiLoop.staleThreshold ?? 3}
              onChange={(v) => update({ antiLoop: { ...antiLoop, staleThreshold: v } })}
              min={1}
            />
          </ConfigField>
          <ConfigField label="Max Failed Target" description="Stop after N consecutive failures on same target">
            <ConfigNumber
              value={antiLoop.maxFailedTarget ?? 3}
              onChange={(v) => update({ antiLoop: { ...antiLoop, maxFailedTarget: v } })}
              min={1}
            />
          </ConfigField>
        </div>
      </ConfigSection>

      <ConfigSection title="Reflexion">
        <div className="space-y-3">
          <ConfigToggle
            checked={reflexion.enabled ?? true}
            onChange={(v) => update({ reflexion: { ...reflexion, enabled: v } })}
            label="Enable reflexion"
          />
          <ConfigField label="Max Same Vuln Fails">
            <ConfigNumber
              value={reflexion.maxSameVulnFails ?? 3}
              onChange={(v) => update({ reflexion: { ...reflexion, maxSameVulnFails: v } })}
              min={1}
            />
          </ConfigField>
          <ConfigField label="Max Total No Progress">
            <ConfigNumber
              value={reflexion.maxTotalNoProgress ?? 5}
              onChange={(v) => update({ reflexion: { ...reflexion, maxTotalNoProgress: v } })}
              min={1}
            />
          </ConfigField>
          <ConfigField label="Escalation Max Level">
            <ConfigNumber
              value={reflexion.escalationMaxLevel ?? 4}
              onChange={(v) => update({ reflexion: { ...reflexion, escalationMaxLevel: v } })}
              min={0}
              max={5}
            />
          </ConfigField>
        </div>
      </ConfigSection>

      <ConfigSection title="Verifier">
        <div className="space-y-3">
          <ConfigToggle
            checked={verifier.enabled ?? true}
            onChange={(v) => update({ verifier: { ...verifier, enabled: v } })}
            label="Enable verifier"
          />
          <ConfigField label="Max Per Round">
            <ConfigNumber
              value={verifier.maxPerRound ?? 5}
              onChange={(v) => update({ verifier: { ...verifier, maxPerRound: v } })}
              min={1}
            />
          </ConfigField>
          <ConfigField label="Timeout (ms)">
            <ConfigNumber
              value={verifier.timeoutMs ?? 30000}
              onChange={(v) => update({ verifier: { ...verifier, timeoutMs: v } })}
              min={5000}
              step={5000}
            />
          </ConfigField>
        </div>
      </ConfigSection>

      <ConfigSection title="Interaction">
        <div className="space-y-3">
          <ConfigToggle
            checked={interaction.showReasoning ?? true}
            onChange={(v) => update({ interaction: { ...interaction, showReasoning: v } })}
            label="Show reasoning"
          />
          <ConfigToggle
            checked={interaction.showSystemEvents ?? true}
            onChange={(v) => update({ interaction: { ...interaction, showSystemEvents: v } })}
            label="Show system events"
          />
          <ConfigToggle
            checked={interaction.chat ?? true}
            onChange={(v) => update({ interaction: { ...interaction, chat: v } })}
            label="Chat mode"
          />
        </div>
      </ConfigSection>
    </div>
  )
}
