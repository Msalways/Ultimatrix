'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, Save, Check, Settings, Key, Layers, Shield, Globe, Cpu, Gauge, Wrench } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'
import { useConfigStore } from '@/stores/config-store'
import { RestartBanner } from './settings/restart-banner'
import { GeneralTab } from './settings/tabs/general-tab'
import { ProvidersTab } from './settings/tabs/providers-tab'
import { ModelTiersTab } from './settings/tabs/model-tiers-tab'
import { ScopeSafetyTab } from './settings/tabs/scope-safety-tab'
import { BrowserTab } from './settings/tabs/browser-tab'
import { SolverTab } from './settings/tabs/solver-tab'
import { BudgetTab } from './settings/tabs/budget-tab'
import { AdvancedTab } from './settings/tabs/advanced-tab'
import { cn } from '@/lib/utils'

const TABS = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'providers', label: 'Providers', icon: Key },
  { id: 'tiers', label: 'Model Tiers', icon: Layers },
  { id: 'scope', label: 'Scope & Safety', icon: Shield },
  { id: 'browser', label: 'Browser', icon: Globe },
  { id: 'solver', label: 'Solver', icon: Cpu },
  { id: 'budget', label: 'Budget', icon: Gauge },
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

  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  useEffect(() => {
    if (open) {
      loadConfig()
      setActiveTab('general')
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
      case 'general': return <GeneralTab />
      case 'providers': return <ProvidersTab />
      case 'tiers': return <ModelTiersTab />
      case 'scope': return <ScopeSafetyTab />
      case 'browser': return <BrowserTab />
      case 'solver': return <SolverTab />
      case 'budget': return <BudgetTab />
      case 'advanced': return <AdvancedTab />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={handleClose}>
      <div
        className="w-[800px] max-h-[85vh] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <span className="text-sm font-medium text-zinc-200">Settings</span>
          <div className="flex items-center gap-3">
            {dirty && (
              <span className="text-xs text-amber-400/70">Unsaved changes</span>
            )}
            <button onClick={handleClose} className="text-zinc-500 hover:text-zinc-300">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-zinc-800 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap border-b-2 transition-colors',
                  activeTab === tab.id
                    ? 'text-zinc-200 border-zinc-200'
                    : 'text-zinc-500 hover:text-zinc-300 border-transparent',
                )}
              >
                <Icon size={12} />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {!config ? (
            <div className="flex h-full items-center justify-center text-xs text-zinc-500">
              Loading config...
            </div>
          ) : (
            renderTab()
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800">
          <RestartBanner visible={needsRestart} />
          <div className="flex items-center gap-2 ml-auto">
            {error && (
              <span className="text-xs text-red-400 mr-2 max-w-[300px] truncate">{error}</span>
            )}
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
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
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40" onClick={() => setShowCloseConfirm(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm text-zinc-200 mb-3">Discard unsaved changes?</div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => handleConfirmClose(false)}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
              >
                Keep editing
              </button>
              <button
                onClick={() => handleConfirmClose(true)}
                className="px-3 py-1.5 text-xs bg-red-900/30 text-red-400 hover:bg-red-900/50 rounded"
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
