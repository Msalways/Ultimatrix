'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, Save, Check, Settings, Key, Layers, Shield, Plug, Wrench } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { useConfigStore } from '@/stores/config-store'
import { RestartBanner } from './settings/restart-banner'
import { GeneralTab } from './settings/tabs/general-tab'
import { ProvidersTab } from './settings/tabs/providers-tab'
import { ModelTiersTab } from './settings/tabs/model-tiers-tab'
import { ScopeSafetyTab } from './settings/tabs/scope-safety-tab'
import { SetupHealthTab } from './settings/tabs/setup-health-tab'
import { ConnectorsTab } from './settings/tabs/connectors-tab'
import { AdvancedWorkspaceTab } from './settings/tabs/advanced-workspace-tab'
import { cn } from '@/lib/utils'

const TABS = [
  { id: 'health', label: 'Setup Health', icon: Settings },
  { id: 'providers', label: 'Providers', icon: Key },
  { id: 'tiers', label: 'Models & Routing', icon: Layers },
  { id: 'scope', label: 'Safety', icon: Shield },
  { id: 'connectors', label: 'Connectors', icon: Plug },
  { id: 'advanced', label: 'Advanced', icon: Wrench },
] as const

type TabId = typeof TABS[number]['id']

export function SettingsModal() {
  const open = useUIStore((s) => s.settingsOpen)
  const close = useUIStore((s) => s.closeSettings)
  const loadConfig = useConfigStore((s) => s.load)
  const saveConfig = useConfigStore((s) => s.save)
  const resetConfig = useConfigStore((s) => s.reset)
  const config = useConfigStore((s) => s.config)
  const dirty = useConfigStore((s) => s.dirty)
  const saving = useConfigStore((s) => s.saving)
  const saved = useConfigStore((s) => s.saved)
  const error = useConfigStore((s) => s.error)
  const needsRestart = useConfigStore((s) => s.needsRestart)

  const [activeTab, setActiveTab] = useState<TabId>('health')
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  useEffect(() => {
    if (open) {
      loadConfig()
      setActiveTab('health')
    }
  }, [open, loadConfig])

  const handleClose = useCallback(() => {
    if (dirty) {
      setShowCloseConfirm(true)
    } else {
      close()
    }
  }, [dirty, close])

  const handleConfirmClose = useCallback((discard: boolean) => {
    setShowCloseConfirm(false)
    if (discard) {
      resetConfig()
      close()
    }
  }, [resetConfig, close])

  const handleSave = useCallback(async () => {
    const result = await saveConfig()
    if (result.ok) {
      setTimeout(() => close(), 400)
    }
  }, [saveConfig, close])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) handleClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && open && dirty) {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, dirty, handleClose, handleSave])

  if (!open) return null

  const renderTab = () => {
    switch (activeTab) {
      case 'health': return <SetupHealthTab />
      case 'providers': return <ProvidersTab />
      case 'tiers': return <ModelTiersTab />
      case 'scope': return <ScopeSafetyTab />
      case 'connectors': return <ConnectorsTab />
      case 'advanced': return <AdvancedWorkspaceTab />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onClick={handleClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex h-12 items-center justify-between border-b border-zinc-800 px-4 sm:px-5">
          <span className="text-sm font-medium text-zinc-200">Settings</span>
          <div className="flex items-center gap-3">
            {dirty && (
              <span className="text-xs text-amber-400/70">Unsaved changes</span>
            )}
            <button
              onClick={handleClose}
              aria-label="Close settings"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[170px_minmax(0,1fr)_230px]">
          <div className="overflow-y-auto border-b border-zinc-800 p-2 md:border-b-0 md:border-r">
            {TABS.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700',
                    activeTab === tab.id
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300',
                  )}
                >
                  <Icon size={13} />
                  {tab.label}
                </button>
              )
            })}
          </div>

          <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
            {!config ? (
              <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                Loading config...
              </div>
            ) : (
              renderTab()
            )}
          </div>

          <div className="hidden min-h-0 overflow-y-auto border-l border-zinc-800 p-3 md:block">
            <EffectiveSummary />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3 sm:px-5">
          <RestartBanner visible={needsRestart} />
          <div className="flex items-center gap-2 ml-auto">
            {error && (
              <span className="text-xs text-red-400 mr-2 max-w-[300px] truncate">{error}</span>
            )}
            <button
              onClick={handleClose}
              className="rounded-md px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors',
                !dirty || saving
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  : saved
                    ? 'bg-emerald-900/30 text-emerald-400'
                    : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700',
              )}
            >
              {saved ? <Check size={12} /> : <Save size={12} />}
              {saved ? 'Saved' : saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Unsaved changes confirmation */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3" onClick={() => setShowCloseConfirm(false)}>
          <div className="rounded-md border border-zinc-800 bg-zinc-900 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm text-zinc-200 mb-3">Discard unsaved changes?</div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => handleConfirmClose(false)}
                className="rounded-md px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                Keep editing
              </button>
              <button
                onClick={() => handleConfirmClose(true)}
                className="rounded-md bg-red-900/30 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-900/50"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EffectiveSummary() {
  const config = useConfigStore((s) => s.config)
  const [effective, setEffective] = useState<any>(null)

  useEffect(() => {
    if (!config) return
    fetch('/api/config/effective', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setEffective(data.effective ?? null))
      .catch(() => setEffective(null))
  }, [config])

  if (!effective) return <div className="text-xs text-zinc-600">Effective config loading...</div>

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-medium text-zinc-300">Effective config</div>
        <div className="mt-1 text-[11px] text-zinc-500">Saved health: {effective.status}</div>
      </div>
      <div className="space-y-1">
        <div className="text-[11px] font-medium text-zinc-500">Tiers</div>
        {(['fast', 'balanced', 'powerful'] as const).map((tier) => (
          <div key={tier} className="text-[11px] text-zinc-400">
            <span className="text-zinc-600">{tier}: </span>{effective.tiers[tier]?.modelId ?? 'unset'}
          </div>
        ))}
      </div>
      <div className="space-y-1">
        <div className="text-[11px] font-medium text-zinc-500">Modules</div>
        {Object.entries(effective.modules || {}).map(([role, route]: [string, any]) => (
          <div key={role} className="text-[11px] text-zinc-400">
            <span className="text-zinc-600">{role}: </span>{route.tier}
          </div>
        ))}
      </div>
      {(effective.errors?.length > 0 || effective.warnings?.length > 0) && (
        <div className="space-y-1 border-t border-zinc-800 pt-3">
          {[...(effective.errors || []), ...(effective.warnings || [])].slice(0, 5).map((msg: string) => (
            <div key={msg} className="text-[11px] text-amber-400">{msg}</div>
          ))}
        </div>
      )}
    </div>
  )
}
