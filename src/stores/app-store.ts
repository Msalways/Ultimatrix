import { create } from 'zustand'

// ── Re-export new stores ─────────────────────────────────────
export { useChatStore, type StreamMessage, type ChatMessage, type ToolCallMessage, type PhaseMessage, type ThinkingMessage, type WorkerMessage, type FindingMessage, type GraphUpdateMessage, type WarningMessage, type SummaryMessage, type ErrorMessage, nextId } from './chat-store'
export { useUIStore } from './ui-store'
export { useSessionStore, type Session } from './session-store'
export { useBudgetStore } from './budget-store'

// ── Legacy types kept for existing components ─────────────────

export type SolverPhase = 'idle' | 'observe' | 'reason' | 'explore' | 'conclude'

export interface Finding {
  id: string
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  endpoint: string
  description: string
  timestamp: number
}

export interface ToolAnimation {
  id: string
  toolName: string
  timestamp: number
  status: 'running' | 'complete' | 'error'
  workerId?: string
  workerName?: string
}

export interface VoiceCommand {
  id: string
  aliases: string[]
  group: 'navigation' | 'actions' | 'tools'
  action: () => void | Promise<void>
  description: string
}

export interface ToolCallEvent {
  toolName: string
  ok: boolean
  durationMs?: number
  timestamp: number
  args?: Record<string, unknown>
}

export interface SwarmWorker {
  id: string
  name: string
  skillId: string
  task: string
  status: 'queued' | 'running' | 'completed' | 'error' | 'timeout' | 'killed'
  startedAt: number
  completedAt?: number
  durationMs?: number
  toolCalls: ToolCallEvent[]
  result?: string
  error?: string
  graphDiff?: { nodesAdded: number; findingsAdded: number }
}

export interface SwarmState {
  swarmId: string
  mode: 'parallel' | 'sequential'
  workers: SwarmWorker[]
  totalWorkers: number
  completedWorkers: number
  failedWorkers: number
  startedAt: number
  completedAt?: number
  durationMs?: number
}

export type SwarmEventType =
  | 'worker:spawned' | 'worker:started' | 'worker:tool-call' | 'worker:tool-result'
  | 'worker:progress' | 'worker:completed' | 'worker:error' | 'worker:timeout' | 'worker:killed'
  | 'swarm:started' | 'swarm:worker-dispatched' | 'swarm:worker-completed'
  | 'swarm:completed' | 'swarm:sequential-next' | 'swarm:parallel-progress'
  | 'tool:call' | 'tool:result' | 'tool:error'
  | 'graph:finding-added' | 'graph:attack-added' | 'graph:node-added' | 'graph:edge-added'
  | 'evidence:recorded' | 'evidence:verified' | 'evidence:rejected'
  | 'finding:discovered' | 'finding:verified'
  | 'solver:start' | 'solver:phase' | 'solver:complete'
  | 'session:init' | 'session:config' | 'session:error' | 'session:complete'
  | 'spider:start' | 'spider:page' | 'spider:endpoint' | 'spider:complete'
  | 'connected' | 'heartbeat'

export interface SwarmEvent {
  _event: SwarmEventType
  timestamp: number
  [key: string]: unknown
}

// ── Legacy app state (for components that still use useAppStore) ──

interface AppState {
  target: string | null
  setTarget: (url: string) => void
  solverPhase: SolverPhase
  setSolverPhase: (phase: SolverPhase) => void
  findings: Finding[]
  addFinding: (f: Finding) => void
  setFindings: (fs: Finding[]) => void
  selectedFindingId: string | null
  selectFinding: (id: string | null) => void
  activeAnimations: ToolAnimation[]
  addAnimation: (a: ToolAnimation) => void
  removeAnimation: (id: string) => void
  voiceCommands: VoiceCommand[]
  registerCommand: (cmd: VoiceCommand) => void
  swarmConnected: boolean
  setSwarmConnected: (connected: boolean) => void
  activeSwarm: SwarmState | null
  onSwarmEvent: (event: SwarmEvent) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  target: null,
  setTarget: (url) => set({ target: url }),

  solverPhase: 'idle',
  setSolverPhase: (phase) => set({ solverPhase: phase }),

  findings: [],
  addFinding: (f) => set((s) => ({ findings: [...s.findings, f] })),
  setFindings: (fs) => set({ findings: fs }),

  selectedFindingId: null,
  selectFinding: (id) => set({ selectedFindingId: id }),

  activeAnimations: [],
  addAnimation: (a) => set((s) => ({ activeAnimations: [...s.activeAnimations, a] })),
  removeAnimation: (id) =>
    set((s) => ({ activeAnimations: s.activeAnimations.filter((a) => a.id !== id) })),

  voiceCommands: [],
  registerCommand: (cmd) =>
    set((s) => ({ voiceCommands: [...s.voiceCommands.filter((c) => c.id !== cmd.id), cmd] })),

  swarmConnected: false,
  setSwarmConnected: (connected) => set({ swarmConnected: connected }),

  activeSwarm: null,
  onSwarmEvent: (event) => {
    const state = get()
    switch (event._event) {
      case 'swarm:started':
        set({
          activeSwarm: {
            swarmId: (event.swarmId as string) || 'unknown',
            mode: (event.mode as 'parallel' | 'sequential') || 'parallel',
            workers: [],
            totalWorkers: (event.totalWorkers as number) || 0,
            completedWorkers: 0,
            failedWorkers: 0,
            startedAt: event.timestamp,
          },
          swarmConnected: true,
        })
        break
      case 'worker:spawned': {
        const swarm = state.activeSwarm
        if (!swarm) break
        const worker: SwarmWorker = {
          id: (event.workerId as string) || 'unknown',
          name: (event.workerName as string) || 'Worker',
          skillId: (event.skillId as string) || '',
          task: (event.task as string) || '',
          status: 'running',
          startedAt: event.timestamp,
          toolCalls: [],
        }
        set({ activeSwarm: { ...swarm, workers: [...swarm.workers, worker] } })
        break
      }
      case 'worker:completed': {
        const swarm = state.activeSwarm
        if (!swarm) break
        const workers = swarm.workers.map((w) =>
          w.id === event.workerId
            ? { ...w, status: 'completed' as const, completedAt: event.timestamp, durationMs: event.durationMs as number }
            : w
        )
        set({
          activeSwarm: {
            ...swarm,
            workers,
            completedWorkers: swarm.completedWorkers + 1,
          },
        })
        break
      }
      case 'swarm:completed':
        set({ swarmConnected: false })
        break
    }
  },
}))

// ── Voice command registry ────────────────────────────────────

export class VoiceCommandRegistry {
  private commands: VoiceCommand[] = []

  register(cmd: VoiceCommand) {
    this.commands.push(cmd)
  }

  match(transcript: string): VoiceCommand | null {
    const lower = transcript.toLowerCase()
    for (const cmd of this.commands) {
      if (cmd.aliases.some((a) => lower.includes(a))) {
        return cmd
      }
    }
    return null
  }

  getAll(): VoiceCommand[] {
    return [...this.commands]
  }
}

export const voiceCommandRegistry = new VoiceCommandRegistry()
