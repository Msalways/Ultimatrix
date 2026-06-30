import type { MastraMemory } from '@mastra/core/memory'
import { Memory } from '@mastra/memory'
import { LibSQLStore } from '@mastra/libsql'
import type { StagehandBrowser } from '@mastra/stagehand'
import { createInjectionWorker } from './injection'
import { createAuthControlWorker } from './auth-control'
import { createAdvancedWorker } from './advanced'
import { createReconWorker } from './recon'
import type { UltimatrixConfig } from '../config'
import { computeLastMessages } from '../config'

let _store: LibSQLStore | null = null

export async function createMemoryStore(dbPath?: string): Promise<LibSQLStore> {
  if (!_store) {
    const url = dbPath ? `file:${dbPath}` : 'file:./ultimatrix.db'
    _store = new LibSQLStore({ id: 'ultimatrix', url })
    await _store.init()
  }
  return _store
}

export async function createMemory(config: UltimatrixConfig, store?: LibSQLStore, dbPath?: string): Promise<MastraMemory> {
  const storage = store ?? await createMemoryStore(dbPath)
  const lastMessages = computeLastMessages(config.model, config.memory.lastMessages)
  return new Memory({
    storage,
    options: {
      lastMessages,
      semanticRecall: config.memory.semanticRecall,
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
