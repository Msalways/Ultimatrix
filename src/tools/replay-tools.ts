/**
 * Replay tools (P3.1) — captured-traffic query + replay with mutations.
 *
 * listCapturedRequests: compact, filterable index of everything the session
 *   actually sent (httpRequest calls + ingested HAR entries).
 * replayCapturedRequest: re-fires a captured request by id with structural
 *   mutations (headers/body/url/method), routed through the httpRequest tool
 *   so scope guard, robots.txt, rate limiting, backoff, evidence recording,
 *   and forensic logging all apply unchanged.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getCapturedRequestStore } from '../capture/captured-request-store'
import { httpRequest } from './http-tools'

const MUTABLE_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const

export const listCapturedRequests = createTool({
  id: 'listCapturedRequests',
  description:
    'List requests captured this session (outbound HTTP tool traffic + ingested HAR entries). Filter by method/host/path substring to find an entry id, then replay it with mutations. Returns compact refs only.',
  inputSchema: z.object({
    method: z.string().optional().describe('Filter by HTTP method (exact, case-insensitive)'),
    host: z.string().optional().describe('Filter by exact host'),
    urlContains: z.string().optional().describe('Filter: URL must contain this substring'),
    limit: z.number().int().positive().max(200).default(50).describe('Max refs returned'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      totalCaptured: z.number(),
      matches: z.array(z.object({
        id: z.string(),
        method: z.string(),
        url: z.string(),
        status: z.number().optional(),
        source: z.enum(['tool', 'har']),
      })),
    }),
  }),
  execute: async ({ method, host, urlContains, limit }) => {
    const store = getCapturedRequestStore()
    const matches = store.list({
      ...(method !== undefined ? { method } : {}),
      ...(host !== undefined ? { host } : {}),
      ...(urlContains !== undefined ? { urlContains } : {}),
      ...(limit !== undefined ? { limit } : {}),
    })
    return { ok: true, value: { totalCaptured: store.size, matches } }
  },
})

export const replayCapturedRequest = createTool({
  id: 'replayCapturedRequest',
  description:
    'Re-fire a previously captured request by id with optional structural mutations (set/remove headers, swap body or append to it, change URL or method). The mutated request goes through the normal HTTP tool path — scope guard, rate limiting and evidence recording included. Use for differential testing: original vs modified response.',
  inputSchema: z.object({
    entryId: z.string().describe('Captured request id from listCapturedRequests (e.g. cap-12)'),
    setHeaders: z.record(z.string(), z.string()).optional().describe('Headers to set/override on the replay (merged over captured headers)'),
    removeHeaderNames: z.array(z.string()).optional().describe('Header names to strip from the replay (case-insensitive)'),
    body: z.string().optional().describe('Replacement request body (overrides captured body)'),
    appendBody: z.string().optional().describe('Text appended after the captured body (ignored if body is also given)'),
    url: z.string().url().optional().describe('Override target URL'),
    method: z.enum(MUTABLE_METHODS).optional().describe('Override HTTP method'),
    timeoutMs: z.number().int().positive().default(10000).describe('Timeout in milliseconds'),
  }).refine(
    (d) => !(d.body !== undefined && d.appendBody !== undefined),
    { message: 'Use either body (replace) or appendBody (append), not both' },
  ),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      entryId: z.string(),
      originalStatus: z.number().optional(),
      replayedStatus: z.number().optional(),
      statusDelta: z.string().optional(),
      requestSent: z.object({
        method: z.string(),
        url: z.string(),
        headers: z.record(z.string(), z.string()),
        body: z.string().optional(),
      }),
      response: z.object({
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().optional(),
        durationMs: z.number().optional(),
      }),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ entryId, setHeaders, removeHeaderNames, body, appendBody, url, method, timeoutMs }) => {
    const store = getCapturedRequestStore()
    const captured = store.get(entryId)
    if (!captured) {
      return { ok: false, error: `Unknown entry id: ${entryId}. Call listCapturedRequests first.` }
    }

    // Structural mutation application — never string-surgery on the raw request.
    const headers: Record<string, string> = { ...captured.headers }
    if (setHeaders) {
      for (const [k, v] of Object.entries(setHeaders)) {
        for (const existing of Object.keys(headers)) {
          if (existing.toLowerCase() === k.toLowerCase()) delete headers[existing]
        }
        headers[k] = v
      }
    }
    if (removeHeaderNames) {
      for (const name of removeHeaderNames) {
        for (const existing of Object.keys(headers)) {
          if (existing.toLowerCase() === name.toLowerCase()) delete headers[existing]
        }
      }
    }

    let finalBody: string | undefined
    if (body !== undefined) finalBody = body
    else if (captured.body !== undefined && appendBody !== undefined) finalBody = captured.body + appendBody
    else if (captured.body !== undefined) finalBody = captured.body

    const finalMethod = method ?? (finalBody !== undefined && ['GET', 'HEAD'].includes(captured.method.toUpperCase()) ? 'POST' : captured.method)
    const finalUrl = url ?? captured.url

    if (['GET', 'HEAD'].includes(finalMethod.toUpperCase())) finalBody = undefined

    const sent = {
      method: finalMethod,
      url: finalUrl,
      headers,
      ...(finalBody !== undefined ? { body: finalBody } : {}),
    }

    if (!httpRequest.execute) return { ok: false, error: 'httpRequest tool is not executable' }

    type HttpResult = {
      ok: boolean
      value?: { status: number; headers: Record<string, string>; body?: string; durationMs?: number }
      error?: string
    }
    const result = (await httpRequest.execute(
      {
        method: finalMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        url: finalUrl,
        headers,
        ...(finalBody !== undefined ? { body: finalBody } : {}),
        timeoutMs: timeoutMs ?? 10000,
      },
      {} as Parameters<typeof httpRequest.execute>[1],
    )) as HttpResult

    if (!result.ok) {
      return { ok: false, error: result.error ?? 'replay failed' }
    }

    const v = result.value!
    return {
      ok: true,
      value: {
        entryId,
        ...(captured.status !== undefined ? { originalStatus: captured.status } : {}),
        replayedStatus: v.status,
        ...(captured.status !== undefined
          ? { statusDelta: `${captured.status} → ${v.status}` }
          : {}),
        requestSent: sent,
        response: {
          ...(v.headers ? { headers: v.headers } : {}),
          ...(v.body !== undefined ? { body: v.body } : {}),
          ...(v.durationMs !== undefined ? { durationMs: v.durationMs } : {}),
        },
      },
    }
  },
})
