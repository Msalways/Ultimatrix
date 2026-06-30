import type { Page, Response, Request } from 'playwright'
import type { HarEntry, HarArchive } from './har-parser'
import { createEmptyHar, addEntry } from './har-parser'

export interface CaptureOptions {
  captureRequestBody?: boolean
  captureResponseBody?: boolean
  maxResponseBodySize?: number
  filterPatterns?: RegExp[]
  includeDomains?: string[]
  excludeDomains?: string[]
}

export class NetworkCapture {
  private entries: HarEntry[] = []
  private capturing = false
  private options: CaptureOptions
  private attachedPages = new Set<Page>()
  private pendingCaptures: Promise<void>[] = []

  constructor(options: CaptureOptions = {}) {
    this.options = {
      captureRequestBody: true,
      captureResponseBody: true,
      maxResponseBodySize: 1024 * 1024, // 1MB
      filterPatterns: [],
      includeDomains: [],
      excludeDomains: [],
      ...options,
    }
  }

  start(page: Page): void {
    if (this.attachedPages.has(page)) return

    this.capturing = true
    this.attachedPages.add(page)

    page.on('response', (response: Response) => {
      if (!this.capturing) return
      const promise = this.captureResponse(response).catch(() => {})
      this.pendingCaptures.push(promise)
      promise.finally(() => {
        const idx = this.pendingCaptures.indexOf(promise)
        if (idx >= 0) this.pendingCaptures.splice(idx, 1)
      })
    })
  }

  async flush(): Promise<void> {
    await Promise.all(this.pendingCaptures)
  }

  stop(): HarEntry[] {
    this.capturing = false
    this.attachedPages.clear()
    return [...this.entries]
  }

  getEntries(): HarEntry[] {
    return [...this.entries]
  }

  exportHar(): HarArchive {
    let archive = createEmptyHar()
    for (const entry of this.entries) {
      archive = addEntry(archive, entry)
    }
    return archive
  }

  clear(): void {
    this.entries = []
  }

  private async captureResponse(response: Response): Promise<void> {
    try {
      const request = response.request()
      const url = request.url()

      if (!this.shouldCapture(url)) return

      const entry = await this.buildEntry(request, response)
      if (entry) {
        this.entries.push(entry)
      }
    } catch {
      // Silently skip failed captures
    }
  }

  private shouldCapture(url: string): boolean {
    try {
      const urlObj = new URL(url)

      if (this.options.excludeDomains?.length) {
        if (this.options.excludeDomains.includes(urlObj.hostname)) return false
      }

      if (this.options.includeDomains?.length) {
        if (!this.options.includeDomains.includes(urlObj.hostname)) return false
      }

      if (this.options.filterPatterns?.length) {
        if (this.options.filterPatterns.some(p => p.test(url))) return false
      }

      return true
    } catch {
      return false
    }
  }

  private async buildEntry(request: Request, response: Response): Promise<HarEntry | null> {
    const url = request.url()
    const timing = response.request().timing()

    let requestBody: string | undefined
    if (this.options.captureRequestBody) {
      try {
        const postData = request.postData()
        if (postData) requestBody = postData
      } catch {
        // Skip request body
      }
    }

    let responseBody: string | undefined
    let responseSize = 0
    if (this.options.captureResponseBody) {
      try {
        const body = await response.body()
        responseSize = body.length
        if (responseSize <= (this.options.maxResponseBodySize || Infinity)) {
          responseBody = body.toString('utf-8')
        }
      } catch {
        // Skip response body
      }
    }

    const requestHeaders: { name: string; value: string }[] = []
    const requestHeadersObj = request.headers()
    for (const [name, value] of Object.entries(requestHeadersObj)) {
      requestHeaders.push({ name, value })
    }

    const responseHeaders: { name: string; value: string }[] = []
    const responseHeadersObj = response.headers()
    for (const [name, value] of Object.entries(responseHeadersObj)) {
      responseHeaders.push({ name, value })
    }

    const requestCookies = this.parseCookies(requestHeadersObj['cookie'] || '')
    const responseCookies = this.parseCookies(responseHeadersObj['set-cookie'] || '')

    const queryString: { name: string; value: string }[] = []
    try {
      const urlObj = new URL(url)
      for (const [name, value] of urlObj.searchParams.entries()) {
        queryString.push({ name, value })
      }
    } catch {
      // Skip query params
    }

    let postData: HarEntry['request']['postData'] | undefined
    if (requestBody) {
      postData = {
        mimeType: requestHeadersObj['content-type'] || 'application/octet-stream',
        text: requestBody,
        params: [],
      }
    }

    return {
      startedDateTime: new Date(timing.startTime || Date.now()).toISOString(),
      time: timing.responseEnd - timing.requestStart || 0,
      request: {
        method: request.method(),
        url,
        httpVersion: 'HTTP/1.1',
        cookies: requestCookies,
        headers: requestHeaders,
        queryString,
        postData,
        headersSize: -1,
        bodySize: requestBody?.length || 0,
      },
      response: {
        status: response.status(),
        statusText: response.statusText(),
        httpVersion: 'HTTP/1.1',
        cookies: responseCookies,
        headers: responseHeaders,
        content: {
          size: responseSize,
          mimeType: responseHeadersObj['content-type'] || 'application/octet-stream',
          text: responseBody,
        },
        redirectURL: responseHeadersObj['location'] || '',
        headersSize: -1,
        bodySize: responseSize,
      },
      timings: {
        send: 0,
        wait: timing.responseEnd - timing.requestStart || 0,
        receive: 0,
        blocked: timing.domainLookupStart - timing.startTime || 0,
        dns: timing.domainLookupEnd - timing.domainLookupStart || 0,
        connect: timing.connectEnd - timing.connectStart || 0,
        ssl: timing.connectEnd - timing.secureConnectionStart || 0,
      },
    }
  }

  private parseCookies(cookieHeader: string): { name: string; value: string; path?: string; domain?: string; secure?: boolean; httpOnly?: boolean }[] {
    if (!cookieHeader) return []

    return cookieHeader.split(';').map(pair => {
      const [name, ...rest] = pair.trim().split('=')
      return {
        name: name.trim(),
        value: rest.join('=').trim(),
      }
    })
  }
}
