'use client'

import { useEffect, useReducer, useRef, useCallback } from 'react'
import {
  createRenderModel,
  reduceMessage,
  type RenderModel,
  type RenderFinding,
} from '../output/render-model'
import type { SolverStreamMessage } from '../solver/solver'

type Action = { type: 'message'; msg: SolverStreamMessage } | { type: 'reset' }

function reducer(state: RenderModel, action: Action): RenderModel {
  if (action.type === 'reset') return createRenderModel()
  // fold in place on a copy to keep React state immutable
  const next = { ...state, tools: [...state.tools], findings: [...state.findings] }
  return reduceMessage(next, action.msg)
}

export interface UseRenderModelResult {
  model: RenderModel
  /** Connect to an SSE/stream source that emits SolverStreamMessage JSON lines. */
  consume: (source: RenderStreamSource) => Promise<void>
  reset: () => void
}

export type RenderStreamSource =
  | ReadableStream<string>
  | ReadableStream<Uint8Array>
  | AsyncIterable<string>

/**
 * Web adapter: drives the shared RenderModel from a stream of
 * SolverStreamMessage. The terminal adapter uses the same reduceMessage
 * function — only the transport/paint differs.
 */
export function useRenderModel(): UseRenderModelResult {
  const [model, dispatch] = useReducer(reducer, undefined, createRenderModel)
  const active = useRef(true)

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  const consume = useCallback(async (source: RenderStreamSource) => {
    const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null
    const streamChunks = (async function* () {
      if (Symbol.asyncIterator in source) {
        yield* source as AsyncIterable<string>
        return
      }
      const reader = (source as ReadableStream<unknown>).getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (typeof value === 'string') yield value
        else if (value instanceof Uint8Array && decoder) yield decoder.decode(value, { stream: true })
      }
    })()

    for await (const chunk of streamChunks) {
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const msg = JSON.parse(payload) as SolverStreamMessage
          if (active.current) dispatch({ type: 'message', msg })
        } catch {
          // ignore malformed frames
        }
      }
    }
  }, [])

  const reset = useCallback(() => dispatch({ type: 'reset' }), [])

  return { model, consume, reset }
}

/** Severity → tailwind color token (shared visual language with terminal). */
export function severityClass(sev: RenderFinding['severity']): string {
  switch (sev) {
    case 'critical': return 'bg-red-600/15 text-red-400 border-red-500/30'
    case 'high': return 'bg-orange-500/15 text-orange-400 border-orange-500/30'
    case 'medium': return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
    case 'low': return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
    default: return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'
  }
}
