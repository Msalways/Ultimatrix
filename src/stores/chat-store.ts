import { create } from 'zustand'

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
}

export interface PhaseMessage {
  id: string
  type: 'phase'
  phase: string
  step: number
  timestamp: number
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
  timestamp: number
}

export interface ErrorMessage {
  id: string
  type: 'error'
  content: string
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

interface ChatState {
  messages: StreamMessage[]
  isStreaming: boolean
  addMessage: (msg: StreamMessage) => void
  updateMessage: (id: string, updates: Partial<StreamMessage>) => void
  setStreaming: (streaming: boolean) => void
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

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } as StreamMessage : m
      ),
    })),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  clearMessages: () => set({ messages: [], isStreaming: false }),
}))
