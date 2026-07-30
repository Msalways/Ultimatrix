import { Memory } from '@mastra/memory'
import { LibSQLVector, LibSQLStore } from '@mastra/libsql'
import type { UltimatrixConfig } from '../config'
import { log } from '../utils/logger'
import { ContextWindowRegistry } from '../models/context-window-registry'

let _vector: LibSQLVector | null = null
let _storage: LibSQLStore | null = null

function createVectorStore(): LibSQLVector | null {
  if (!_vector) {
    _vector = new LibSQLVector({ id: 'ultimatrix-vector', url: 'file:./ultimatrix.db' })
  }
  return _vector
}

function createStorageStore(): LibSQLStore {
  if (!_storage) {
    _storage = new LibSQLStore({ id: 'ultimatrix', url: 'file:./ultimatrix.db' })
  }
  return _storage
}

function resolveEmbedder(config: UltimatrixConfig): string | undefined {
  if (!config.memory.embedder?.provider || !config.memory.embedder?.model) return undefined
  return `${config.memory.embedder.provider}/${config.memory.embedder.model}`
}

export function createMemoryFromConfig(config: UltimatrixConfig) {
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

  const vector = wantsVector && embedderId ? createVectorStore() : undefined
  const storage = createStorageStore()

  // Resolve OM thresholds from model's context window (NOT hardcoded)
  const registry = new ContextWindowRegistry(config)
  const contextWindow = registry.getContextWindow(config.model ?? '') || 128_000
  const observationThreshold = Math.floor(contextWindow * 0.25)  // Compress at 25% of window
  const reflectionThreshold = Math.floor(contextWindow * 0.35)  // Summarize at 35% of window

  return new Memory({
    storage,
    ...(vector ? { vector } : {}),
    ...(embedderId ? { embedder: embedderId } : {}),
    options: {
      lastMessages: config.memory.lastMessages,
      semanticRecall,
      workingMemory: {
        enabled: config.memory.workingMemory,
        template: `
## Working Memory
- Target: {{target}}
- Phase: {{phase}}
- Findings Count: {{findingsCount}}
- Endpoints Tested: {{endpointsTested}}
- Status: {{status}}
`,
      },
      observationalMemory: {
        model: config.model ?? 'openai/gpt-4o-mini',
        observation: {
          messageTokens: observationThreshold,
        },
        reflection: {
          observationTokens: reflectionThreshold,
        },
      },
    },
  })
}
