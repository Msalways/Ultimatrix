import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import { log } from '../utils/logger'

interface StagehandResult {
  tool: string
  result: unknown
  url?: string
}

export function persistStagehandResult(toolName: string, result: unknown): void {
  try {
    const store = getGlobalGraphStore()

    switch (toolName) {
      case 'stagehand_navigate': {
        const r = result as { url?: string; success?: boolean }
        if (r?.url) {
          store.mergePage(r.url, { method: 'GET', tags: ['stagehand'] })
        }
        break
      }
      case 'stagehand_extract': {
        const r = result as { data?: Record<string, unknown>; url?: string }
        if (r?.data && typeof r.data === 'object') {
          const data = r.data
          if (data.url && typeof data.url === 'string') {
            store.mergePage(data.url, { tags: ['stagehand-extract'] })
          }
          if (Array.isArray(data.links)) {
            for (const link of data.links) {
              if (typeof link === 'string' && link.startsWith('http')) {
                try {
                  const u = new URL(link)
                  store.mergeEndpoint({
                    url: u.toString(),
                    method: 'GET',
                    source: 'stagehand-extract',
                    tags: ['auto-discovered'],
                  })
                } catch {}
              }
            }
          }
        }
        break
      }
      case 'stagehand_observe': {
        const r = result as { elements?: Array<{ type?: string; text?: string; selector?: string }> }
        if (r?.elements && Array.isArray(r.elements)) {
          for (const el of r.elements) {
            if (el.type === 'input' || el.type === 'form') {
              log.dim(`Graph bridge: observed ${el.type} — ${el.text || el.selector}`)
            }
          }
        }
        break
      }
    }
  } catch {}
}

export function createGraphBridgeWrapper<T extends (...args: any[]) => any>(
  fn: T,
  toolName: string,
): T {
  return ((...args: any[]) => {
    const result = fn(...args)
    if (result && typeof result === 'object' && typeof result.then === 'function') {
      return result.then((r: unknown) => {
        persistStagehandResult(toolName, r)
        return r
      })
    }
    persistStagehandResult(toolName, result)
    return result
  }) as T
}
