'use client'

import { useState, useEffect } from 'react'
import type { ProviderCredentials } from '@/config'
import { PROVIDER_INFO } from '@/config'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Separator } from './ui/separator'
import { Combobox, ComboboxOption } from './ui/combobox'
import { Save, RotateCcw, Key, Shield, Settings2, Globe, Server } from 'lucide-react'

const PROVIDERS: ComboboxOption[] = Object.values(PROVIDER_INFO).map(p => ({
  value: p.id,
  label: p.name,
}))

export function SettingsPanel() {
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('gpt-4o')
  const [creds, setCreds] = useState<ProviderCredentials>({})
  const [target, setTarget] = useState('')
  const [headless, setHeadless] = useState(true)
  const [loadedTarget, setLoadedTarget] = useState('')
  const [timeout, setTimeout_] = useState(60000)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(cfg => {
        if (cfg.provider) setProvider(cfg.provider)
        if (cfg.model) setModel(cfg.model)
        if (cfg.creds) setCreds(cfg.creds)
        if (cfg.target) { setTarget(cfg.target); setLoadedTarget(cfg.target) }
        if (cfg.browser?.headless !== undefined) setHeadless(cfg.browser.headless)
        if (cfg.timeout) setTimeout_(cfg.timeout)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const active = (creds as Record<string, any>)[provider]
    if (!active || (!active.baseUrl && active.baseUrl !== '')) {
      const info = PROVIDER_INFO[provider]
      if (info?.defaultBaseUrl) {
        setCreds(prev => ({
          ...prev,
          [provider]: { ...(prev as Record<string, any>)[provider], baseUrl: info.defaultBaseUrl },
        }))
      }
    }
  }, [provider])

  function updateCred(
    p: string,
    field: string,
    value: any,
  ) {
    setCreds(prev => ({
      ...prev,
      [p]: { ...(prev as Record<string, any>)[p] as any, [field]: value },
    }))
  }

  const activeCreds = (creds as Record<string, any>)[provider] || {}

  const activeApiKeyCreds = provider !== 'azure' && provider !== 'bedrock' && provider !== 'custom'

  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (confirming) {
      const timer = setTimeout(() => setConfirming(false), 5000)
      return () => clearTimeout(timer)
    }
  }, [confirming])

  const handleSave = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    setSaving(true)
    try {
      const body: Record<string, any> = {
        provider,
        model,
        creds,
        target,
        timeout,
        browser: { headless },
      }

      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch { /* ignore */ }
    setSaving(false)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="space-y-6 max-w-lg mx-auto">
        <div>
          <h2 className="text-lg font-semibold">Settings</h2>
          <p className="text-sm text-muted-foreground">Configure the LLM provider and agent behavior.</p>
        </div>

        <Separator />

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>LLM Provider</Label>
            <Combobox
              options={PROVIDERS}
              value={provider}
              onValueChange={setProvider}
              placeholder="Select provider..."
              searchPlaceholder="Search providers..."
            />
          </div>

          <div className="space-y-2">
            <Label>Model</Label>
            <Input value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. gpt-4o, claude-sonnet-4-20250514" />
          </div>

          <Separator className="my-1" />

          {/* Standard ApiKeyCreds providers */}
          {activeApiKeyCreds && (
            <>
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Key size={14} />
                <span>Credentials</span>
              </div>
              <div className="space-y-2">
                <Label>Base URL</Label>
                <div className="flex gap-2">
                  <Globe size={14} className="mt-2.5 shrink-0 text-muted-foreground" />
                  <Input
                    value={activeCreds.baseUrl || ''}
                    onChange={e => updateCred(provider, 'baseUrl', e.target.value)}
                    placeholder={PROVIDER_INFO[provider]?.defaultBaseUrl || 'https://...'}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={activeCreds.apiKey || ''}
                    onChange={e => updateCred(provider, 'apiKey', e.target.value)}
                  placeholder={`Set via ${PROVIDER_INFO[provider]?.envVar || 'API_KEY'} or enter here`}
                />
              </div>
            </>
          )}

          {/* Azure */}
          {provider === 'azure' && (
            <>
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Settings2 size={14} />
                <span>Azure OpenAI Credentials</span>
              </div>
              <div className="space-y-2">
                <Label>Endpoint URL</Label>
                <Input
                  value={activeCreds.endpoint || ''}
                  onChange={e => updateCred('azure', 'endpoint', e.target.value)}
                  placeholder="https://your-resource.openai.azure.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Deployment Name</Label>
                <Input
                  value={activeCreds.deployment || ''}
                  onChange={e => updateCred('azure', 'deployment', e.target.value)}
                  placeholder="e.g. gpt-4o-deployment"
                />
              </div>
              <div className="space-y-2">
                <Label>API Version</Label>
                <Input
                  value={activeCreds.apiVersion || '2024-10-21'}
                  onChange={e => updateCred('azure', 'apiVersion', e.target.value)}
                  placeholder="2024-10-21"
                />
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={activeCreds.apiKey || ''}
                  onChange={e => updateCred('azure', 'apiKey', e.target.value)}
                  placeholder="Azure API key"
                />
              </div>
            </>
          )}

          {/* Bedrock */}
          {provider === 'bedrock' && (
            <>
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Shield size={14} />
                <span>AWS Bedrock Credentials</span>
              </div>
              <div className="space-y-3">
                <Label>Auth Method</Label>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateCred('bedrock', 'authMethod', 'iam')}
                    className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
                      activeCreds.authMethod === 'iam'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-muted-foreground border-border hover:bg-accent'
                    }`}
                  >
                    IAM Credentials
                  </button>
                  <button
                    onClick={() => updateCred('bedrock', 'authMethod', 'api_key')}
                    className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
                      activeCreds.authMethod === 'api_key'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-muted-foreground border-border hover:bg-accent'
                    }`}
                  >
                    API Key
                  </button>
                </div>
              </div>

              {(activeCreds.authMethod || 'iam') === 'iam' ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>AWS Access Key ID</Label>
                    <Input
                      value={activeCreds.accessKeyId || ''}
                      onChange={e => updateCred('bedrock', 'accessKeyId', e.target.value)}
                      placeholder="AKIA..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>AWS Secret Access Key</Label>
                    <Input
                      type="password"
                      value={activeCreds.secretAccessKey || ''}
                      onChange={e => updateCred('bedrock', 'secretAccessKey', e.target.value)}
                      placeholder="wJalrXUt..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>AWS Session Token <span className="text-muted-foreground">(optional)</span></Label>
                    <Input
                      type="password"
                      value={activeCreds.sessionToken || ''}
                      onChange={e => updateCred('bedrock', 'sessionToken', e.target.value)}
                      placeholder="For temporary credentials"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>AWS Region</Label>
                    <Input
                      value={activeCreds.region || ''}
                      onChange={e => updateCred('bedrock', 'region', e.target.value)}
                      placeholder="us-east-1"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>AWS Bedrock API Key</Label>
                  <Input
                    type="password"
                    value={activeCreds.apiKey || ''}
                    onChange={e => updateCred('bedrock', 'apiKey', e.target.value)}
                    placeholder="Bearer token for Bedrock"
                  />
                </div>
              )}
            </>
          )}

          {/* Custom */}
          {provider === 'custom' && (
            <>
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Server size={14} />
                <span>Custom Endpoint</span>
              </div>
              <div className="space-y-2">
                <Label>Base URL <span className="text-destructive">*</span></Label>
                <Input
                  value={activeCreds.baseUrl || ''}
                  onChange={e => updateCred('custom', 'baseUrl', e.target.value)}
                  placeholder="https://your-api.example.com/v1"
                />
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={activeCreds.apiKey || ''}
                  onChange={e => updateCred('custom', 'apiKey', e.target.value)}
                  placeholder="API key for custom endpoint"
                />
              </div>
            </>
          )}

          <Separator className="my-1" />

          {loadedTarget && (
            <div className="space-y-2">
              <Label>Current Target</Label>
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-md px-3 py-2">
                <Globe size={14} />
                <span className="truncate">{loadedTarget}</span>
              </div>
              <p className="text-[11px] text-muted-foreground/60">Change the target URL from the chat header.</p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Timeout (ms)</Label>
            <Input type="number" value={timeout} onChange={e => setTimeout_(Number(e.target.value))} />
          </div>

          <div className="flex items-center justify-between">
            <Label>Headless Browser</Label>
            <button
              onClick={() => setHeadless(!headless)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${headless ? 'bg-primary' : 'bg-input'}`}
            >
              <span className={`inline-block h-5 w-5 rounded-full bg-background transition-transform ${headless ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>

        <Separator />

        <Button onClick={handleSave} disabled={saving} variant={confirming ? 'destructive' : 'default'} className="w-full">
          {saving ? <RotateCcw size={16} className="animate-spin mr-2" /> : confirming ? <RotateCcw size={16} className="mr-2" /> : <Save size={16} className="mr-2" />}
          {confirming ? 'Click again to confirm' : 'Save & Re-initialize'}
        </Button>
      </div>
    </div>
  )
}
