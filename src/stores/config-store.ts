import { create } from 'zustand'

type UltimatrixConfig = Record<string, any>

interface ConfigState {
  config: UltimatrixConfig | null
  original: UltimatrixConfig | null
  dirty: boolean
  saving: boolean
  saved: boolean
  error: string | null
  needsRestart: boolean

  load: () => Promise<void>
  update: (patch: Partial<UltimatrixConfig>) => void
  save: () => Promise<{ ok: boolean; errors?: string[] }>
  reset: () => void
  clearSaved: () => void
}

const RESTART_FIELDS = ['provider', 'model', 'engine', 'modelTiers']

function hasChanges(a: any, b: any): boolean {
  if (!a || !b) return a !== b
  for (const key of Object.keys({ ...a, ...b })) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return true
  }
  return false
}

function needsRestartCheck(original: any, updated: any): boolean {
  if (!original || !updated) return false
  for (const field of RESTART_FIELDS) {
    if (JSON.stringify(original[field]) !== JSON.stringify(updated[field])) return true
  }
  return false
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  original: null,
  dirty: false,
  saving: false,
  saved: false,
  error: null,
  needsRestart: false,

  load: async () => {
    try {
      const res = await fetch('/api/config')
      const data = await res.json()
      set({ config: data, original: JSON.parse(JSON.stringify(data)), dirty: false, error: null, needsRestart: false })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  update: (patch) => {
    const { config, original } = get()
    if (!config) return
    const updated = { ...config, ...patch }
    set({
      config: updated,
      dirty: hasChanges(original, updated),
      needsRestart: needsRestartCheck(original, updated),
    })
  },

  save: async () => {
    const { config } = get()
    if (!config) return { ok: false, errors: ['No config loaded'] }
    set({ saving: true, error: null })
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (data.ok) {
        set({ saving: false, saved: true, dirty: false, original: JSON.parse(JSON.stringify(config)) })
        setTimeout(() => set({ saved: false }), 2000)
        return { ok: true }
      } else {
        set({ saving: false, error: data.errors?.join('\n') || 'Save failed' })
        return { ok: false, errors: data.errors }
      }
    } catch (err) {
      set({ saving: false, error: String(err) })
      return { ok: false, errors: [String(err)] }
    }
  },

  reset: () => {
    const { original } = get()
    if (original) {
      set({ config: JSON.parse(JSON.stringify(original)), dirty: false, error: null, needsRestart: false })
    }
  },

  clearSaved: () => set({ saved: false }),
}))
