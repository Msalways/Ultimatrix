/**
 * rawHttpClient — raw-socket HTTP transport with manual framing.
 *
 * fetch() cannot express CL+TE smuggling, custom methods, or deliver raw binary
 * (gadget) bodies. This tool opens a raw TCP socket (Node net/http) to the
 * target and writes a caller-supplied request PREAMBLE verbatim, so advanced
 * transport attacks (HTTP request smuggling, binary deserialization blobs) are
 * exercised on the real wire — not via a from-scratch subset of fetch.
 *
 * Scope-guarded: the resolved host must be in scope. The preamble is the
 * caller's responsibility (no magic rewriting), preserving spec fidelity.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import net from 'node:net'
import { isUrlInScope } from '../safety/scope-guard'

function parseTarget(url: string): { host: string; port: number; tls: boolean } {
  const u = new URL(url)
  const tls = u.protocol === 'https:'
  const port = u.port ? parseInt(u.port, 10) : (tls ? 443 : 80)
  return { host: u.hostname, port, tls }
}

export const rawHttpClient = createTool({
  id: 'rawHttpClient',
  description:
    'Send a raw, manually-framed HTTP request over a TCP socket. Use for HTTP request smuggling (CL/TE) and binary/gadget payload delivery that fetch cannot express. You supply the verbatim request preamble (request-line + headers + body). Scope-guarded.',
  inputSchema: z.object({
    url: z.string().url().describe('Target base URL (host resolved from this). Request-line path comes from the preamble.'),
    preamble: z.string().describe('Verbatim HTTP request text: request line + headers + CRLF CRLF + optional body. Written as-is to the socket.'),
    timeoutMs: z.number().optional().default(8000).describe('Socket timeout.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    rawResponse: z.string().optional(),
    error: z.string().optional(),
    socketClosed: z.boolean().optional(),
  }),
  execute: async (ctx) => {
    const scope = isUrlInScope(ctx.url)
    if (!scope.allowed) return { ok: false, error: `out of scope: ${scope.reason}`, socketClosed: true }

    const { host, port, tls } = parseTarget(ctx.url)
    const socket = tls
      ? (await import('node:tls')).connect({ host, port, rejectUnauthorized: false })
      : net.connect({ host, port })

    return new Promise((resolve) => {
      let buf = ''
      let settled = false
      const finish = (out: { ok: boolean; rawResponse?: string; error?: string; socketClosed?: boolean }) => {
        if (settled) return
        settled = true
        try { socket.destroy() } catch { /* ignore */ }
        resolve(out)
      }
      socket.setTimeout(ctx.timeoutMs ?? 8000, () => finish({ ok: false, error: 'timeout', socketClosed: true }))
      socket.on('error', (e) => finish({ ok: false, error: e.message }))
      socket.on('data', (d) => { buf += d.toString('latin1'); if (buf.includes('\r\n\r\n')) finish({ ok: true, rawResponse: buf }) })
      socket.on('close', () => { if (!settled) finish({ ok: buf.length > 0, rawResponse: buf, socketClosed: true }) })
      socket.write(ctx.preamble)
      // For requests with no response (e.g. smuggled prefix), close after write.
      setTimeout(() => finish({ ok: buf.length > 0, rawResponse: buf, socketClosed: true }), ctx.timeoutMs)
    })
  },
})
