/**
 * Actor Replay tools — replay captured requests under different auth actors.
 *
 * requestAsActor: high-level replay that automatically resolves an actor's
 *   session headers (cookies/token) from the SessionManager, merges them
 *   over the captured request's original headers, and re-fires through the
 *   normal HTTP path (scope guard, rate limiting, evidence, forensic log).
 *   Designed for authorization testing: baseline owner → alternate actor.
 *
 * listActors: lists available session actors in the SessionManager.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getCapturedRequestStore } from '../capture/captured-request-store'
import { getGlobalSessionManager } from '../http/session-manager'
import { httpRequest } from './http-tools'

export const listActors = createTool({
  id: 'listActors',
  description:
    'List available session actors (stored sessions with auth credentials). Use an actor id with requestAsActor to replay a captured request under that actor\'s auth context.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    actors: z.array(z.object({
      name: z.string(),
      baseUrl: z.string(),
      hasToken: z.boolean(),
      cookieCount: z.number(),
    })),
  }),
  execute: async () => {
    const sm = getGlobalSessionManager()
    const names = sm.listSessions()
    const actors = names.map(name => {
      const session = sm.exportSession(name)
      return {
        name,
        baseUrl: session?.baseUrl ?? '',
        hasToken: !!session?.token,
        cookieCount: session ? Object.keys(session.cookies).length : 0,
      }
    })
    return { ok: true, actors }
  },
})

export const requestAsActor = createTool({
  id: 'requestAsActor',
  description:
    'Replay a captured request under a different actor\'s auth context. Resolves the actor\'s session headers (cookies + bearer token) from the session store and merges them over the original request. Use for authorization testing: baseline owner vs alternate actor. Pass actor id "unauthenticated" to replay without any auth headers.',
  inputSchema: z.object({
    capturedRequestId: z.string().describe('Captured request id from listCapturedRequests (e.g. cap-12)'),
    actorId: z.string().describe('Actor/session name (e.g. "admin:https://target.com") or "unauthenticated" for no auth'),
    url: z.string().url().optional().describe('Override target URL'),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().describe('Override HTTP method'),
    body: z.string().optional().describe('Override request body'),
    headers: z.record(z.string(), z.string()).optional().describe('Additional headers merged on top of actor headers'),
    timeoutMs: z.number().int().positive().default(10000).describe('Timeout in milliseconds'),
  }).refine(
    (d) => !(d.method && ['GET', 'HEAD'].includes(d.method) && d.body !== undefined),
    { message: 'GET/HEAD requests cannot have a body' },
  ),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      capturedRequestId: z.string(),
      actorId: z.string(),
      originalStatus: z.number().optional(),
      actorStatus: z.number().optional(),
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
  execute: async ({ capturedRequestId, actorId, url, method, body, headers, timeoutMs }) => {
    const store = getCapturedRequestStore()
    const captured = store.get(capturedRequestId)
    if (!captured) {
      return { ok: false, error: `Unknown captured request: ${capturedRequestId}. Call listCapturedRequests first.` }
    }

    // Resolve actor headers
    let actorHeaders: Record<string, string> = {}
    let stripAuthHeaders = false
    if (actorId === 'unauthenticated') {
      stripAuthHeaders = true
    } else {
      const sm = getGlobalSessionManager()
      actorHeaders = sm.getAllHeaders(actorId)
      if (Object.keys(actorHeaders).length === 0) {
        // Actor not found in session manager — list available sessions
        const available = sm.listSessions()
        return {
          ok: false,
          error: `Actor "${actorId}" not found in session store. Available: ${available.length > 0 ? available.join(', ') : '(none)'}.
Use storeSession to create an actor first, or pass "unauthenticated" for no auth.`,
        }
      }
    }

    // Start from captured headers, strip auth headers if unauthenticated
    const baseHeaders: Record<string, string> = { ...captured.headers }
    if (stripAuthHeaders) {
      // Remove all auth-related headers (case-insensitive)
      const AUTH_HEADER_NAMES = ['authorization', 'cookie', 'x-api-key', 'x-auth-token', 'x-csrf-token']
      for (const existing of Object.keys(baseHeaders)) {
        if (AUTH_HEADER_NAMES.includes(existing.toLowerCase())) {
          delete baseHeaders[existing]
        }
      }
    }

    // Merge headers: base (captured ± stripped) → actor (override) → explicit (override)
    const mergedHeaders: Record<string, string> = {
      ...baseHeaders,
      ...actorHeaders,
      ...(headers ?? {}),
    }

    const finalMethod = (method ?? captured.method) as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
    const finalUrl = url ?? captured.url
    let finalBody = body ?? captured.body
    if (['GET', 'HEAD'].includes(finalMethod)) finalBody = undefined

    const sent = {
      method: finalMethod,
      url: finalUrl,
      headers: mergedHeaders,
      ...(finalBody !== undefined ? { body: finalBody } : {}),
    }

    type HttpResult = {
      ok: boolean
      value?: { status: number; headers: Record<string, string>; body?: string; durationMs?: number }
      error?: string
    }

    if (!httpRequest.execute) return { ok: false, error: 'httpRequest tool not executable' }

    const result = (await httpRequest.execute(
      {
        method: finalMethod,
        url: finalUrl,
        headers: mergedHeaders,
        ...(finalBody !== undefined ? { body: finalBody } : {}),
        timeoutMs: timeoutMs ?? 10000,
      },
      {} as Parameters<typeof httpRequest.execute>[1],
    )) as HttpResult

    if (!result.ok) {
      return { ok: false, error: result.error ?? 'request failed' }
    }

    const v = result.value!
    return {
      ok: true,
      value: {
        capturedRequestId,
        actorId,
        ...(captured.status !== undefined ? { originalStatus: captured.status } : {}),
        actorStatus: v.status,
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
