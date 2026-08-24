import { create } from 'zustand'
import type { RunOutcomeKind } from '@/core/run-outcome'
import type { LoadState } from './resource-store'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface ToolCallMessage {
  id: string
  type: 'tool-call'
  name: string
  args?: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  result?: string
  duration?: number
  timestamp: number
  workerId?: string
  workerName?: string
  toolCallIndex?: number
}

export interface PhaseMessage {
  id: string
  type: 'phase'
  phase: string
  step: number
  timestamp: number
  label?: string
}

export interface ThinkingMessage {
  id: string
  type: 'thinking'
  content: string
  collapsed: boolean
  timestamp: number
}

export interface WorkerMessage {
  id: string
  type: 'worker-spawned' | 'worker-completed'
  workerId: string
  name: string
  skillId?: string
  task?: string
  status?: string
  findings?: number
  duration?: number
  timestamp: number
}

export interface FindingMessage {
  id: string
  type: 'finding'
  findingId: string
  severity: string
  technique: string
  endpoint?: string
  timestamp: number
}

export interface GraphUpdateMessage {
  id: string
  type: 'graph-update'
  nodeType: string
  nodeId: string
  label?: string
  timestamp: number
}

export interface WarningMessage {
  id: string
  type: 'warning'
  kind: string
  message: string
  timestamp: number
}

export interface SummaryMessage {
  id: string
  type: 'summary'
  content: string
  steps: number
  toolCalls: number
  findings: number
  durationMs: number
  outcome: RunOutcomeKind
  label: string
  detail: string
  reason?: string
  goal?: string
  mode?: 'ask' | 'run' | 'auto'
  timestamp: number
}

export interface ErrorMessage {
  id: string
  type: 'error'
  content: string
  goal?: string
  mode?: 'ask' | 'run' | 'auto'
  timestamp: number
}

export interface StreamStatusMessage {
  id: string
  type: 'stream-status'
  status: 'starting' | 'running' | 'aborted' | 'done'
  label: string
  timestamp: number
}

export type StreamMessage =
  | ChatMessage
  | ToolCallMessage
  | PhaseMessage
  | ThinkingMessage
  | WorkerMessage
  | FindingMessage
  | GraphUpdateMessage
  | WarningMessage
  | SummaryMessage
  | ErrorMessage
  | StreamStatusMessage

interface ChatState {
  messages: StreamMessage[]
  isStreaming: boolean
  historyState: LoadState
  setMessages: (messages: StreamMessage[]) => void
  addMessage: (msg: StreamMessage) => void
  updateMessage: (id: string, updates: Partial<StreamMessage>) => void
  removeMessage: (id: string) => void
  setStreaming: (streaming: boolean) => void
  setHistoryState: (state: LoadState) => void
  clearMessages: () => void
}

let _id = 0
function nextId(): string {
  return `msg-${Date.now()}-${++_id}`
}

export { nextId }

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  historyState: 'idle' as LoadState,

  setMessages: (messages) => set({ messages }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } as StreamMessage : m
      ),
    })),

  removeMessage: (id) =>
    set((state) => ({ messages: state.messages.filter((message) => message.id !== id) })),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  setHistoryState: (historyState) => set({ historyState }),

  clearMessages: () => set({ messages: [], isStreaming: false }),
}))
