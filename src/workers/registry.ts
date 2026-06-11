import type { MastraLanguageModel } from '@mastra/core/agent'
import type { MastraMemory } from '@mastra/core/memory'
import { Memory } from '@mastra/memory'
import { InMemoryStore } from '@mastra/core/storage'
import type { AgentBrowser } from '@mastra/agent-browser'
import { createInjectionWorker } from './injection'
import { createAuthControlWorker } from './auth-control'
import { createAdvancedWorker } from './advanced'
import { createReconWorker } from './recon'
import { ActionRecorder } from '../recorder/index'
import { setGlobalStagehand } from '../tools/stagehand-tools'
import { getBrowser } from '../browser/manager'
import { Stagehand } from '@browserbasehq/stagehand'
import { Browser, chromium } from 'playwright'

let _sharedMemory: MastraMemory | null = null
let _stagehand: Stagehand | null = null
let _playwrightBrowser: Browser | null = null

function getSharedMemory(): MastraMemory {
  if (!_sharedMemory) {
    _sharedMemory = new Memory({
      storage: new InMemoryStore(),
      options: {
        lastMessages: 10,
        semanticRecall: false,
        workingMemory: { enabled: false },
      },
    })
  }
  return _sharedMemory
}

async function getStagehand(): Promise<Stagehand | null> {
  if (_stagehand) return _stagehand
  try {
    _playwrightBrowser = await chromium.launch({ headless: true })
    const context = await _playwrightBrowser.newContext()
    const page = await context.newPage()
    _stagehand = new (Stagehand as any)({ page, context, browser: _playwrightBrowser })
    setGlobalStagehand(_stagehand as any)
    return _stagehand
  } catch {
    return null
  }
}

export async function createAllWorkers(model: MastraLanguageModel, browser?: AgentBrowser, recorder?: ActionRecorder) {
  const memory = getSharedMemory()
  await getStagehand()
  return {
    injection: createInjectionWorker(model, browser, memory, recorder),
    authControl: createAuthControlWorker(model, browser, memory, recorder),
    advanced: createAdvancedWorker(model, browser, memory, recorder),
    recon: createReconWorker(model, browser, memory, recorder),
  }
}

export { createInjectionWorker }
export { createAuthControlWorker }
export { createAdvancedWorker }
export { createReconWorker }