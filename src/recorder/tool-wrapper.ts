import { ActionRecorder } from './index'
import { InteractionType } from './interaction'

type ToolFunction = (...args: any[]) => Promise<any>

interface WrappedTool {
  id: string
  description: string
  execute: (...args: any[]) => Promise<any>
}

export function wrapToolWithRecorder(
  toolId: string,
  executeFn: ToolFunction,
  recorder: ActionRecorder,
  interactionType?: InteractionType
): WrappedTool {
  return {
    id: toolId,
    description: `[REC] ${toolId}`,
    execute: async (...args: any[]) => {
      const startTime = Date.now()
      let result: any

      try {
        result = await executeFn(...args)
        return result
      } finally {
        const duration = Date.now() - startTime
        recordForTool(toolId, args, result, recorder, interactionType, duration)
      }
    },
  }
}

function recordForTool(
  toolId: string,
  args: any[],
  result: any,
  recorder: ActionRecorder,
  interactionType?: InteractionType,
  _duration?: number
): void {
  const arg0 = args[0] || {}

  switch (toolId) {
    case 'browser_goto': {
      const url = typeof arg0 === 'string' ? arg0 : arg0.url || ''
      recorder.record(InteractionType.GOTO, `Navigate to ${url}`, { url })
      break
    }
    case 'browser_click': {
      const selector = arg0.selector || arg0.target || ''
      recorder.record(InteractionType.CLICK, `Click ${selector}`, { selector })
      break
    }
    case 'browser_type': {
      const selector = arg0.selector || ''
      const value = arg0.value || arg0.text || ''
      recorder.record(InteractionType.FILL, `Fill ${selector} with "${value.slice(0, 50)}"`, { selector, value: String(value) })
      break
    }
    case 'browser_snapshot':
      recorder.record(InteractionType.SNAPSHOT, 'Page snapshot captured')
      break
    case 'browser_evaluate':
      recorder.record(InteractionType.EVALUATE, 'Page evaluate')
      break
    case 'stagehandAct': {
      const command = arg0.instruction || arg0.action || arg0.command || arg0
      const cmd = typeof command === 'string' ? command : JSON.stringify(command)
      recorder.record(InteractionType.ACT, `Stagehand act: ${cmd.slice(0, 80)}`, { naturalLanguage: cmd })
      break
    }
    case 'stagehandExtract': {
      const query = arg0.instruction || arg0.query || ''
      recorder.record(InteractionType.EXTRACT, `Stagehand extract: ${String(query).slice(0, 80)}`)
      break
    }
    default:
      if (interactionType) {
        recorder.record(interactionType, `Tool: ${toolId}`, { metadata: { toolId, args: arg0 } })
      }
      break
  }
}

export interface MastraTool {
  id: string
  name?: string
  description: string
  inputSchema?: any
  outputSchema?: any
  execute?: (args: any, context?: any) => Promise<any>
}

export function wrapMastraTool(
  tool: any,
  recorder: ActionRecorder,
  interactionType?: InteractionType
): any {
  const origExecute = tool.execute
  return {
    ...tool,
    execute: async (args: any, context?: any) => {
      const startTime = Date.now()
      let result: any
      try {
        result = origExecute ? await origExecute(args, context) : undefined
        return result
      } finally {
        const duration = Date.now() - startTime
        recordForTool(tool.id, [args], result, recorder, interactionType, duration)
      }
    },
  }
}

export function wrapAllMastraTools(
  tools: Record<string, any>,
  recorder: ActionRecorder,
  interactionType?: InteractionType
): Record<string, any> {
  const wrapped: Record<string, MastraTool> = {}
  for (const [key, tool] of Object.entries(tools)) {
    wrapped[key] = wrapMastraTool(tool, recorder, interactionType)
  }
  return wrapped
}

export function wrapAllBrowserTools(
  toolMap: Record<string, ToolFunction>,
  recorder: ActionRecorder
): Record<string, WrappedTool> {
  const wrapped: Record<string, WrappedTool> = {}
  for (const [id, fn] of Object.entries(toolMap)) {
    wrapped[id] = wrapToolWithRecorder(id, fn, recorder)
  }
  return wrapped
}