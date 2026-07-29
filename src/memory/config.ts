import { Memory } from '@mastra/memory'
import { LibSQLVector } from '@mastra/libsql'
import type { UltimatrixConfig } from '../config'
import { log } from '../utils/logger'

let _vector: LibSQLVector | null = null

function createVectorStore(): LibSQLVector | null {
  if (!_vector) {
    _vector = new LibSQLVector({ url: 'file:./ultimatrix.db' })
  }
  return _vector
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

  return new Memory({
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
    },
  })
}
