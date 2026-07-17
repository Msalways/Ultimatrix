/**
 * Example extensibility plugin: protocol / surface attacks.
 *
 * This demonstrates the open-world extensibility substrate (Phase 2). A user
 * opts in by adding to `ultimatrix.yaml`:
 *
 *   plugins:
 *     - ./plugins/protocol-surface
 *
 * Each exported tool is wrapped by `DynamicToolRegistry` and inherits the same
 * safety guards (scope guard, evidence gate, rate limiting) as built-ins. Tools
 * are NOT auto-injected — the brain discovers them via `listTools` / `loadTool`.
 *
 * These are real, evidence-backed probes that reuse the existing HTTP tool.
 */

import { z } from 'zod'
import { httpRequest } from '../../src/tools/http-tools'

async function doRequest(opts: {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
}): Promise<{ ok: boolean; status?: number; body?: string; headers?: Record<string, string>; error?: string }> {
  try {
    const r: any = await (httpRequest as any).execute(opts)
    if (!r?.ok) return { ok: false, error: r?.error ?? 'request failed' }
    return { ok: true, status: r.value?.status, body: r.value?.body, headers: r.value?.headers }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) }
  }
}

/** Detect HTTP request smuggling (CL/TE desync) via conflicting length headers. */
const detectSmuggling = {
  description: 'HTTP request smuggling probe (CL/TE desync): send requests with conflicting Content-Length and Transfer-Encoding and compare responses for desync.',
  inputSchema: z.object({
    url: z.string().describe('Target base URL, e.g. https://host/api'),
    headerName: z.string().default('X-Smuggle').describe('A header echoed by the app (used to detect reflection)'),
  }),
  execute: async (input: Record<string, any>) => {
    const url = input.url as string
    const probe = input.headerName as string
    const a = await doRequest({ method: 'POST', url, headers: { 'Content-Length': '0', 'Transfer-Encoding': 'chunked' }, body: `${probe}: smuggle` })
    const b = await doRequest({ method: 'POST', url, headers: { 'Content-Length': '6', 'Transfer-Encoding': 'chunked' }, body: `0\r\n\r\n` })
    const reflected = (a.body ?? '').includes(`${probe}:`) || (b.body ?? '').includes(`${probe}:`)
    const divergent = (a.status ?? 0) !== (b.status ?? 0)
    const vulnerable = reflected || divergent
    return {
      content: {
        type: 'text',
        text: `smuggling probe: reflected=${reflected} divergentStatus=${divergent} vulnerable=${vulnerable}\nA=${a.status} B=${b.status}`,
      },
    }
  },
}

/** Probe cache poisoning via unkeyed/inherited headers (X-Forwarded-Host, X-Original-URL, X-Host). */
const probeCachePoisoning = {
  description: 'Cache poisoning probe: send unkeyed headers (X-Forwarded-Host, X-Original-URL, X-Host) and detect if their value is reflected in the response (poisonable cache key).',
  inputSchema: z.object({
    url: z.string().describe('Target URL'),
    poison: z.string().default('evil-host.attacker').describe('Value to inject via unkeyed headers'),
  }),
  execute: async (input: Record<string, any>) => {
    const url = input.url as string
    const poison = input.poison as string
    const headers = {
      'X-Forwarded-Host': poison,
      'X-Original-URL': `/${poison}`,
      'X-Host': poison,
    }
    const r = await doRequest({ method: 'GET', url, headers })
    const reflected = (r.body ?? '').includes(poison)
    return {
      content: {
        type: 'text',
        text: `cache-poisoning probe: reflected=${reflected} status=${r.status} ${r.error ?? ''}`,
      },
    }
  },
}

/** GraphQL introspection probe (schema disclosure). */
const graphqlIntrospect = {
  description: 'GraphQL introspection probe: POST an introspection query and report whether the full schema is exposed.',
  inputSchema: z.object({
    url: z.string().describe('GraphQL endpoint URL'),
  }),
  execute: async (input: Record<string, any>) => {
    const url = input.url as string
    const query = 'query { __schema { types { name fields { name } } } }'
    const r = await doRequest({ method: 'POST', url, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
    const exposed = (r.body ?? '').includes('"__schema"') || (r.body ?? '').includes('"types"')
    return {
      content: {
        type: 'text',
        text: `graphql introspection: exposed=${exposed} status=${r.status} ${r.error ?? ''}`,
      },
    }
  },
}

export function register(): { tools: Record<string, unknown> } {
  return {
    tools: {
      detectSmuggling,
      probeCachePoisoning,
      graphqlIntrospect,
    },
  }
}
