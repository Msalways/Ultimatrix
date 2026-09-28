import { HttpClient } from './client'
import { isBountyProfile } from '../safety/bounty-policy'
import { getEngagementServices } from '../runtime/engagement-context'

export interface SessionCookieMeta {
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expires?: number
}

export interface Session {
  name: string
  baseUrl: string
  cookies: Record<string, string>
  cookieMeta?: Record<string, SessionCookieMeta>
  token: string | null
  createdAt: number
  lastUsed: number
}

export class SessionManager {
  private sessions = new Map<string, Session>()
  private clients = new Map<string, HttpClient>()

  createSession(name: string, baseUrl: string): Session {
    const session: Session = {
      name,
      baseUrl,
      cookies: {},
      token: null,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    }

    this.sessions.set(name, session)
    this.clients.set(name, new HttpClient(baseUrl))

    return session
  }

  setCookie(sessionName: string, name: string, value: string, meta: SessionCookieMeta = {}): void {
    const session = this.sessions.get(sessionName)
    if (!session) return
    session.cookies[name] = value
    session.cookieMeta ??= {}
    session.cookieMeta[name] = meta
  }

  getSession(name: string): Session | undefined {
    const session = this.sessions.get(name)
    if (session) {
      session.lastUsed = Date.now()
    }
    return session
  }

  getClient(name: string): HttpClient | undefined {
    return this.clients.get(name)
  }

  extractCookies(sessionName: string, response: { headers: Record<string, string> }): void {
    const session = this.sessions.get(sessionName)
    if (!session) return

    const setCookie = response.headers['set-cookie']
    if (!setCookie) return

    const cookies = setCookie.split(',')
    for (const cookie of cookies) {
      const [pair, ...attributes] = cookie.split(';')
      const parts = pair.trim().split('=')
      const [name, ...valueParts] = parts
      if (name && valueParts.length > 0) {
        const meta: SessionCookieMeta = {}
        for (const attribute of attributes) {
          const [key, ...rest] = attribute.trim().split('=')
          const normalized = key.toLowerCase()
          if (normalized === 'domain') meta.domain = rest.join('=')
          if (normalized === 'path') meta.path = rest.join('=')
          if (normalized === 'secure') meta.secure = true
          if (normalized === 'httponly') meta.httpOnly = true
          if (normalized === 'max-age' && Number.isFinite(Number(rest[0]))) meta.expires = Math.floor(Date.now() / 1000) + Number(rest[0])
        }
        this.setCookie(sessionName, name.trim(), valueParts.join('=').trim(), meta)
      }
    }

    // Update client
    const client = this.clients.get(sessionName)
    if (client) {
      for (const [name, value] of Object.entries(session.cookies)) {
        client.setCookie(name, value)
      }
    }
  }

  setToken(sessionName: string, token: string): void {
    const session = this.sessions.get(sessionName)
    if (session) {
      session.token = token
    }

    const client = this.clients.get(sessionName)
    if (client) {
      client.setToken(token)
    }
  }

  removeSession(name: string): void {
    this.sessions.delete(name)
    this.clients.delete(name)
  }

  listSessions(): string[] {
    return Array.from(this.sessions.keys())
  }

  exportSession(name: string): Session | undefined {
    return this.sessions.get(name)
  }

  importSession(session: Session): void {
    this.sessions.set(session.name, session)

    const client = new HttpClient(session.baseUrl)
    for (const [name, value] of Object.entries(session.cookies)) {
      client.setCookie(name, value)
    }
    if (session.token) {
      client.setToken(session.token)
    }
    this.clients.set(session.name, client)
  }

  /** Enforce that a captured actor session is only used against its origin. */
  assertOrigin(sessionName: string, targetUrl: string): void {
    const session = this.sessions.get(sessionName)
    if (!session) throw new Error(`Actor session not found: ${sessionName}`)
    try {
      const sessionOrigin = new URL(session.baseUrl).origin
      const targetOrigin = new URL(targetUrl).origin
      if (sessionOrigin !== targetOrigin) {
        throw new Error(`Actor session origin mismatch: ${sessionName} is bound to ${sessionOrigin}, refusing ${targetOrigin}`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Actor session origin mismatch')) throw error
      throw new Error(`Actor session has an invalid origin binding: ${sessionName}`)
    }
  }

  private cookieApplies(cookieName: string, targetUrl: string | undefined, session: Session): boolean {
    const meta = session.cookieMeta?.[cookieName]
    if (!meta || !targetUrl) return true
    let parsed: URL
    try { parsed = new URL(targetUrl) } catch { return false }
    const host = parsed.hostname.toLowerCase()
    const domain = meta.domain?.replace(/^\./, '').toLowerCase()
    if (domain && host !== domain && !host.endsWith(`.${domain}`)) return false
    const path = meta.path || '/'
    if (parsed.pathname !== path && !parsed.pathname.startsWith(path.endsWith('/') ? path : `${path}/`)) return false
    if (meta.secure && parsed.protocol !== 'https:') return false
    if (meta.expires !== undefined && meta.expires <= Math.floor(Date.now() / 1000)) return false
    return true
  }

  getAllHeaders(sessionName: string, targetUrl?: string): Record<string, string> {
    const session = this.sessions.get(sessionName)
    if (!session) return {}
    if (targetUrl) this.assertOrigin(sessionName, targetUrl)

    const headers: Record<string, string> = {}

    if (session.token) {
      headers['Authorization'] = `Bearer ${session.token}`
    }

    if (Object.keys(session.cookies).length > 0) {
      const applicable = Object.entries(session.cookies)
        .filter(([name]) => this.cookieApplies(name, targetUrl, session))
        .map(([k, v]) => `${k}=${v}`)
      if (applicable.length > 0) headers['Cookie'] = applicable.join('; ')
    }

    return headers
  }
}

let _globalSessionManager: SessionManager | null = null

export function getGlobalSessionManager(): SessionManager {
  const owned = getEngagementServices()?.httpSessions
  if (owned) return owned
  if (isBountyProfile()) {
    throw new Error('Bounty engagements require an engagement-scoped SessionManager; refusing the process-global session store')
  }
  if (!_globalSessionManager) {
    _globalSessionManager = new SessionManager()
  }
  return _globalSessionManager
}
