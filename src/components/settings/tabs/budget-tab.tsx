'use client'

import { useConfigStore } from '@/stores/config-store'
import { ConfigField } from '../config-field'
import { ConfigSelect } from '../config-select'
import { ConfigToggle } from '../config-toggle'
import { ConfigNumber } from '../config-number'
import { ConfigSection } from '../config-section'

export function BudgetTab() {
  const config = useConfigStore((s) => s.config)
  const update = useConfigStore((s) => s.update)

  if (!config) return null

  const bp = config.budgetPolicy || { enforcement: 'soft', scope: 'session', resetOn: 'never', allocation: { brain: 0.3, workers: 0.6, spider: 0.1 }, maxModelCallsPerTask: 15, trackTokens: false }
  const rl = config.rateLimit || { requestsPerMinute: 15, maxConcurrent: 2, retryOnLimit: true, maxRetries: 3, backoffStrategy: 'stepped', baseBackoffMs: 2000, maxBackoffMs: 30000, useHeaders: true }

  const updateAllocation = (field: string, value: number) => {
    update({ budgetPolicy: { ...bp, allocation: { ...bp.allocation, [field]: value } } })
  }

  return (
    <div className="space-y-6">
      <ConfigSection title="Budget Policy" defaultOpen={true}>
        <div className="space-y-3">
          <ConfigField label="Enforcement">
            <ConfigSelect
              value={bp.enforcement || 'soft'}
              onChange={(v) => update({ budgetPolicy: { ...bp, enforcement: v as any } })}
              options={[
                { value: 'soft', label: 'Soft (log + continue)' },
                { value: 'hard', label: 'Hard (stop at limit)' },
                { value: 'warn', label: 'Warn (visual only)' },
              ]}
            />
          </ConfigField>

          <ConfigField label="Scope">
            <ConfigSelect
              value={bp.scope || 'session'}
              onChange={(v) => update({ budgetPolicy: { ...bp, scope: v as any } })}
              options={[
                { value: 'session', label: 'Per session' },
                { value: 'turn', label: 'Per turn' },
              ]}
            />
          </ConfigField>

          <ConfigField label="Reset On">
            <ConfigSelect
              value={bp.resetOn || 'never'}
              onChange={(v) => update({ budgetPolicy: { ...bp, resetOn: v as any } })}
              options={[
                { value: 'never', label: 'Never' },
                { value: 'turn', label: 'Each turn' },
              ]}
            />
          </ConfigField>

          <div>
            <div className="text-xs text-zinc-400 mb-2">Allocation</div>
            <div className="grid grid-cols-3 gap-3">
              <ConfigField label={`Brain (${Math.round((bp.allocation?.brain ?? 0.3) * 100)}%)`}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={bp.allocation?.brain ?? 0.3}
                  onChange={(e) => updateAllocation('brain', Number(e.target.value))}
                  className="w-full"
                />
              </ConfigField>
              <ConfigField label={`Workers (${Math.round((bp.allocation?.workers ?? 0.6) * 100)}%)`}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={bp.allocation?.workers ?? 0.6}
                  onChange={(e) => updateAllocation('workers', Number(e.target.value))}
                  className="w-full"
                />
              </ConfigField>
              <ConfigField label={`Spider (${Math.round((bp.allocation?.spider ?? 0.1) * 100)}%)`}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={bp.allocation?.spider ?? 0.1}
                  onChange={(e) => updateAllocation('spider', Number(e.target.value))}
                  className="w-full"
                />
              </ConfigField>
            </div>
          </div>

          <ConfigField label="Max Model Calls Per Task">
            <ConfigNumber
              value={bp.maxModelCallsPerTask ?? 15}
              onChange={(v) => update({ budgetPolicy: { ...bp, maxModelCallsPerTask: v } })}
              min={1}
            />
          </ConfigField>

          {bp.maxTokensPerSession !== undefined && (
            <ConfigField label="Max Tokens Per Session">
              <ConfigNumber
                value={bp.maxTokensPerSession}
                onChange={(v) => update({ budgetPolicy: { ...bp, maxTokensPerSession: v } })}
                min={1000}
              />
            </ConfigField>
          )}

          <ConfigToggle
            checked={bp.trackTokens ?? false}
            onChange={(v) => update({ budgetPolicy: { ...bp, trackTokens: v } })}
            label="Track tokens"
          />
        </div>
      </ConfigSection>

      <ConfigSection title="Rate Limiting">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <ConfigField label="Requests/Minute">
              <ConfigNumber
                value={rl.requestsPerMinute ?? 15}
                onChange={(v) => update({ rateLimit: { ...rl, requestsPerMinute: v } })}
                min={1}
              />
            </ConfigField>
            <ConfigField label="Max Concurrent">
              <ConfigNumber
                value={rl.maxConcurrent ?? 2}
                onChange={(v) => update({ rateLimit: { ...rl, maxConcurrent: v } })}
                min={1}
              />
            </ConfigField>
          </div>

          <ConfigToggle
            checked={rl.retryOnLimit ?? true}
            onChange={(v) => update({ rateLimit: { ...rl, retryOnLimit: v } })}
            label="Retry on rate limit"
          />

          <ConfigField label="Max Retries">
            <ConfigNumber
              value={rl.maxRetries ?? 3}
              onChange={(v) => update({ rateLimit: { ...rl, maxRetries: v } })}
              min={0}
            />
          </ConfigField>

          <ConfigField label="Backoff Strategy">
            <ConfigSelect
              value={rl.backoffStrategy || 'stepped'}
              onChange={(v) => update({ rateLimit: { ...rl, backoffStrategy: v as any } })}
              options={[
                { value: 'stepped', label: 'Stepped' },
                { value: 'exponential', label: 'Exponential' },
                { value: 'fixed', label: 'Fixed' },
              ]}
            />
          </ConfigField>

          <div className="grid grid-cols-2 gap-4">
            <ConfigField label="Base Backoff (ms)">
              <ConfigNumber
                value={rl.baseBackoffMs ?? 2000}
                onChange={(v) => update({ rateLimit: { ...rl, baseBackoffMs: v } })}
                min={100}
                step={100}
              />
            </ConfigField>
            <ConfigField label="Max Backoff (ms)">
              <ConfigNumber
                value={rl.maxBackoffMs ?? 30000}
                onChange={(v) => update({ rateLimit: { ...rl, maxBackoffMs: v } })}
                min={1000}
                step={1000}
              />
            </ConfigField>
          </div>

          <ConfigToggle
            checked={rl.useHeaders ?? true}
            onChange={(v) => update({ rateLimit: { ...rl, useHeaders: v } })}
            label="Use rate-limit headers"
          />
        </div>
      </ConfigSection>
    </div>
  )
}
