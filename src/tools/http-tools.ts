import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { log } from '../utils/logger'
import { getForensicLog } from './report-tools'
import { CompressionService } from '../compression/headroom-service'

export const httpRequest = createTool({
  id: 'httpRequest',
  description: 'Send an HTTP request with method/headers/body. Does NOT follow redirects.',
  inputSchema: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method'),
    url: z.string().url().describe('Target URL'),
    headers: z.record(z.string(), z.string()).optional().describe('Request headers — use getCapturedHeaders to get real auth context'),
    body: z.string().optional().describe('Request body — only valid with POST, PUT, or PATCH'),
    timeoutMs: z.number().int().positive().default(10000).describe('Timeout in milliseconds'),
  }).refine(
    (data) => !['GET', 'HEAD'].includes(data.method) || data.body === undefined,
    { message: 'GET and HEAD requests cannot have a body. Use POST/PUT/PATCH for requests with a body.' },
  ),
  execute: async ({  method, url, headers, body, timeoutMs  }) => {
    const start = performance.now()
    try {
      const fetchOpts: RequestInit = {
        method,
        headers: headers ?? {},
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs ?? 10000),
      }
      if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
        fetchOpts.body = body
      }
      const raw = await fetch(url, fetchOpts)
      const rawBody = await raw.text()
      const compressionResult = await new CompressionService().compressResponse(rawBody)
      const responseBody = compressionResult.compressed
      const resHeaders: Record<string, string> = {}
      raw.headers.forEach((v, k) => { resHeaders[k] = v })
      log.info(`httpRequest ${method} ${url} → ${raw.status}`, { method, url, status: raw.status, durationMs: performance.now() - start, bodySize: responseBody.length, compressed: compressionResult.wasCompressed, truncated: compressionResult.wasTruncated })
      // LOG-3: Record HTTP request/response with compression info
      getForensicLog()?.log({
        type: 'http-request',
        agent: 'worker',
        tool: 'httpRequest',
        args: { method, url, headers, body: body?.substring(0, 1000) },
        result: { status: raw.status, headers: resHeaders, bodyLength: responseBody.length },
        duration: Math.round(performance.now() - start),
      })
      return {
        ok: true,
        value: {
          status: raw.status,
          url,
          headers: resHeaders,
          body: responseBody,
          durationMs: performance.now() - start,
        },
      }
    } catch (e) {
      log.warn(`httpRequest ${method} ${url} failed: ${(e as Error).message}`, { method, url, error: (e as Error).message, durationMs: performance.now() - start })
      return {
        ok: false,
        error: (e as Error).message,
      }
    }
  },
})

export const multipartUpload = createTool({
  id: 'multipartUpload',
  description: 'Upload a file via multipart/form-data POST.',
  inputSchema: z.object({
    url: z.string().url().describe('Target URL'),
    filename: z.string().describe('Filename for the uploaded file'),
    contentType: z.string().default('application/octet-stream').describe('MIME type of the file content'),
    content: z.string().describe('File content as string'),
    headers: z.record(z.string(), z.string()).optional().describe('Additional request headers'),
  }),
  execute: async ({  url, filename, contentType, content, headers  }) => {
    const start = performance.now()
    try {
      const formData = new FormData()
      const blob = new Blob([content], { type: contentType })
      formData.append('file', blob, filename)
      const reqHeaders: Record<string, string> = { ...(headers ?? {}) }
      delete reqHeaders['content-type']
      delete reqHeaders['Content-Type']
      const raw = await fetch(url, {
        method: 'POST',
        headers: reqHeaders,
        body: formData,
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      })
      const responseBody = (await new CompressionService().compressResponse(await raw.text())).compressed
      const resHeaders: Record<string, string> = {}
      raw.headers.forEach((v, k) => { resHeaders[k] = v })
      log.info(`multipartUpload POST ${url} (file=${filename}) → ${raw.status}`, { method: 'POST', url, filename, status: raw.status, durationMs: performance.now() - start, bodySize: responseBody.length })
      return {
        ok: true,
        value: {
          status: raw.status,
          url,
          headers: resHeaders,
          body: responseBody,
          durationMs: performance.now() - start,
        },
      }
    } catch (e) {
      log.warn(`multipartUpload POST ${url} failed: ${(e as Error).message}`, { url, filename, error: (e as Error).message, durationMs: performance.now() - start })
      return {
        ok: false,
        error: (e as Error).message,
      }
    }
  },
})

