'use client'

import { useState, useCallback } from 'react'
import { CheckCircle2, Loader2, XCircle, Eye, EyeOff } from 'lucide-react'
import type { ProviderInfo } from './provider-picker'
import { cn } from '@/lib/utils'

export type CredentialValue = Record<string, string>

interface ProviderConfigFormProps {
  provider: ProviderInfo
  value: CredentialValue
  onChange: (field: string, value: string) => void
}

export function ProviderConfigForm({ provider, value, onChange }: ProviderConfigFormProps) {
  const { id } = provider

  if (id === 'azure') return <AzureFields value={value} onChange={onChange} />
  if (id === 'bedrock') return <BedrockFields value={value} onChange={onChange} />
  return <ApiKeyFields provider={provider} value={value} onChange={onChange} />
}

function Field({ label, description, children, required }: { label: string; description?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="text-xs font-medium text-zinc-400 flex items-center gap-1">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>
      {description && <p className="text-[10px] text-zinc-600 mt-0.5">{description}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 text-sm bg-zinc-800/80 border border-zinc-700/80 rounded-lg text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-600/50 focus:border-zinc-600 font-mono transition-colors'
const inputClsPlain = 'w-full px-3 py-2 text-sm bg-zinc-800/80 border border-zinc-700/80 rounded-lg text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-600/50 focus:border-zinc-600 transition-colors'

function PasswordField({ label, value, onChange, envVar, placeholder, required }: { label: string; value: string; onChange: (v: string) => void; envVar?: string; placeholder?: string; required?: boolean }) {
  const [visible, setVisible] = useState(false)
  return (
    <Field label={label} description={envVar ? ('Env: ' + envVar) : undefined} required={required}>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputCls, 'pr-9')}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </Field>
  )
}

function InlineTest({ provider, value }: { provider: ProviderInfo; value: CredentialValue }) {
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [msg, setMsg] = useState('')

  const test = useCallback(async () => {
    if (!value.apiKey || !value.model) {
      setState('fail')
      setMsg('Fill in API key and model first')
      return
    }
    setState('testing')
    setMsg('')
    try {
      const body: Record<string, unknown> = {
        provider: provider.id,
        model: value.model,
        apiKey: value.apiKey,
        baseUrl: value.baseUrl || provider.defaultBaseUrl,
      }
      if (provider.id === 'azure') {
        body.endpoint = value.endpoint
        body.deployment = value.deployment
        body.apiVersion = value.apiVersion
      }
      if (provider.id === 'bedrock') {
        body.authMethod = value.authMethod
        body.region = value.region
        if (value.authMethod === 'iam') {
          body.accessKeyId = value.accessKeyId
          body.secretAccessKey = value.secretAccessKey
          body.sessionToken = value.sessionToken
        }
      }
      const res = await fetch('/api/config/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (result.ok) {
        setState('ok')
        setMsg(result.message || 'Connection successful')
      } else {
        setState('fail')
        setMsg(result.error || 'Connection failed')
      }
    } catch (e) {
      setState('fail')
      setMsg((e as Error).message)
    }
  }, [provider, value])

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={test}
        disabled={state === 'testing' || !value.apiKey}
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium transition-all',
          state === 'ok' ? 'border-emerald-800 bg-emerald-950/50 text-emerald-400' :
          state === 'fail' ? 'border-red-800 bg-red-950/50 text-red-400' :
          'border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {state === 'testing' ? (
          <Loader2 size={12} className="animate-spin" />
        ) : state === 'ok' ? (
          <CheckCircle2 size={12} />
        ) : state === 'fail' ? (
          <XCircle size={12} />
        ) : null}
        {state === 'testing' ? 'Testing…' : state === 'ok' ? 'Connected' : state === 'fail' ? 'Retry' : 'Test connection'}
      </button>
      {msg && state !== 'testing' && (
        <span className={cn('text-[11px] truncate max-w-[200px]', state === 'ok' ? 'text-emerald-500' : 'text-red-400')}>
          {msg}
        </span>
      )}
    </div>
  )
}

function ApiKeyFields({ provider, value, onChange }: { provider: ProviderInfo; value: CredentialValue; onChange: (f: string, v: string) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Model" required>
        <input
          value={value.model ?? ''}
          onChange={(e) => onChange('model', e.target.value)}
          className={inputClsPlain}
          placeholder="e.g. llama3-8b-8192"
        />
      </Field>
      <PasswordField
        label="API Key"
        value={value.apiKey ?? ''}
        onChange={(v) => onChange('apiKey', v)}
        envVar={provider.envVar}
        placeholder="Enter API key"
        required
      />
      <Field label="Base URL" description={provider.defaultBaseUrl ? `Default: ${provider.defaultBaseUrl}` : undefined}>
        <input
          value={value.baseUrl ?? provider.defaultBaseUrl}
          onChange={(e) => onChange('baseUrl', e.target.value)}
          className={inputClsPlain}
          placeholder={provider.defaultBaseUrl || 'https://...'}
        />
      </Field>
      <InlineTest provider={provider} value={value} />
    </div>
  )
}

