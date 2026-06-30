/**
 * Encode/Decode Tool
 *
 * Built-in tool for encoding/decoding data in various formats.
 * Useful for analyzing auth tokens, decoding responses, crafting payloads.
 * All operation names and errors in English.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

function base64Encode(input: string): string {
  return Buffer.from(input, 'utf-8').toString('base64')
}

function base64Decode(input: string): string {
  return Buffer.from(input, 'base64').toString('utf-8')
}

function hexEncode(input: string): string {
  return Buffer.from(input, 'utf-8').toString('hex')
}

function hexDecode(input: string): string {
  const clean = input.replace(/^0x/i, '').replace(/\s/g, '')
  return Buffer.from(clean, 'hex').toString('utf-8')
}

function urlEncode(input: string): string {
  return encodeURIComponent(input)
}

function urlDecode(input: string): string {
  return decodeURIComponent(input)
}

function htmlEncode(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function htmlDecode(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
}

function jwtDecode(input: string): Record<string, unknown> {
  const parts = input.split('.')
  if (parts.length < 2) throw new Error('Invalid JWT: needs at least header.payload')

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'))
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))

  return {
    header,
    payload,
    signature: parts[2] || 'missing',
    note: 'Signature was NOT verified. This is a decode-only operation.',
  }
}

function autoDecode(input: string): Array<{ method: string; result: string }> {
  const results: Array<{ method: string; result: string }> = []

  try {
    const b64 = base64Decode(input)
    if (b64 !== input && /[\x20-\x7e]/.test(b64)) {
      results.push({ method: 'base64', result: b64 })
    }
  } catch { /* not base64 */ }

  try {
    const urlDecoded = urlDecode(input)
    if (urlDecoded !== input && urlDecoded.length > 0) {
      results.push({ method: 'url', result: urlDecoded })
    }
  } catch { /* not url-encoded */ }

  try {
    const hexDecoded = hexDecode(input)
    if (hexDecoded !== input && hexDecoded.length > 0 && /^[\x20-\x7e]+$/.test(hexDecoded)) {
      results.push({ method: 'hex', result: hexDecoded })
    }
  } catch { /* not hex */ }

  try {
    const htmlDecoded = htmlDecode(input)
    if (htmlDecoded !== input) {
      results.push({ method: 'html', result: htmlDecoded })
    }
  } catch { /* not html */ }

  if (input.split('.').length >= 2) {
    try {
      const jwt = jwtDecode(input)
      results.push({ method: 'jwt', result: JSON.stringify(jwt, null, 2) })
    } catch { /* not jwt */ }
  }

  return results
}

export const encodeDecode = createTool({
  id: 'encodeDecode',
  description: 'Encode or decode data in various formats: base64, hex, URL, HTML, JWT, or auto-detect.',
  inputSchema: z.object({
    operation: z.enum([
      'base64_encode', 'base64_decode',
      'hex_encode', 'hex_decode',
      'url_encode', 'url_decode',
      'html_encode', 'html_decode',
      'jwt_decode',
      'auto_decode',
    ]),
    data: z.string().describe('The data to encode or decode'),
  }),
  execute: async ({ operation, data }) => {
    try {
      switch (operation) {
        case 'base64_encode': return { ok: true, result: base64Encode(data), format: 'base64' }
        case 'base64_decode': return { ok: true, result: base64Decode(data), format: 'base64' }
        case 'hex_encode': return { ok: true, result: hexEncode(data), format: 'hex' }
        case 'hex_decode': return { ok: true, result: hexDecode(data), format: 'hex' }
        case 'url_encode': return { ok: true, result: urlEncode(data), format: 'url' }
        case 'url_decode': return { ok: true, result: urlDecode(data), format: 'url' }
        case 'html_encode': return { ok: true, result: htmlEncode(data), format: 'html' }
        case 'html_decode': return { ok: true, result: htmlDecode(data), format: 'html' }
        case 'jwt_decode': return { ok: true, result: jwtDecode(data), format: 'jwt' }
        case 'auto_decode': return { ok: true, results: autoDecode(data), format: 'auto' }
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err), operation }
    }
  },
})
