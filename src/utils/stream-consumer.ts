/**
 * Shared Stream Consumer — CLI display + forensic logging + event emission
 *
 * Two variants:
 * 1. consumeStream — displays to CLI (stdout) + logs to forensic log
 * 2. collectStream — collects events for Web UI / SSE
 *
 * Used by both session.ts (CLI) and api/solver/route.ts (Web UI).
 */

import { log } from './logger'
import type { ForensicLog } from '../logging/forensic-log'

const internalTools = new Set(['updateWorkingMemory', 'setWorkingMemory'])

export interface StreamEvent {
  type: string
  payload?: any
  text?: string
  toolName?: string
  error?: string
  result?: any
  args?: any
}

export interface ConsumeOptions {
  agentId?: string
  forensicLog?: ForensicLog
  onEvent?: (event: StreamEvent) => void
  displayText?: boolean
}

/**
 * Consume an agent stream and display to CLI.
 * Also logs to forensic log if provided.
 */
export async function consumeStream(
  stream: AsyncIterable<StreamEvent>,
  options: ConsumeOptions = {},
): Promise<void> {
  const { agentId = 'agent', forensicLog, onEvent, displayText = true } = options
  let textBuf: string[] = []
  let lastToolCall: { name: string; args?: unknown; time: number } | null = null

  const flushText = (asResponse: boolean) => {
    if (textBuf.length > 0 && displayText) {
      const text = textBuf.join('')
      if (asResponse) {
        process.stdout.write(text)
      } else {
        log.dim(text)
      }
      textBuf = []
    } else {
      textBuf = []
    }
  }

  for await (const chunk of stream) {
    onEvent?.(chunk)

    switch (chunk.type) {
      case 'text-delta':
        textBuf.push(chunk.payload?.text || chunk.text || '')
        break
      case 'reasoning-delta':
        textBuf.push(chunk.payload?.text || chunk.text || '')
        break
      case 'reasoning-end':
        break
      case 'tool-call':
        if (chunk.payload?.toolName === 'askUser') break
        if (internalTools.has(chunk.payload?.toolName || '')) break
        flushText(false)
        if (displayText) log.dim('  → ' + chunk.payload?.toolName)
        lastToolCall = { name: chunk.payload?.toolName, args: chunk.payload?.args, time: Date.now() }
        forensicLog?.log({
          type: 'tool-call',
          agent: agentId,
          tool: chunk.payload?.toolName,
          args: chunk.payload?.args as Record<string, unknown>,
        })
        break
      case 'tool-result':
        if (internalTools.has(chunk.payload?.toolName || '')) break
        flushText(false)
        if (displayText) log.success(chunk.payload?.toolName)
        forensicLog?.log({
          type: 'tool-result',
          agent: agentId,
          tool: chunk.payload?.toolName,
          result: chunk.payload?.result,
          duration: lastToolCall ? Date.now() - lastToolCall.time : undefined,
        })
        lastToolCall = null
        break
      case 'tool-error':
        flushText(false)
        if (displayText) log.error((chunk.payload?.toolName || '') + ': ' + (chunk.payload?.error || ''))
        forensicLog?.log({
          type: 'tool-error',
          agent: agentId,
          tool: chunk.payload?.toolName,
          error: chunk.payload?.error,
        })
        lastToolCall = null
        break
      case 'error':
        flushText(false)
        if (displayText) log.error(String(chunk.payload?.error || chunk.error || ''))
        forensicLog?.log({
          type: 'error',
          agent: agentId,
          error: String(chunk.payload?.error || chunk.error || ''),
        })
        break
      case 'step-finish':
        flushText(true)
        break
      case 'background-task-started':
        flushText(false)
        if (displayText) log.dim('background task: ' + (chunk.payload?.toolName || '') + '...')
        break
      case 'background-task-completed':
        flushText(false)
        if (displayText) log.success('background task: ' + (chunk.payload?.toolName || ''))
        break
      case 'background-task-failed':
        flushText(false)
        if (displayText) log.error('background task: ' + (chunk.payload?.toolName || ''))
        break
    }
  }
  flushText(true)
}

/**
 * Collect stream events into an array (for Web UI / SSE).
 * Does NOT display to CLI.
 */
export async function collectStream(
  stream: AsyncIterable<StreamEvent>,
  options: { forensicLog?: ForensicLog; agentId?: string } = {},
): Promise<StreamEvent[]> {
  const { forensicLog, agentId = 'agent' } = options
  const events: StreamEvent[] = []
  let lastToolCall: { name: string; time: number } | null = null

  for await (const chunk of stream) {
    events.push(chunk)

    switch (chunk.type) {
      case 'tool-call':
        lastToolCall = { name: chunk.payload?.toolName, time: Date.now() }
        forensicLog?.log({
          type: 'tool-call',
          agent: agentId,
          tool: chunk.payload?.toolName,
          args: chunk.payload?.args as Record<string, unknown>,
        })
        break
      case 'tool-result':
        forensicLog?.log({
          type: 'tool-result',
          agent: agentId,
          tool: chunk.payload?.toolName,
          result: chunk.payload?.result,
          duration: lastToolCall ? Date.now() - lastToolCall.time : undefined,
        })
        lastToolCall = null
        break
      case 'tool-error':
        forensicLog?.log({
          type: 'tool-error',
          agent: agentId,
          tool: chunk.payload?.toolName,
          error: chunk.payload?.error,
        })
        lastToolCall = null
        break
      case 'error':
        forensicLog?.log({
          type: 'error',
          agent: agentId,
          error: String(chunk.payload?.error || chunk.error || ''),
        })
        break
    }
  }

  return events
}