function AzureFields({ value, onChange }: { value: CredentialValue; onChange: (f: string, v: string) => void }) {
  const provider = { id: 'azure', name: 'Azure', defaultBaseUrl: '', envVar: 'AZURE_API_KEY' } as ProviderInfo
  return (
    <div className="space-y-3">
      <Field label="Model" required>
        <input
          value={value.model ?? ''}
          onChange={(e) => onChange('model', e.target.value)}
          className={inputClsPlain}
          placeholder="e.g. gpt-4o"
        />
      </Field>
      <PasswordField
        label="API Key"
        value={value.apiKey ?? ''}
        onChange={(v) => onChange('apiKey', v)}
        envVar="AZURE_API_KEY"
        placeholder="Enter API key"
        required
      />
      <Field label="Endpoint" description="https://your-resource.openai.azure.com" required>
        <input
          value={value.endpoint ?? ''}
          onChange={(e) => onChange('endpoint', e.target.value)}
          className={inputClsPlain}
          placeholder="https://your-resource.openai.azure.com"
        />
      </Field>
      <Field label="Deployment" required>
        <input
          value={value.deployment ?? ''}
          onChange={(e) => onChange('deployment', e.target.value)}
          className={inputClsPlain}
          placeholder="e.g. gpt-4o-deployment"
        />
      </Field>
      <Field label="API Version">
        <input
          value={value.apiVersion ?? '2024-10-21'}
          onChange={(e) => onChange('apiVersion', e.target.value)}
          className={inputClsPlain}
        />
      </Field>
      <InlineTest provider={provider} value={value} />
    </div>
  )
}

function BedrockFields({ value, onChange }: { value: CredentialValue; onChange: (f: string, v: string) => void }) {
  const authMethod = value.authMethod ?? 'iam'
  const provider = { id: 'bedrock', name: 'Bedrock', defaultBaseUrl: '', envVar: '' } as ProviderInfo
  return (
    <div className="space-y-3">
      <Field label="Model" required>
        <input
          value={value.model ?? ''}
          onChange={(e) => onChange('model', e.target.value)}
          className={inputClsPlain}
          placeholder="e.g. anthropic.claude-3-sonnet-20240222-v1:0"
        />
      </Field>
      <Field label="Auth Method">
        <div className="flex gap-2">
          {(['iam', 'api_key'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange('authMethod', m)}
              className={cn(
                'flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-all',
                authMethod === m
                  ? 'border-zinc-600 bg-zinc-800 text-zinc-200'
                  : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:border-zinc-700',
              )}
            >
              {m === 'iam' ? 'IAM (Access Key)' : 'API Key'}
            </button>
          ))}
        </div>
      </Field>
      {authMethod === 'iam' ? (
        <>
          <Field label="Access Key ID" description="Env: AWS_ACCESS_KEY_ID" required>
            <input
              value={value.accessKeyId ?? ''}
              onChange={(e) => onChange('accessKeyId', e.target.value)}
              className={inputCls}
              placeholder="AKIA..."
            />
          </Field>
          <PasswordField
            label="Secret Access Key"
            value={value.secretAccessKey ?? ''}
            onChange={(v) => onChange('secretAccessKey', v)}
            placeholder="Enter secret key"
            required
          />
          <PasswordField
            label="Session Token"
            value={value.sessionToken ?? ''}
            onChange={(v) => onChange('sessionToken', v)}
            placeholder="Optional — for temporary credentials"
          />
          <Field label="Region" required>
            <input
              value={value.region ?? ''}
              onChange={(e) => onChange('region', e.target.value)}
              className={inputClsPlain}
              placeholder="us-east-1"
            />
          </Field>
        </>
      ) : (
        <>
          <PasswordField
            label="API Key"
            value={value.apiKey ?? ''}
            onChange={(v) => onChange('apiKey', v)}
            placeholder="Enter API key"
            required
          />
          <Field label="Region" required>
            <input
              value={value.region ?? ''}
              onChange={(e) => onChange('region', e.target.value)}
              className={inputClsPlain}
              placeholder="us-east-1"
            />
          </Field>
        </>
      )}
      <InlineTest provider={provider} value={value} />
    </div>
  )
}
