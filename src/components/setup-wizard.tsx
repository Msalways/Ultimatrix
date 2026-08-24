'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react'
import { useResourceStore } from '@/stores/resource-store'
import { useConfigStore } from '@/stores/config-store'
import { cn } from '@/lib/utils'
import { ProviderConfigForm, type CredentialValue } from './provider-config-form'
import { ProviderPicker, getDefaultModel, type ProviderInfo } from './provider-picker'

type Step = 'provider' | 'credentials' | 'capability' | 'tiers' | 'testing' | 'done'

const STEPS: Step[] = ['provider', 'credentials', 'capability', 'tiers', 'testing', 'done']

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const markResource = useResourceStore((s) => s.mark)
  const loadConfig = useConfigStore((s) => s.load)
  const [step, setStep] = useState<Step>('provider')
  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  const [creds, setCreds] = useState<CredentialValue>({})
  const [contextWindow, setContextWindow] = useState(8192)
  const [maxOutputTokens, setMaxOutputTokens] = useState(2048)
  const [tierModels, setTierModels] = useState({ fast: '', balanced: '', powerful: '' })
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50)
    return () => clearTimeout(t)
  }, [])

  const handleProviderSelect = useCallback((p: ProviderInfo) => {
    const model = getDefaultModel(p.id)
    setProvider(p)
    setCreds({ model, baseUrl: p.defaultBaseUrl })
    setTierModels({ fast: model, balanced: model, powerful: model })
    setStep('credentials')
  }, [])

  const handleSubmit = useCallback(async () => {
    const hasAuth = provider?.id === 'bedrock' && creds.authMethod !== 'api_key'
      ? Boolean(creds.accessKeyId && creds.secretAccessKey && creds.region)
      : Boolean(creds.apiKey)
    if (!provider || !creds.model || !hasAuth) {
      setError('Provider, model, and credentials are required')
      return
    }

    setStep('testing')
    setTesting(true)
    setError(null)

    try {
      const modelId = `${provider.id}/${creds.model}`
      const body: Record<string, unknown> = {
        provider: provider.id,
        model: creds.model,
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl || provider.defaultBaseUrl,
        engine: 'multi-model',
        modelCapabilities: {
          [modelId]: {
            contextWindow,
            maxOutputTokens,
            strengths: [],
            supportsStreaming: true,
            supportsStructuredOutput: false,
          },
        },
        modelTiers: {
          fast: { provider: provider.id, model: tierModels.fast || creds.model },
          balanced: { provider: provider.id, model: tierModels.balanced || creds.model },
          powerful: { provider: provider.id, model: tierModels.powerful || creds.model },
        },
        modelRoleTiers: {
          brain: 'balanced',
          spider: 'fast',
          crawlSummarizer: 'fast',
          verifier: 'balanced',
          reporter: 'balanced',
          council: 'powerful',
        },
      }

      if (provider.id === 'azure') {
        body.endpoint = creds.endpoint
        body.deployment = creds.deployment
        body.apiVersion = creds.apiVersion || '2024-10-21'
      }
      if (provider.id === 'bedrock') {
        body.authMethod = creds.authMethod || 'iam'
        body.region = creds.region
        if (creds.authMethod === 'iam') {
          body.accessKeyId = creds.accessKeyId
          body.secretAccessKey = creds.secretAccessKey
          body.sessionToken = creds.sessionToken
        } else {
          body.apiKey = creds.apiKey
        }
      }

      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (!result.ok) {
        setError(result.errors?.join('\n') || 'Setup failed')
        setStep('credentials')
        return
      }

      markResource('config', 'ready')
      await loadConfig()
      setStep('done')
      setTimeout(onComplete, 800)
    } catch (e) {
      setError((e as Error).message)
      setStep('credentials')
    } finally {
      setTesting(false)
    }
  }, [provider, creds, contextWindow, maxOutputTokens, tierModels, markResource, loadConfig, onComplete])

  const canContinueCredentials = provider?.id === 'bedrock' && creds.authMethod !== 'api_key'
    ? Boolean(creds.model && creds.accessKeyId && creds.secretAccessKey && creds.region)
    : Boolean(creds.model && creds.apiKey)

  return (
    <div className={cn('fixed inset-0 z-50 flex items-center justify-center bg-zinc-950 transition-all duration-500', mounted ? 'opacity-100' : 'opacity-0')}>
      <div className="flex h-full w-full max-w-lg flex-col">
        <div className="flex-shrink-0 px-6 pb-4 pt-8">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-sm font-bold text-zinc-300">U</div>
            <div>
              <h1 className="text-base font-semibold text-zinc-100">Welcome to Ultimatrix</h1>
              <p className="text-[11px] text-zinc-500">Configure provider, model limits, and tiers</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
              <AlertCircle size={14} className="shrink-0" />
              <span className="whitespace-pre-wrap">{error}</span>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => {
              const isCurrent = step === s
              const isDone = STEPS.indexOf(step) > i
              return (
                <div key={s} className="flex flex-1 items-center gap-1.5">
                  <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium transition-colors', isCurrent ? 'bg-zinc-700 text-zinc-100 ring-2 ring-zinc-600' : isDone ? 'bg-emerald-900/60 text-emerald-400' : 'bg-zinc-800 text-zinc-600')}>
                    {isDone ? <CheckCircle2 size={12} /> : i + 1}
                  </div>
                  <div className={cn('h-px flex-1 transition-colors', isDone ? 'bg-emerald-900/40' : 'bg-zinc-800')} />
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {step === 'provider' && (
            <div className="space-y-3">
              <label className="text-xs font-medium text-zinc-400">Choose a provider</label>
              <ProviderPicker onSelect={handleProviderSelect} />
            </div>
          )}

          {step === 'credentials' && provider && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <button onClick={() => setStep('provider')} className="hover:text-zinc-200"><ArrowLeft size={14} /></button>
                <span>Credentials for <strong className="text-zinc-200">{provider.name}</strong></span>
              </div>
              <ProviderConfigForm provider={provider} value={creds} onChange={(field, value) => setCreds((c) => ({ ...c, [field]: value }))} />
              <button onClick={() => setStep('capability')} disabled={!canContinueCredentials} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-800 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40">
                Continue <ArrowRight size={14} />
              </button>
            </div>
          )}

          {step === 'capability' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <button onClick={() => setStep('credentials')} className="hover:text-zinc-200"><ArrowLeft size={14} /></button>
                <span>Model limits for <strong className="text-zinc-200">{creds.model}</strong></span>
              </div>
              <NumberField label="Context window" value={contextWindow} onChange={setContextWindow} />
              <NumberField label="Max output tokens" value={maxOutputTokens} onChange={setMaxOutputTokens} />
              <button onClick={() => setStep('tiers')} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-800 text-xs font-medium text-zinc-200 hover:bg-zinc-700">
                Continue <ArrowRight size={14} />
              </button>
            </div>
          )}

          {step === 'tiers' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <button onClick={() => setStep('capability')} className="hover:text-zinc-200"><ArrowLeft size={14} /></button>
                <span>Assign model tiers</span>
              </div>
              {(['fast', 'balanced', 'powerful'] as const).map((tier) => (
                <TextField key={tier} label={tier} value={tierModels[tier]} onChange={(value) => setTierModels((m) => ({ ...m, [tier]: value }))} />
              ))}
              <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3 text-[11px] text-zinc-500">
                Defaults: brain uses balanced, spider uses fast, council uses powerful. Workers derive from tiers internally.
              </div>
              <button onClick={handleSubmit} disabled={testing} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
                {testing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {testing ? 'Testing connection...' : 'Create configuration'}
              </button>
            </div>
          )}

          {(step === 'testing' || step === 'done') && (
            <div className="flex flex-col items-center gap-4 py-12">
              <div className={cn('flex h-12 w-12 items-center justify-center rounded-full', step === 'done' ? 'bg-emerald-900/50' : 'bg-zinc-800')}>
                {step === 'done' ? <CheckCircle2 size={24} className="text-emerald-400" /> : <Loader2 size={24} className="animate-spin text-zinc-400" />}
              </div>
              <div className="space-y-1 text-center">
                <div className="text-sm font-medium text-zinc-200">{step === 'done' ? 'Configuration created' : 'Testing connection...'}</div>
                <div className="text-xs text-zinc-500">{step === 'done' ? 'Redirecting to workspace...' : 'Verifying credentials and saving'}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-1 text-xs text-zinc-400">
      <span>{label}</span>
      <input type="number" min={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200" />
    </label>
  )
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1 text-xs text-zinc-400">
      <span className="capitalize">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200" />
    </label>
  )
}
