import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { WorkingMemoryStateSchema, buildDedupKey } from './schemas'
import type { z } from 'zod'
import type { Severity } from '../types/shared'

function memoryDir(): string {
  return resolve(process.cwd(), 'output', 'memory')
}

type WorkingMemoryState = z.infer<typeof WorkingMemoryStateSchema>

export interface ThreadMeta {
  id: string
  label: string
  createdAt: number
  updatedAt: number
  targetUrl?: string
}

export interface ThreadStore {
  activeThreadId: string
  threads: ThreadMeta[]
}

function threadPath(threadId: string): string {
  return join(memoryDir(), `${threadId}.json`)
}

function threadsIndexPath(): string {
  return join(memoryDir(), 'threads.json')
}

export async function ensureDir(): Promise<void> {
  const dir = memoryDir()
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
}

export async function loadWorkingMemory(threadId: string): Promise<WorkingMemoryState> {
  await ensureDir()
  const path = threadPath(threadId)
  if (!existsSync(path)) {
    return WorkingMemoryStateSchema.parse({})
  }
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw)
    return WorkingMemoryStateSchema.parse(parsed)
  } catch {
    return WorkingMemoryStateSchema.parse({})
  }
}

export async function saveWorkingMemory(threadId: string, state: WorkingMemoryState): Promise<void> {
  await ensureDir()
  const path = threadPath(threadId)
  await writeFile(path, JSON.stringify(state, null, 2), 'utf-8')
}

export async function addEndpointTest(
  threadId: string,
  entry: { url: string; technique: string; param?: string; result: 'vulnerable' | 'not-vulnerable' | 'in-progress' | 'error'; confidence?: number },
): Promise<void> {
  const state = await loadWorkingMemory(threadId)
  const dedupKey = buildDedupKey(entry.technique, entry.url, entry.param)
  if (!state.dedupSet.includes(dedupKey)) {
    state.dedupSet.push(dedupKey)
    state.endpointsTested.push({ ...entry, testedAt: Date.now() })
    await saveWorkingMemory(threadId, state)
  }
}

export async function addFinding(
  threadId: string,
  finding: {
    id: string
    type: string
    endpoint: string
    param?: string
    severity: Severity
    confidence: number
    confirmed: boolean
    description?: string
  },
): Promise<void> {
  const state = await loadWorkingMemory(threadId)
  state.findings.push({ ...finding, discoveredAt: Date.now() })
  await saveWorkingMemory(threadId, state)
}

export async function isAlreadyTested(threadId: string, technique: string, endpoint: string, param?: string): Promise<boolean> {
  const state = await loadWorkingMemory(threadId)
  const key = buildDedupKey(technique, endpoint, param)
  return state.dedupSet.includes(key)
}

export async function loadThreadsIndex(): Promise<ThreadStore> {
  await ensureDir()
  const path = threadsIndexPath()
  if (!existsSync(path)) {
    const defaultStore: ThreadStore = { activeThreadId: 'default', threads: [{ id: 'default', label: 'Default', createdAt: Date.now(), updatedAt: Date.now() }] }
    await writeFile(path, JSON.stringify(defaultStore, null, 2), 'utf-8')
    return defaultStore
  }
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as ThreadStore
  } catch {
    const fallback: ThreadStore = { activeThreadId: 'default', threads: [{ id: 'default', label: 'Default', createdAt: Date.now(), updatedAt: Date.now() }] }
    return fallback
  }
}

export async function saveThreadsIndex(store: ThreadStore): Promise<void> {
  await ensureDir()
  await writeFile(threadsIndexPath(), JSON.stringify(store, null, 2), 'utf-8')
}

export async function createThread(label: string, targetUrl?: string): Promise<ThreadMeta> {
  const store = await loadThreadsIndex()
  const id = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const meta: ThreadMeta = { id, label, createdAt: Date.now(), updatedAt: Date.now(), targetUrl }
  store.threads.push(meta)
  store.activeThreadId = id
  await saveThreadsIndex(store)
  return meta
}

export async function switchThread(threadId: string): Promise<boolean> {
  const store = await loadThreadsIndex()
  const exists = store.threads.some(t => t.id === threadId)
  if (!exists) return false
  store.activeThreadId = threadId
  await saveThreadsIndex(store)
  return true
}

export async function updateTarget(threadId: string, url: string): Promise<void> {
  const state = await loadWorkingMemory(threadId)
  state.target = { url, status: 'exploring', startedAt: Date.now() }
  await saveWorkingMemory(threadId, state)

  const store = await loadThreadsIndex()
  const thread = store.threads.find(t => t.id === threadId)
  if (thread) {
    thread.targetUrl = url
    thread.updatedAt = Date.now()
    await saveThreadsIndex(store)
  }
}
