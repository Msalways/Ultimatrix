import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { getTargetWorkspaceDir } from '../workspace'

const SESSION_FILE = 'web-session.json'
const HIDDEN_FILE = '.web-session-hidden.json'

export interface PersistedWebSession {
  target: string
  sessionId: string
  createdAt: number
  lastActiveAt: number
}

function slugifyTarget(target: string): string {
  return target
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

export function webSessionId(target: string): string {
  return `web-${slugifyTarget(target)}`
}

function sessionPath(target: string): string {
  return resolve(getTargetWorkspaceDir(target), SESSION_FILE)
}

function hiddenPath(target: string): string {
  return resolve(getTargetWorkspaceDir(target), HIDDEN_FILE)
}

function coerceSession(value: unknown): PersistedWebSession | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.target !== 'string' || candidate.target.trim().length === 0) return null

  const target = candidate.target
  return {
    target,
    sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : webSessionId(target),
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
    lastActiveAt: typeof candidate.lastActiveAt === 'number' ? candidate.lastActiveAt : Date.now(),
  }
}

export async function persistWebSession(target: string): Promise<PersistedWebSession> {
  const now = Date.now()
  const dir = getTargetWorkspaceDir(target)
  await mkdir(dir, { recursive: true })

  let existing: PersistedWebSession | null = null
  try {
    existing = coerceSession(JSON.parse(await readFile(sessionPath(target), 'utf8')))
  } catch {}

  const session: PersistedWebSession = {
    target,
    sessionId: webSessionId(target),
    createdAt: existing?.createdAt ?? now,
    lastActiveAt: now,
  }

  await writeFile(sessionPath(target), JSON.stringify(session, null, 2), 'utf8')
  await writeFile(hiddenPath(target), JSON.stringify({ hidden: false, target, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
  return session
}

export async function hideWebSession(target: string): Promise<void> {
  const dir = getTargetWorkspaceDir(target)
  await mkdir(dir, { recursive: true })
  await writeFile(hiddenPath(target), JSON.stringify({ hidden: true, target, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
}

async function isHiddenTargetDir(dir: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(resolve(dir, HIDDEN_FILE), 'utf8'))
    return parsed?.hidden === true
  } catch {
    return false
  }
}

async function readSessionFromDir(dir: string): Promise<PersistedWebSession | null> {
  if (await isHiddenTargetDir(dir)) return null

  try {
    const session = coerceSession(JSON.parse(await readFile(resolve(dir, SESSION_FILE), 'utf8')))
    if (session) return session
  } catch {}

  try {
    const history = JSON.parse(await readFile(resolve(dir, 'web-chat-history.json'), 'utf8'))
    if (typeof history?.target === 'string') {
      return {
        target: history.target,
        sessionId: webSessionId(history.target),
        createdAt: Date.parse(history.updatedAt) || Date.now(),
        lastActiveAt: Date.parse(history.updatedAt) || Date.now(),
      }
    }
  } catch {}

  return null
}

export async function listPersistedWebSessions(): Promise<PersistedWebSession[]> {
  const outputDir = resolve(process.cwd(), 'output')
  if (!existsSync(outputDir)) return []

  const entries = await readdir(outputDir, { withFileTypes: true })
  const sessions: PersistedWebSession[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'global' || entry.name === 'tenants') continue

    const session = await readSessionFromDir(resolve(outputDir, basename(entry.name)))
    if (!session || seen.has(session.target)) continue
    seen.add(session.target)
    sessions.push(session)
  }

  return sessions.sort((a, b) => a.lastActiveAt - b.lastActiveAt)
}
