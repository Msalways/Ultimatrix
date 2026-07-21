import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalSessionManager } from '../http/session-manager'
import { isUrlInScope } from '../safety/scope-guard'
import { learnRBACFromMatrix } from '../intelligence/rbac-learner'

/**
 * Dual-session / multi-identity matrix builder.
 *
 * Industry-standard authorization testing (overstep / Autorize / possession):
 * prove BOLA/BOPLA by replaying requests under REAL foreign identities, not by
 * spoofing an `X-Role` header. This tool accepts either a declarative matrix
 * (roles + real captured headers/cookies + owned object ids) or reuses sessions
 * already stored in the SessionManager, normalizes it, and (optionally) writes
 * it into the relational RBAC graph.
 *
 * No hardcoded role-name vocabulary: roles + endpoints come from the caller /
 * captured sessions, never from a frozen list.
 */
export const dualSessionOrchestrator = createTool({
  id: 'dualSessionOrchestrator',
  description:
    'Build a multi-identity authorization matrix from real sessions (no header spoofing). Input: a declarative matrix (role -> baseUrl + headers/cookies + ownedObjectIds + reachable endpoints) and/or a list of already-stored session names. Output: normalized SessionMatrix usable by findBrokenAccessControl / detectMarkerLeak. Optionally writes RBACRole nodes + REQUIRES_ROLE/HAS_ROLE/PERMISSION edges into the graph.',
  inputSchema: z.object({
    matrix: z
      .array(
        z.object({
          role: z.string().describe('Identity label, e.g. "admin", "user_a", "tenant_b".'),
          baseUrl: z.string().url().describe('Origin this identity authenticates against.'),
          headers: z.record(z.string(), z.string()).optional().describe('Real captured auth headers (Authorization, Cookie, etc.).'),
          cookies: z.record(z.string(), z.string()).optional().describe('Real captured cookies (alternative to headers).'),
          ownedObjectIds: z.array(z.string()).optional().describe('Object ids this identity legitimately owns (for BOLA replay).'),
          reachableEndpoints: z
            .array(z.string())
            .optional()
            .describe('Endpoints this identity can observe (used to build the RBAC relation graph).'),
          marker: z.string().optional().describe('A value uniquely identifying this identity\'s data, for leak detection.'),
        })
      )
      .describe('Declarative multi-identity matrix. Each entry is a REAL captured identity.'),
    useStoredSessions: z
      .array(z.string())
      .optional()
      .describe('Names of sessions already stored via the session manager to include in the matrix.'),
    writeToGraph: z.boolean().optional().default(true).describe('Write RBACRole nodes + permission edges into the graph. Default true.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    roles: z.array(
      z.object({
        role: z.string(),
        baseUrl: z.string(),
        headers: z.record(z.string(), z.string()),
        ownedObjectIds: z.array(z.string()),
        reachableEndpoints: z.array(z.string()),
        marker: z.string().optional(),
      })
    ),
    roleCount: z.number(),
    scopeViolations: z.array(z.tuple([z.string(), z.string()])).optional(),
    persistedMatrixPath: z.string().optional(),
  }),
  execute: async (ctx) => {
    const { matrix, useStoredSessions, writeToGraph } = ctx
    const sm = getGlobalSessionManager()
    const roles: Array<{
      role: string
      baseUrl: string
      headers: Record<string, string>
      ownedObjectIds: string[]
      reachableEndpoints: string[]
      marker?: string
    }> = []
    const scopeViolations: Array<[string, string]> = []

    for (const entry of matrix) {
      const scope = isUrlInScope(entry.baseUrl)
      if (!scope.allowed) {
        scopeViolations.push([entry.role, entry.baseUrl])
        continue
      }
      const headers: Record<string, string> = { ...(entry.headers ?? {}) }
      if (entry.cookies && Object.keys(entry.cookies).length > 0 && !headers['Cookie']) {
        headers['Cookie'] = Object.entries(entry.cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ')
      }
      // Persist as a real session so replay tools can reuse it.
      const sessionName = `${entry.role}:${entry.baseUrl}`
      const session = sm.createSession(sessionName, entry.baseUrl)
      if (entry.cookies) Object.entries(entry.cookies).forEach(([k, v]) => sm.getClient(sessionName)?.setCookie(k, v))
      if (headers['Authorization']) sm.setToken(sessionName, headers['Authorization'].replace(/^Bearer\s+/i, ''))
      void session

      roles.push({
        role: entry.role,
        baseUrl: entry.baseUrl,
        headers,
        ownedObjectIds: entry.ownedObjectIds ?? [],
        reachableEndpoints: entry.reachableEndpoints ?? [],
        marker: entry.marker,
      })
    }

    if (useStoredSessions) {
      for (const name of useStoredSessions) {
        const s = sm.getSession(name)
        if (!s) continue
        const scope = isUrlInScope(s.baseUrl)
        if (!scope.allowed) {
          scopeViolations.push([name, s.baseUrl])
          continue
        }
        roles.push({
          role: name,
          baseUrl: s.baseUrl,
          headers: sm.getAllHeaders(name),
          ownedObjectIds: [],
          reachableEndpoints: [],
        })
      }
    }

    if (writeToGraph && roles.length > 0) {
      learnRBACFromMatrix(roles)
    }

    return {
      ok: scopeViolations.length === 0,
      roles,
      roleCount: roles.length,
      scopeViolations: scopeViolations.length ? scopeViolations : undefined,
    }
  },
})
