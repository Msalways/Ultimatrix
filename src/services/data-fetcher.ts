import { sseBus, type SSEEvent } from './sse-bus'
import { useResourceStore } from '@/stores/resource-store'

export interface GraphNode { id: string; type: string; label: string; properties?: Record<string, any> }
export interface GraphEdge { source: string; target: string; type: string }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[] }

export interface FindingData {
  id?: string
  type?: string
  properties?: Record<string, any>
  severity?: string
  technique?: string
  endpoint?: string
  title?: string
  description?: string
}

export interface WorkerData {
  workerId?: string
  workerName?: string
  skillId?: string
  task?: string
  status?: string
  startedAt?: number
  completedAt?: number
  durationMs?: number
  toolCalls?: number
}

export interface SkillData {
  id: string
  name: string
  description: string
  domain: string
  tier?: string
  tags: string[]
  state?: 'available' | 'loaded'
}

export interface GraphDataResult {
  nodes: GraphNode[]
  edges: GraphEdge[]
  findings: FindingData[]
}

export interface WorkersResult {
  workers: WorkerData[]
  recent: WorkerData[]
  count: number
}

export interface StatusResult {
  ok: boolean
  targetCount?: number
  initialized?: boolean
  browser?: {
    active?: boolean
    humanCaptureActive?: boolean
    pageCount?: number
    currentUrl?: string
  }
}

export interface SessionData {
  id: string
  target: string
  createdAt: number
  lastActiveAt: number
  status: 'running' | 'idle'
}

type Unsubscribe = () => void

const mark = useResourceStore.getState().mark

class DataFetcher {
  private inflight = new Map<string, Promise<any>>()
  private cleanupFns: Unsubscribe[] = []

  private async dedup<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key)
    if (existing) return existing as T
    const promise = fn().finally(() => this.inflight.delete(key))
    this.inflight.set(key, promise)
    return promise
  }

  async loadGraphData(target: string): Promise<GraphDataResult> {
    return this.dedup(`graph:${target}`, async () => {
      mark('graph', 'loading')
      try {
        const t = encodeURIComponent(target)
        const res = await fetch(`/api/graph-data?target=${t}`)
        const json = await res.json()
        const result: GraphDataResult = {
          nodes: json.nodes ?? [],
          edges: json.edges ?? [],
          findings: Array.isArray(json.findings) ? json.findings : [],
        }
        mark('graph', 'ready')
        return result
      } catch (err) {
        mark('graph', 'error', String(err))
        return { nodes: [], edges: [], findings: [] }
      }
    })
  }

  async loadChatHistory(target: string): Promise<{ messages: unknown[] }> {
    return this.dedup(`history:${target}`, async () => {
      mark('chatHistory', 'loading')
      try {
        const res = await fetch(`/api/chat-history?target=${encodeURIComponent(target)}`)
        const data = await res.json()
        mark('chatHistory', 'ready')
        return { messages: Array.isArray(data.messages) ? data.messages : [] }
      } catch {
        mark('chatHistory', 'error')
        return { messages: [] }
      }
    })
  }

  async loadWorkers(target: string): Promise<WorkersResult> {
    return this.dedup(`workers:${target}`, async () => {
      mark('workers', 'loading')
      try {
        const res = await fetch(`/api/workers?target=${encodeURIComponent(target)}`)
        const json = await res.json()
        mark('workers', 'ready')
        return {
          workers: json.workers ?? [],
          recent: Array.isArray(json.recent) ? json.recent : json.workers ?? [],
          count: json.count ?? 0,
        }
      } catch {
        mark('workers', 'error')
        return { workers: [], recent: [], count: 0 }
      }
    })
  }

  async loadSkills(target: string): Promise<SkillData[]> {
    return this.dedup(`skills:${target}`, async () => {
      mark('skills', 'loading')
      try {
        const res = await fetch(`/api/skills?target=${encodeURIComponent(target)}`)
        const json = await res.json()
        mark('skills', 'ready')
        return Array.isArray(json.skills) ? json.skills : []
      } catch {
        mark('skills', 'error')
        return []
      }
    })
  }

  async loadStatus(target?: string | null): Promise<StatusResult> {
    return this.dedup(`status:${target ?? ''}`, async () => {
      try {
        const query = target ? `?target=${encodeURIComponent(target)}` : ''
        const res = await fetch(`/api/status${query}`)
        const data = await res.json()
        return data as StatusResult
      } catch {
        return { ok: false }
      }
    })
  }

  async loadSessions(): Promise<SessionData[]> {
    return this.dedup('sessions', async () => {
      mark('session', 'loading')
      try {
        const res = await fetch('/api/sessions')
        const data = await res.json()
        if (!Array.isArray(data.targets)) {
          mark('session', 'ready')
          return []
        }
        mark('session', 'ready')
        return data.targets.map((t: any) => ({
          id: t.engineId,
          target: t.target,
          createdAt: t.createdAt || Date.now(),
          lastActiveAt: t.lastActiveAt || Date.now(),
          status: t.running ? 'running' as const : 'idle' as const,
        }))
      } catch {
        mark('session', 'error', 'Failed to load sessions')
        return []
      }
    })
  }

  async loadTarget(target: string): Promise<{
    graph: GraphDataResult
    history: { messages: unknown[] }
    workers: WorkersResult
    skills: SkillData[]
  }> {
    const [graph, history, workers, skills] = await Promise.all([
      this.loadGraphData(target),
      this.loadChatHistory(target),
      this.loadWorkers(target),
      this.loadSkills(target),
    ])
    return { graph, history, workers, skills }
  }

  onSSE(prefix: string, cb: (evt: SSEEvent) => void, target: string | null = null): Unsubscribe {
    const unsub = sseBus.on(prefix, cb, target)
    this.cleanupFns.push(unsub)
    return unsub
  }

  cleanup() {
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
    this.inflight.clear()
  }
}

export const dataFetcher = new DataFetcher()
