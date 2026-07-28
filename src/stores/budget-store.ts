import { create } from 'zustand'

interface BudgetState {
  phase: string | null
  step: number
  tokensUsed: number
  tokensMax: number
  durationMs: number
  findingsCount: number
  toolCallsCount: number
  isRunning: boolean

  setPhase: (phase: string, step?: number) => void
  incrementTokens: (amount: number) => void
  incrementToolCalls: (count?: number) => void
  incrementFindings: (count?: number) => void
  setDuration: (ms: number) => void
  setRunning: (running: boolean) => void
  reset: () => void
}

export const useBudgetStore = create<BudgetState>((set) => ({
  phase: null,
  step: 0,
  tokensUsed: 0,
  tokensMax: 100_000,
  durationMs: 0,
  findingsCount: 0,
  toolCallsCount: 0,
  isRunning: false,

  setPhase: (phase, step = 0) => set({ phase, step }),
  incrementTokens: (amount) => set((s) => ({ tokensUsed: s.tokensUsed + amount })),
  incrementToolCalls: (count = 1) => set((s) => ({ toolCallsCount: s.toolCallsCount + count })),
  incrementFindings: (count = 1) => set((s) => ({ findingsCount: s.findingsCount + count })),
  setDuration: (ms) => set({ durationMs: ms }),
  setRunning: (running) => set({ isRunning: running }),
  reset: () => set({ phase: null, step: 0, tokensUsed: 0, durationMs: 0, findingsCount: 0, toolCallsCount: 0, isRunning: false }),
}))
