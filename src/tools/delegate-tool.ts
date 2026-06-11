import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { createAllWorkers } from '../workers/registry'
import { getBrowser } from '../browser/manager'
import { getGlobalRecorder } from '../recorder/index'
import { _setBrowser } from './observation-tools'

let _sharedWorkers: any = null

export function setSharedWorkers(workers: any): void {
  _sharedWorkers = workers
}

export function getSharedWorkers(): any {
  return _sharedWorkers
}

export function createDelegateToTool(model: any) {
  const browser = getBrowser()
  _setBrowser(browser)
  let workers: any = _sharedWorkers
  const recorder = getGlobalRecorder()
  if (!workers) {
    createAllWorkers(model, browser, recorder || undefined).then(w => { workers = w; _sharedWorkers = w }).catch(() => {})
  }

  return createTool({
    id: 'delegateToWorker',
    description: 'Delegate a security testing task to a specialist worker. Workers: injection (SQLi, XSS, WAF bypass, second-order), authControl (IDOR, JWT, OAuth), advanced (race conditions, business logic, mass assignment), recon (fingerprinting, discovery). Returns the worker\'s response with findings.',
    inputSchema: z.object({
      worker: z.enum(['injection', 'authControl', 'advanced', 'recon']).describe('The specialist worker to delegate to'),
      task: z.string().describe('Detailed task description including target endpoint, parameters, method, headers, and any context'),
    }),
    execute: async (inputData) => {
      const data = inputData as { worker: string; task: string }
      if (!workers) {
        workers = await createAllWorkers(model, browser, recorder || undefined)
      }
      const worker = workers[data.worker]
      if (!worker) return { error: `Unknown worker: ${data.worker}` }
      try {
        const threadId = `delegate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const result = await worker.generate(data.task, {
          memory: { thread: threadId, resource: 'ultimatrix' },
        })
        return { result: result.text }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}