export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | object
  timeout?: number
  followRedirects?: boolean
}

export interface Response {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  url: string
  timing: number
}

export class HttpClient {
  private baseUrl: string
  private defaultHeaders: Record<string, string>
  private cookieJar: Map<string, string>
  private token: string | null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.defaultHeaders = {}
    this.cookieJar = new Map()
    this.token = null
  }

  setDefaultHeaders(headers: Record<string, string>): void {
    this.defaultHeaders = { ...this.defaultHeaders, ...headers }
  }

  setToken(token: string): void {
    this.token = token
  }

  setCookie(name: string, value: string): void {
    this.cookieJar.set(name, value)
  }

  getCookies(): Record<string, string> {
    return Object.fromEntries(this.cookieJar)
  }

  async get(url: string, options?: RequestOptions): Promise<Response> {
    return this.request(url, { ...options, method: 'GET' })
  }

  async post(url: string, options?: RequestOptions): Promise<Response> {
    return this.request(url, { ...options, method: 'POST' })
  }

  async put(url: string, options?: RequestOptions): Promise<Response> {
    return this.request(url, { ...options, method: 'PUT' })
  }

  async delete(url: string, options?: RequestOptions): Promise<Response> {
    return this.request(url, { ...options, method: 'DELETE' })
  }

  async request(url: string, options: RequestOptions = {}): Promise<Response> {
    const startTime = Date.now()
    const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`

    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...options.headers,
    }

    // Add token
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    // Add cookies
    if (this.cookieJar.size > 0) {
      const cookieStr = Array.from(this.cookieJar.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
      headers['Cookie'] = cookieStr
    }

    // Stringify body
    let body: string | undefined
    if (options.body) {
      if (typeof options.body === 'object') {
        body = JSON.stringify(options.body)
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'application/json'
        }
      } else {
        body = options.body
      }
    }

    try {
      const response = await fetch(fullUrl, {
        method: options.method || 'GET',
        headers,
        body,
        signal: AbortSignal.timeout(options.timeout || 30000),
        redirect: options.followRedirects === false ? 'manual' : 'follow',
      })

      const responseText = await response.text()
      const timing = Date.now() - startTime

      // Parse response cookies
      const setCookie = response.headers.get('set-cookie')
      if (setCookie) {
        this.parseCookies(setCookie)
      }

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseText,
        url: fullUrl,
        timing,
      }
    } catch (error) {
      const timing = Date.now() - startTime
      return {
        status: 0,
        statusText: 'Network Error',
        headers: {},
        body: (error as Error).message,
        url: fullUrl,
        timing,
      }
    }
  }

  private parseCookies(setCookieHeader: string): void {
    const cookies = setCookieHeader.split(',')
    for (const cookie of cookies) {
      const parts = cookie.split(';')[0].trim()
      const [name, ...valueParts] = parts.split('=')
      if (name && valueParts.length > 0) {
        this.cookieJar.set(name.trim(), valueParts.join('=').trim())
      }
    }
  }
}
