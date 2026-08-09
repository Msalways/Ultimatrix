import type { MastraMemory } from '@mastra/core/memory'
import { Memory } from '@mastra/memory'
import { LibSQLStore, LibSQLVector } from '@mastra/libsql'
import type { StagehandBrowser } from '@mastra/stagehand'
import { createInjectionWorker } from './injection'
import { createAuthControlWorker } from './auth-control'
import { createAdvancedWorker } from './advanced'
import { createReconWorker } from './recon'
import type { UltimatrixConfig } from '../config'
import { computeLastMessages } from '../config'
import { log } from '../utils/logger'

const stores = new Map<string, LibSQLStore>()
const vectors = new Map<string, LibSQLVector>()

function memoryUrl(dbPath?: string): string {
  return dbPath ? `file:${dbPath}` : 'file:./ultimatrix.db'
}

export async function createMemoryStore(dbPath?: string): Promise<LibSQLStore> {
  const url = memoryUrl(dbPath)
  let store = stores.get(url)
  if (!store) {
    store = new LibSQLStore({ id: `ultimatrix-${stores.size + 1}`, url })
    await store.init()
    stores.set(url, store)
  }
  return store
}

function createVectorStore(dbPath?: string): LibSQLVector | null {
  const url = memoryUrl(dbPath)
  let vector = vectors.get(url)
  if (!vector) {
    vector = new LibSQLVector({ id: `ultimatrix-vector-${vectors.size + 1}`, url })
    vectors.set(url, vector)
  }
  return vector
}

function resolveEmbedder(config: UltimatrixConfig): string | undefined {
  if (!config.memory.embedder?.provider || !config.memory.embedder?.model) return undefined
  return `${config.memory.embedder.provider}/${config.memory.embedder.model}`
}

export async function createMemory(config: UltimatrixConfig, store?: LibSQLStore, dbPath?: string): Promise<MastraMemory> {
  const storage = store ?? await createMemoryStore(dbPath)
  const lastMessages = computeLastMessages(config.model, config.memory.lastMessages)

  const wantsSemanticRecall = !!config.memory.semanticRecall
  const embedderId = resolveEmbedder(config)
  const wantsVector = !!config.memory.vector?.enabled

  let semanticRecall: boolean | { topK: number; messageRange: number; scope: 'thread' | 'resource' } = false

  if (wantsSemanticRecall) {
    if (embedderId) {
      const sr = config.memory.semanticRecall
      semanticRecall = typeof sr === 'object'
        ? { topK: sr.topK ?? 3, messageRange: sr.messageRange ?? 2, scope: sr.scope ?? 'thread' }
        : { topK: 3, messageRange: 2, scope: 'thread' }
    } else {
      log.warn('semanticRecall enabled but no embedder configured — falling back to last-messages only')
    }
  }

  const vector = wantsVector && embedderId ? createVectorStore(dbPath) : undefined

  return new Memory({
    storage,
    ...(vector ? { vector } : {}),
    ...(embedderId ? { embedder: embedderId } : {}),
    options: {
      lastMessages,
      semanticRecall,
      workingMemory: { enabled: config.memory.workingMemory },
    },
  })
}

export async function createAllWorkers(config: UltimatrixConfig, browser?: StagehandBrowser, memory?: MastraMemory) {
  return {
    injection: createInjectionWorker(config, browser, memory),
    authControl: createAuthControlWorker(config, browser, memory),
    advanced: createAdvancedWorker(config, browser, memory),
    recon: createReconWorker(config, browser, memory),
  }
}

export { createInjectionWorker }
export { createAuthControlWorker }
export { createAdvancedWorker }
export { createReconWorker }
