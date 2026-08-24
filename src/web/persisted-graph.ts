import { resolve } from 'node:path'
import { GraphStore } from '../graph/store'
import { getTargetWorkspaceDir } from '../workspace'

const CACHE_TTL_MS = 5_000

const graphCache = new Map<string, { store: GraphStore; loadedAt: number }>()

/** Read a target graph without switching global engine/workspace state. */
export async function loadPersistedGraph(target: string): Promise<GraphStore> {
  const cached = graphCache.get(target)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.store
  }

  const graphPath = resolve(getTargetWorkspaceDir(target), 'graph.json')
  const store = new GraphStore(graphPath)
  await store.load()
  graphCache.set(target, { store, loadedAt: Date.now() })
  return store
}
