import { HttpClient } from './client'

export interface Session {
  name: string
  baseUrl: string
  cookies: Record<string, string>
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
      const parts = cookie.split(';')[0].trim()
      const [name, ...valueParts] = parts.split('=')
      if (name && valueParts.length > 0) {
        session.cookies[name.trim()] = valueParts.join('=').trim()
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

  getAllHeaders(sessionName: string): Record<string, string> {
    const session = this.sessions.get(sessionName)
    if (!session) return {}

    const headers: Record<string, string> = {}

    if (session.token) {
      headers['Authorization'] = `Bearer ${session.token}`
    }

    if (Object.keys(session.cookies).length > 0) {
      headers['Cookie'] = Object.entries(session.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
    }

    return headers
  }
}

let _globalSessionManager: SessionManager | null = null

export function getGlobalSessionManager(): SessionManager {
  if (!_globalSessionManager) {
    _globalSessionManager = new SessionManager()
  }
  return _globalSessionManager
}
