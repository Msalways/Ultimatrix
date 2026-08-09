'use client'

import { useState, useCallback, useEffect } from 'react'
import { Loader2, CheckCircle2, AlertCircle, ArrowRight, ArrowLeft } from 'lucide-react'
import { useResourceStore } from '@/stores/resource-store'
import { useConfigStore } from '@/stores/config-store'
import { cn } from '@/lib/utils'
import { ProviderPicker, getDefaultModel, type ProviderInfo } from './provider-picker'
import { ProviderConfigForm, type CredentialValue } from './provider-config-form'

type Step = 'provider' | 'credentials' | 'engine' | 'testing' | 'done'

const ENGINES = [
  { id: 'solver', label: 'Solver', desc: 'OODA loop — best for most targets' },
  { id: 'multi-model', label: 'Multi-Model', desc: 'Model-aware delegation across tiers' },
  { id: 'legacy', label: 'Legacy', desc: 'Supervisor + 4 worker agents' },
] as const

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const markResource = useResourceStore((s) => s.mark)
  const loadConfig = useConfigStore((s) => s.load)
  const [step, setStep] = useState<Step>('provider')
  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  const [creds, setCreds] = useState<CredentialValue>({})
  const [engine, setEngine] = useState('solver')
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50)
    return () => clearTimeout(t)
  }, [])

  const handleProviderSelect = useCallback((p: ProviderInfo) => {
    setProvider(p)
    const model = getDefaultModel(p.id)
    setCreds({ model, baseUrl: p.defaultBaseUrl })
    setStep('credentials')
  }, [])

  const handleCredChange = useCallback((field: string, value: string) => {
    setCreds((c) => ({ ...c, [field]: value }))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!provider || !creds.model || !creds.apiKey) {
      setError('All fields are required')
      return
    }

    setStep('testing')
    setTesting(true)
    setError(null)

    try {
      const body: Record<string, unknown> = {
        provider: provider.id,
        model: creds.model,
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl || provider.defaultBaseUrl,
        engine,
      }

      if (provider.id === 'azure') {
        body.endpoint = creds.endpoint
        body.deployment = creds.deployment
        body.apiVersion = creds.apiVersion || '2024-10-21'
      }
      if (provider.id === 'bedrock') {
        body.authMethod = creds.authMethod || 'iam'
        if (creds.authMethod === 'iam') {
          body.accessKeyId = creds.accessKeyId
          body.secretAccessKey = creds.secretAccessKey
          body.sessionToken = creds.sessionToken
          body.region = creds.region
        } else {
          body.apiKey = creds.apiKey
          body.region = creds.region
        }
      }

      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await res.json()

      if (result.ok) {
        markResource('config', 'ready')
        await loadConfig()
        setStep('done')
        setTimeout(onComplete, 800)
      } else {
        setError(result.errors?.join('\n') || 'Setup failed')
        setStep('credentials')
      }
    } catch (e) {
      setError((e as Error).message)
      setStep('credentials')
    } finally {
      setTesting(false)
    }
  }, [provider, creds, engine, markResource, loadConfig, onComplete])

  return (
    <div className={cn(
      'fixed inset-0 z-50 flex items-center justify-center bg-zinc-950 transition-all duration-500',
      mounted ? 'opacity-100' : 'opacity-0',
    )}>
      <div className="flex flex-col h-full w-full max-w-lg">
        {/* Sticky header */}
        <div className="flex-shrink-0 px-6 pt-8 pb-4">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-9 w-9 rounded-lg bg-zinc-800 flex items-center justify-center">
              <span className="text-sm font-bold text-zinc-300">U</span>
            </div>
            <div>
              <h1 className="text-base font-semibold text-zinc-100">Welcome to Ultimatrix</h1>
              <p className="text-[11px] text-zinc-500">Set up your first provider to get started</p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400 mb-4">
              <AlertCircle size={14} className="shrink-0" />
              <span className="whitespace-pre-wrap">{error}</span>
            </div>
          )}

          {/* Step indicators */}
          <div className="flex items-center gap-1.5">
            {(['provider', 'credentials', 'engine', 'testing', 'done'] as Step[]).map((s, i) => {
              const isCurrent = step === s
              const isDone = (['provider', 'credentials', 'engine', 'testing', 'done'].indexOf(step) > i)
              return (
                <div key={s} className="flex items-center gap-1.5 flex-1">
                  <div className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium transition-colors',
                    isCurrent ? 'bg-zinc-700 text-zinc-100 ring-2 ring-zinc-600' :
                    isDone ? 'bg-emerald-900/60 text-emerald-400' :
                    'bg-zinc-800 text-zinc-600',
                  )}>
                    {isDone ? <CheckCircle2 size={12} /> : i + 1}
                  </div>
                  <div className={cn(
                    'h-px flex-1 transition-colors',
                    isDone ? 'bg-emerald-900/40' : 'bg-zinc-800',
                  )} />
                </div>
              )
            })}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 pb-8">
          <div className="min-h-[300px]">
            {step === 'provider' && (
              <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <label className="text-xs font-medium text-zinc-400">Choose a provider</label>
                <ProviderPicker onSelect={handleProviderSelect} />
              </div>
            )}

            {step === 'credentials' && provider && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <button onClick={() => setStep('provider')} className="hover:text-zinc-200 transition-colors">
                    <ArrowLeft size={14} />
                  </button>
                  <span>Setting up <strong className="text-zinc-200">{provider.name}</strong></span>
                </div>

                <ProviderConfigForm provider={provider} value={creds} onChange={handleCredChange} />

                <button
                  onClick={() => setStep('engine')}
                  disabled={!creds.apiKey}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-800 text-xs font-medium text-zinc-200 transition-all hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Continue
                  <ArrowRight size={14} />
                </button>
              </div>
            )}

            {step === 'engine' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-400">Engine</label>
                  <div className="space-y-2">
                    {ENGINES.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => setEngine(e.id)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-md border px-3 py-3 text-left text-xs transition-all',
                          engine === e.id
                            ? 'border-zinc-600 bg-zinc-800/80 text-zinc-100 ring-1 ring-zinc-700'
                            : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900',
                        )}
                      >
                        <div className="space-y-0.5">
                          <div className="font-medium text-zinc-200">{e.label}</div>
                          <div className="text-[10px] text-zinc-500">{e.desc}</div>
                        </div>
                        {e.id === 'solver' && (
                          <span className="text-[10px] text-emerald-500 bg-emerald-950/50 px-1.5 py-0.5 rounded">recommended</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={testing}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 text-xs font-medium text-white transition-all hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {testing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {testing ? 'Testing connection…' : 'Create configuration'}
                </button>
              </div>
            )}

            {(step === 'testing' || step === 'done') && (
              <div className="flex flex-col items-center gap-4 py-12 animate-in fade-in duration-300">
                <div className={cn(
                  'h-12 w-12 rounded-full flex items-center justify-center',
                  step === 'done' ? 'bg-emerald-900/50' : 'bg-zinc-800',
                )}>
                  {step === 'done' ? (
                    <CheckCircle2 size={24} className="text-emerald-400" />
                  ) : (
                    <Loader2 size={24} className="animate-spin text-zinc-400" />
                  )}
                </div>
                <div className="text-center space-y-1">
                  <div className="text-sm font-medium text-zinc-200">
                    {step === 'done' ? 'Configuration created!' : 'Testing connection…'}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {step === 'done' ? 'Redirecting to workspace…' : 'Verifying credentials and saving'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