export const followRedirects = createTool({
  id: 'followRedirects',
  description: 'Follow 3xx redirects from a URL up to maxHops and return the final response.',
  inputSchema: z.object({
    url: z.string().url().describe('Starting URL'),
    headers: z.record(z.string(), z.string()).optional().describe('Request headers'),
    maxHops: z.number().int().positive().default(5).describe('Maximum number of redirects to follow'),
  }),
  execute: async ({  url, headers, maxHops  }) => {
    const start = performance.now()
    let currentUrl = url
    let hops = 0
    try {
      while (hops < (maxHops ?? 5)) {
        const fetchOpts: RequestInit = {
          method: 'GET',
          headers: headers ?? {},
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        }
        const raw = await fetch(currentUrl, fetchOpts)
        const isRedirect = raw.status >= 300 && raw.status < 400
        const location = raw.headers.get('location')
        if (!isRedirect || !location) {
          const rawBody = await raw.text()
          const compressionResult = await new CompressionService().compressResponse(rawBody)
          const body = compressionResult.compressed
          const resHeaders: Record<string, string> = {}
          raw.headers.forEach((v, k) => { resHeaders[k] = v })
          log.info(`followRedirects ${url} → ${raw.status} (${hops} hops)`, { url, status: raw.status, hops, durationMs: performance.now() - start, bodySize: body.length })
          return {
            ok: true,
            value: {
              status: raw.status,
              url: currentUrl,
              headers: resHeaders,
              body,
              durationMs: performance.now() - start,
            },
          }
        }
        currentUrl = new URL(location, currentUrl).toString()
        hops++
      }
      return {
        ok: false,
        error: `Exceeded max redirect hops (${maxHops})`,
      }
    } catch (e) {
      log.warn(`followRedirects ${url} failed: ${(e as Error).message}`, { url, error: (e as Error).message, durationMs: performance.now() - start })
      return {
        ok: false,
        error: (e as Error).message,
      }
    }
  },
})

export const omitHeader = createTool({
  id: 'omitHeader',
  description: 'Send an HTTP request with a specific header removed. Pass the FULL current headers and the name of the one to strip. Useful for testing auth bypass, CSRF protection, and header-dependent security controls.',
  inputSchema: z.object({
    url: z.string().url().describe('Target URL'),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method'),
    headers: z.record(z.string(), z.string()).describe('Full current headers — the one named in headerToOmit will be removed'),
    headerToOmit: z.string().describe('Header name to remove from the request'),
    body: z.string().optional().describe('Request body'),
  }).refine(
    (data) => !['GET', 'HEAD'].includes(data.method) || data.body === undefined,
    { message: 'GET and HEAD requests cannot have a body. Use POST/PUT/PATCH for requests with a body.' },
  ),
  execute: async ({  url, method, headers, headerToOmit, body  }) => {
    const start = performance.now()
    try {
      const stripped = { ...headers }
      delete stripped[headerToOmit]
      const fetchOpts: RequestInit = {
        method,
        headers: stripped,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      }
      if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
        fetchOpts.body = body
      }
      const raw = await fetch(url, fetchOpts)
      const rawBody = await raw.text()
      const compressionResult = await new CompressionService().compressResponse(rawBody)
      const responseBody = compressionResult.compressed
      const resHeaders: Record<string, string> = {}
      raw.headers.forEach((v, k) => { resHeaders[k] = v })
      log.info(`omitHeader ${method} ${url} (omit=${headerToOmit}) → ${raw.status}`, { method, url, omittedHeader: headerToOmit, status: raw.status, durationMs: performance.now() - start, bodySize: responseBody.length })
      return {
        ok: true,
        value: {
          status: raw.status,
          url,
          headers: resHeaders,
          body: responseBody,
          durationMs: performance.now() - start,
          omittedHeader: headerToOmit,
        },
      }
    } catch (e) {
      log.warn(`omitHeader ${method} ${url} failed: ${(e as Error).message}`, { method, url, error: (e as Error).message, durationMs: performance.now() - start })
      return {
        ok: false,
        error: (e as Error).message,
      }
    }
  },
})

