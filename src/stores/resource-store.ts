import { create } from 'zustand'

export type LoadState = 'idle' | 'loading' | 'ready' | 'refreshing' | 'error'

export type ResourceKey =
  | 'config'
  | 'session'
  | 'chatHistory'
  | 'graph'
  | 'findings'
  | 'workers'
  | 'skills'
  | 'browser'

export interface ResourceEntry {
  state: LoadState
  error: string | null
  lastLoaded: number | null
  retryAction: (() => void) | null
}

interface ResourceStore {
  resources: Record<ResourceKey, ResourceEntry>

  mark(key: ResourceKey, state: LoadState, error?: string, retryAction?: () => void): void
  isReady(key: ResourceKey): boolean
  isLoading(key: ResourceKey): boolean
  isRefreshing(key: ResourceKey): boolean
  isAnyLoading(): boolean
  hasData(key: ResourceKey): boolean
  getTransitionLabel(key: ResourceKey): string | null
}

const RESOURCE_LABELS: Record<ResourceKey, string> = {
  config: 'Loading configuration',
  session: 'Restoring workspace',
  chatHistory: 'Loading chat history',
  graph: 'Loading graph',
  findings: 'Loading findings',
  workers: 'Loading workers',
  skills: 'Indexing capabilities',
  browser: 'Checking browser',
}

function createEntry(): ResourceEntry {
  return { state: 'idle', error: null, lastLoaded: null, retryAction: null }
}

export const useResourceStore = create<ResourceStore>((set, get) => ({
  resources: {
    config: createEntry(),
    session: createEntry(),
    chatHistory: createEntry(),
    graph: createEntry(),
    findings: createEntry(),
    workers: createEntry(),
    skills: createEntry(),
    browser: createEntry(),
  },

  mark: (key, state, error, retryAction) =>
    set((s) => ({
      resources: {
        ...s.resources,
        [key]: {
          state,
          error: error ?? null,
          lastLoaded: state === 'ready' ? Date.now() : s.resources[key].lastLoaded,
          retryAction: retryAction ?? null,
        },
      },
    })),

  isReady: (key) => get().resources[key].state === 'ready',

  isLoading: (key) => get().resources[key].state === 'loading',

  isRefreshing: (key) => get().resources[key].state === 'refreshing',

  isAnyLoading: () => {
    const { resources } = get()
    return (Object.keys(resources) as ResourceKey[]).some(
      (k) => resources[k].state === 'loading' || resources[k].state === 'refreshing',
    )
  },

  hasData: (key) => {
    const s = get().resources[key]
    return s.state === 'ready' || s.state === 'refreshing' || (s.state === 'error' && s.lastLoaded !== null)
  },

  getTransitionLabel: (key) => {
    const { state } = get().resources[key]
    if (state === 'loading') return RESOURCE_LABELS[key]
    if (state === 'refreshing') return `Refreshing ${RESOURCE_LABELS[key].toLowerCase().replace('loading ', '')}`
    return null
  },
}))

export { RESOURCE_LABELS }
