import { EventEmitter } from 'node:events'

// ────────────────────────────────────────────────────────────────
// Event Map — every event type in the system, typed at the seam.
// No regex, no substring detection, no hardcoded enumerations.
// ────────────────────────────────────────────────────────────────

export interface EventMap {
  // ── A. Solver Events ──────────────────────────────────────
  'solver:start': { target: string; engine: string; model?: string; timestamp: number }
  'solver:phase': { phase: string; step: number; text?: string; timestamp: number }
  'solver:reasoning': { text: string; index: number; timestamp: number }
  'solver:answer': { text: string; index: number; timestamp: number }
  'solver:complete': { completed: boolean; reason: string; steps: number; toolCalls: number; tokensUsed: number; durationMs: number; timestamp: number }
  'solver:stale': { reason: string; stepCount: number; lastUsefulStep: number; timestamp: number }
  'solver:interrupt': { reason: string; prompt?: string; timestamp: number }

  // ── B. Tool Events (enriched with worker context) ─────────
  'tool:call': { toolName: string; args?: Record<string, unknown>; workerId?: string; workerName?: string; workerSkill?: string; timestamp: number }
  'tool:result': { toolName: string; ok: boolean; result?: string; durationMs?: number; workerId?: string; workerName?: string; timestamp: number }
  'tool:error': { toolName: string; error: string; workerId?: string; workerName?: string; timestamp: number }
  'tool:progress': { toolName: string; phase: string; detail?: string; workerId?: string; timestamp: number }

  // ── C. Worker Events ──────────────────────────────────────
  'worker:spawned': { workerId: string; workerName: string; skillId: string; task: string; endpointId?: string; tier?: string; modelId?: string; tokenBudget?: number; timestamp: number }
  'worker:started': { workerId: string; workerName: string; skillId: string; task: string; timestamp: number }
  'worker:tool-call': { workerId: string; workerName: string; skillId: string; toolName: string; args?: Record<string, unknown>; timestamp: number }
  'worker:tool-result': { workerId: string; workerName: string; skillId: string; toolName: string; ok: boolean; durationMs?: number; timestamp: number }
  'worker:progress': { workerId: string; workerName: string; skillId: string; phase: string; detail?: string; step?: number; timestamp: number }
  'worker:completed': { workerId: string; workerName: string; skillId: string; task: string; status: string; result?: unknown; durationMs?: number; graphDiff?: { nodesAdded: number; findingsAdded: number }; timestamp: number }
  'worker:error': { workerId: string; workerName: string; skillId: string; task: string; error: string; durationMs?: number; timestamp: number }
  'worker:timeout': { workerId: string; workerName: string; skillId: string; task: string; timeoutMs: number; durationMs: number; timestamp: number }
  'worker:killed': { workerId: string; workerName: string; skillId: string; reason: string; timestamp: number }
  'worker:context-budget': { workerId: string; workerName: string; skillId: string; tokenBudget?: number; tokensUsed: number; exceeded: boolean; timestamp: number }

  // ── D. Swarm Events ───────────────────────────────────────
  'swarm:started': { swarmId: string; mode: string; totalWorkers: number; tasks: Array<{ skillId: string; task: string }>; timestamp: number }
  'swarm:worker-dispatched': { swarmId: string; workerId: string; workerName: string; skillId: string; task: string; index: number; total: number; timestamp: number }
  'swarm:worker-completed': { swarmId: string; workerId: string; workerName: string; skillId: string; status: string; result?: unknown; durationMs?: number; timestamp: number }
  'swarm:completed': { swarmId: string; mode: string; totalWorkers: number; completedWorkers: number; failedWorkers: number; durationMs: number; timestamp: number }
  'swarm:sequential-next': { swarmId: string; workerId: string; workerName: string; skillId: string; task: string; priorResultsCount: number; timestamp: number }
  'swarm:parallel-progress': { swarmId: string; running: number; completed: number; failed: number; total: number; timestamp: number }

  // ── E. Intelligence Events ────────────────────────────────
  'evidence:recorded': { evidenceId: string; kind: string; workerId?: string; toolName?: string; timestamp: number }
  'evidence:verified': { claimId: string; verified: boolean; confidence: number; evidenceIds: string[]; timestamp: number }
  'evidence:rejected': { claimId: string; reason: string; workerId?: string; timestamp: number }
  'reflexion:escalation': { fromLevel: number; toLevel: number; reason: string; workerId?: string; timestamp: number }
  'reflexion:experience': { technique: string; outcome: string; lesson: string; timestamp: number }
  'anti-loop:stale': { pathId: string; staleCount: number; threshold: number; timestamp: number }
  'anti-loop:dead-end': { pathId: string; reason: string; timestamp: number }
  'hypothesis:generated': { hypothesisId: string; type: string; endpointId?: string; timestamp: number }
  'hypothesis:tested': { hypothesisId: string; outcome: string; evidenceId?: string; timestamp: number }

  // ── F. Graph Events ───────────────────────────────────────
  'graph:node-added': { nodeType: string; nodeId: string; workerId?: string; timestamp: number }
  'graph:node-updated': { nodeType: string; nodeId: string; fields: string[]; workerId?: string; timestamp: number }
  'graph:edge-added': { edgeType: string; fromId: string; toId: string; workerId?: string; timestamp: number }
  'graph:finding-added': { findingId: string; severity: string; technique: string; endpoint?: string; workerId?: string; timestamp: number }
  'graph:attack-added': { attackId: string; technique: string; endpointId: string; workerId?: string; timestamp: number }
  'graph:mutated': { action: string; nodeType: string; count: number; workerId?: string; timestamp: number }

  // ── G. Browser Events ─────────────────────────────────────
  'browser:navigate': { url: string; status: number; workerId?: string; timestamp: number }
  'browser:reaction': { type: string; description: string; elements: number; workerId?: string; timestamp: number }
  'browser:dialog': { dialogType: string; message: string; autoAccepted: boolean; workerId?: string; timestamp: number }
  'browser:console': { level: string; text: string; workerId?: string; timestamp: number }
  'browser:auth-detected': { flowType: string; details: string; workerId?: string; timestamp: number }
  'browser:bot-detected': { provider: string; details: string; timestamp: number }
  'browser:bot-resolved': { provider: string; waitMs: number; timestamp: number }

  // ── H. Finding Events ─────────────────────────────────────
  'finding:discovered': { findingId: string; severity: string; technique: string; endpoint?: string; workerId?: string; source: string; timestamp: number }
  'finding:verified': { findingId: string; verifiedBy: string; confidence: number; timestamp: number }
  'finding:exploit-proof': { findingId: string; exploitProofId: string; scenario: string; impact: string; timestamp: number }
  'finding:status-changed': { findingId: string; from: string; to: string; workerId?: string; timestamp: number }
  'finding:chain-detected': { chainId: string; findingIds: string[]; steps: number; timestamp: number }

  // ── I. Session Events ─────────────────────────────────────
  'session:init': { target: string; engine: string; model?: string; skills: string[]; timestamp: number }
  'session:config': { provider: string; model: string; engine: string; timestamp: number }
  'session:error': { phase: string; error: string; recoverable: boolean; timestamp: number }
  'session:complete': { durationMs: number; findings: number; nodes: number; toolCalls: number; timestamp: number }
  'session:spider-progress': { url: string; pages: number; endpoints: number; status: number; timestamp: number }

  // ── J. Spider Events ──────────────────────────────────────
  'spider:start': { target: string; maxPages: number; maxDurationMs: number; timestamp: number }
  'spider:page': { url: string; status: number; links: number; forms: number; timestamp: number }
  'spider:endpoint': { method: string; url: string; params: string[]; timestamp: number }
  'spider:complete': { pages: number; endpoints: number; durationMs: number; timestamp: number }
  'spider:error': { url: string; error: string; timestamp: number }

  // ── Legacy (kept for back-compat) ─────────────────────────
  'activity:start': { worker: string; task: string }
  'activity:complete': { worker: string; result: string }
  'activity:error': { worker: string; error: string }
  'finding': { technique: string; severity: string; endpoint: string }
  'graph:update': { action: string; nodeType: string }
  'spider:progress': { url: string; status: number }
  'recorder:interaction': { type: string; description: string }
}

type EventPayload<E extends keyof EventMap> = EventMap[E]

class TypedEventEmitter {
  private emitter = new EventEmitter()

  on<E extends keyof EventMap>(event: E, listener: (payload: EventPayload<E>) => void): void {
    this.emitter.on(event, listener)
  }

  off<E extends keyof EventMap>(event: E, listener: (payload: EventPayload<E>) => void): void {
    this.emitter.off(event, listener)
  }

  emit<E extends keyof EventMap>(event: E, payload: EventPayload<E>): boolean {
    return this.emitter.emit(event, payload)
  }

  once<E extends keyof EventMap>(event: E, listener: (payload: EventPayload<E>) => void): void {
    this.emitter.once(event, listener)
  }

  removeAllListeners<E extends keyof EventMap>(event?: E): void {
    if (event) {
      this.emitter.removeAllListeners(event as string)
    } else {
      this.emitter.removeAllListeners()
    }
  }

  listenerCount<E extends keyof EventMap>(event: E): number {
    return this.emitter.listenerCount(event as string)
  }
}

let _globalEmitter: TypedEventEmitter | null = null

export function getGlobalEmitter(): TypedEventEmitter {
  if (!_globalEmitter) {
    _globalEmitter = new TypedEventEmitter()
  }
  return _globalEmitter
}

// ────────────────────────────────────────────────────────────────
// Convenience emit functions — one per event category.
// All use structured typed fields, no string parsing.
// ────────────────────────────────────────────────────────────────

// A. Solver
export function emitSolverStart(target: string, engine: string, model?: string): void {
  getGlobalEmitter().emit('solver:start', { target, engine, model, timestamp: Date.now() })
}
export function emitSolverPhase(phase: string, step: number, text?: string): void {
  getGlobalEmitter().emit('solver:phase', { phase, step, text, timestamp: Date.now() })
}
export function emitSolverComplete(completed: boolean, reason: string, steps: number, toolCalls: number, tokensUsed: number, durationMs: number): void {
  getGlobalEmitter().emit('solver:complete', { completed, reason, steps, toolCalls, tokensUsed, durationMs, timestamp: Date.now() })
}
export function emitSolverStale(reason: string, stepCount: number, lastUsefulStep: number): void {
  getGlobalEmitter().emit('solver:stale', { reason, stepCount, lastUsefulStep, timestamp: Date.now() })
}
export function emitSolverInterrupt(reason: string, prompt?: string): void {
  getGlobalEmitter().emit('solver:interrupt', { reason, prompt, timestamp: Date.now() })
}

// B. Tool
export function emitToolCall(toolName: string, args?: Record<string, unknown>, workerContext?: { workerId: string; workerName: string; workerSkill?: string }): void {
  getGlobalEmitter().emit('tool:call', { toolName, args, ...workerContext, timestamp: Date.now() })
}
export function emitToolResult(toolName: string, ok: boolean, result?: string, durationMs?: number, workerContext?: { workerId: string; workerName: string }): void {
  getGlobalEmitter().emit('tool:result', { toolName, ok, result, durationMs, ...workerContext, timestamp: Date.now() })
}
export function emitToolError(toolName: string, error: string, workerContext?: { workerId: string; workerName: string }): void {
  getGlobalEmitter().emit('tool:error', { toolName, error, ...workerContext, timestamp: Date.now() })
}
export function emitToolProgress(toolName: string, phase: string, detail?: string, workerId?: string): void {
  getGlobalEmitter().emit('tool:progress', { toolName, phase, detail, workerId, timestamp: Date.now() })
}

// C. Worker
export function emitWorkerSpawned(workerId: string, workerName: string, skillId: string, task: string, opts?: { endpointId?: string; tier?: string; modelId?: string; tokenBudget?: number }): void {
  getGlobalEmitter().emit('worker:spawned', { workerId, workerName, skillId, task, ...opts, timestamp: Date.now() })
}
export function emitWorkerStarted(workerId: string, workerName: string, skillId: string, task: string): void {
  getGlobalEmitter().emit('worker:started', { workerId, workerName, skillId, task, timestamp: Date.now() })
}
export function emitWorkerToolCall(workerId: string, workerName: string, skillId: string, toolName: string, args?: Record<string, unknown>): void {
  getGlobalEmitter().emit('worker:tool-call', { workerId, workerName, skillId, toolName, args, timestamp: Date.now() })
}
export function emitWorkerToolResult(workerId: string, workerName: string, skillId: string, toolName: string, ok: boolean, durationMs?: number): void {
  getGlobalEmitter().emit('worker:tool-result', { workerId, workerName, skillId, toolName, ok, durationMs, timestamp: Date.now() })
}
export function emitWorkerProgress(workerId: string, workerName: string, skillId: string, phase: string, detail?: string, step?: number): void {
  getGlobalEmitter().emit('worker:progress', { workerId, workerName, skillId, phase, detail, step, timestamp: Date.now() })
}
export function emitWorkerCompleted(workerId: string, workerName: string, skillId: string, task: string, status: string, opts?: { result?: unknown; durationMs?: number; graphDiff?: { nodesAdded: number; findingsAdded: number } }): void {
  getGlobalEmitter().emit('worker:completed', { workerId, workerName, skillId, task, status, ...opts, timestamp: Date.now() })
}
export function emitWorkerError(workerId: string, workerName: string, skillId: string, task: string, error: string, durationMs?: number): void {
  getGlobalEmitter().emit('worker:error', { workerId, workerName, skillId, task, error, durationMs, timestamp: Date.now() })
}
export function emitWorkerTimeout(workerId: string, workerName: string, skillId: string, task: string, timeoutMs: number, durationMs: number): void {
  getGlobalEmitter().emit('worker:timeout', { workerId, workerName, skillId, task, timeoutMs, durationMs, timestamp: Date.now() })
}
export function emitWorkerKilled(workerId: string, workerName: string, skillId: string, reason: string): void {
  getGlobalEmitter().emit('worker:killed', { workerId, workerName, skillId, reason, timestamp: Date.now() })
}
export function emitWorkerContextBudget(workerId: string, workerName: string, skillId: string, tokenBudget: number | undefined, tokensUsed: number, exceeded: boolean): void {
  getGlobalEmitter().emit('worker:context-budget', { workerId, workerName, skillId, tokenBudget, tokensUsed, exceeded, timestamp: Date.now() })
}

// D. Swarm
export function emitSwarmStarted(swarmId: string, mode: string, totalWorkers: number, tasks: Array<{ skillId: string; task: string }>): void {
  getGlobalEmitter().emit('swarm:started', { swarmId, mode, totalWorkers, tasks, timestamp: Date.now() })
}
export function emitSwarmWorkerDispatched(swarmId: string, workerId: string, workerName: string, skillId: string, task: string, index: number, total: number): void {
  getGlobalEmitter().emit('swarm:worker-dispatched', { swarmId, workerId, workerName, skillId, task, index, total, timestamp: Date.now() })
}
export function emitSwarmWorkerCompleted(swarmId: string, workerId: string, workerName: string, skillId: string, status: string, result?: unknown, durationMs?: number): void {
  getGlobalEmitter().emit('swarm:worker-completed', { swarmId, workerId, workerName, skillId, status, result, durationMs, timestamp: Date.now() })
}
export function emitSwarmCompleted(swarmId: string, mode: string, totalWorkers: number, completedWorkers: number, failedWorkers: number, durationMs: number): void {
  getGlobalEmitter().emit('swarm:completed', { swarmId, mode, totalWorkers, completedWorkers, failedWorkers, durationMs, timestamp: Date.now() })
}
export function emitSwarmSequentialNext(swarmId: string, workerId: string, workerName: string, skillId: string, task: string, priorResultsCount: number): void {
  getGlobalEmitter().emit('swarm:sequential-next', { swarmId, workerId, workerName, skillId, task, priorResultsCount, timestamp: Date.now() })
}
export function emitSwarmParallelProgress(swarmId: string, running: number, completed: number, failed: number, total: number): void {
  getGlobalEmitter().emit('swarm:parallel-progress', { swarmId, running, completed, failed, total, timestamp: Date.now() })
}

// E. Intelligence
export function emitEvidenceRecorded(evidenceId: string, kind: string, workerId?: string, toolName?: string): void {
  getGlobalEmitter().emit('evidence:recorded', { evidenceId, kind, workerId, toolName, timestamp: Date.now() })
}
export function emitEvidenceVerified(claimId: string, verified: boolean, confidence: number, evidenceIds: string[]): void {
  getGlobalEmitter().emit('evidence:verified', { claimId, verified, confidence, evidenceIds, timestamp: Date.now() })
}
export function emitEvidenceRejected(claimId: string, reason: string, workerId?: string): void {
  getGlobalEmitter().emit('evidence:rejected', { claimId, reason, workerId, timestamp: Date.now() })
}
export function emitReflexionEscalation(fromLevel: number, toLevel: number, reason: string, workerId?: string): void {
  getGlobalEmitter().emit('reflexion:escalation', { fromLevel, toLevel, reason, workerId, timestamp: Date.now() })
}
export function emitReflexionExperience(technique: string, outcome: string, lesson: string): void {
  getGlobalEmitter().emit('reflexion:experience', { technique, outcome, lesson, timestamp: Date.now() })
}
export function emitAntiLoopStale(pathId: string, staleCount: number, threshold: number): void {
  getGlobalEmitter().emit('anti-loop:stale', { pathId, staleCount, threshold, timestamp: Date.now() })
}
export function emitAntiLoopDeadEnd(pathId: string, reason: string): void {
  getGlobalEmitter().emit('anti-loop:dead-end', { pathId, reason, timestamp: Date.now() })
}
export function emitHypothesisGenerated(hypothesisId: string, type: string, endpointId?: string): void {
  getGlobalEmitter().emit('hypothesis:generated', { hypothesisId, type, endpointId, timestamp: Date.now() })
}
export function emitHypothesisTested(hypothesisId: string, outcome: string, evidenceId?: string): void {
  getGlobalEmitter().emit('hypothesis:tested', { hypothesisId, outcome, evidenceId, timestamp: Date.now() })
}

// F. Graph
export function emitGraphNodeAdded(nodeType: string, nodeId: string, workerId?: string): void {
  getGlobalEmitter().emit('graph:node-added', { nodeType, nodeId, workerId, timestamp: Date.now() })
}
export function emitGraphEdgeAdded(edgeType: string, fromId: string, toId: string, workerId?: string): void {
  getGlobalEmitter().emit('graph:edge-added', { edgeType, fromId, toId, workerId, timestamp: Date.now() })
}
export function emitGraphFindingAdded(findingId: string, severity: string, technique: string, endpoint?: string, workerId?: string): void {
  getGlobalEmitter().emit('graph:finding-added', { findingId, severity, technique, endpoint, workerId, timestamp: Date.now() })
}
export function emitGraphAttackAdded(attackId: string, technique: string, endpointId: string, workerId?: string): void {
  getGlobalEmitter().emit('graph:attack-added', { attackId, technique, endpointId, workerId, timestamp: Date.now() })
}
export function emitGraphMutated(action: string, nodeType: string, count: number, workerId?: string): void {
  getGlobalEmitter().emit('graph:mutated', { action, nodeType, count, workerId, timestamp: Date.now() })
}

// G. Browser
export function emitBrowserNavigate(url: string, status: number, workerId?: string): void {
  getGlobalEmitter().emit('browser:navigate', { url, status, workerId, timestamp: Date.now() })
}
export function emitBrowserReaction(type: string, description: string, elements: number, workerId?: string): void {
  getGlobalEmitter().emit('browser:reaction', { type, description, elements, workerId, timestamp: Date.now() })
}
export function emitBrowserDialog(dialogType: string, message: string, autoAccepted: boolean, workerId?: string): void {
  getGlobalEmitter().emit('browser:dialog', { dialogType, message, autoAccepted, workerId, timestamp: Date.now() })
}
export function emitBrowserConsole(level: string, text: string, workerId?: string): void {
  getGlobalEmitter().emit('browser:console', { level, text, workerId, timestamp: Date.now() })
}
export function emitBrowserAuthDetected(flowType: string, details: string, workerId?: string): void {
  getGlobalEmitter().emit('browser:auth-detected', { flowType, details, workerId, timestamp: Date.now() })
}
export function emitBrowserBotDetected(provider: string, details: string): void {
  getGlobalEmitter().emit('browser:bot-detected', { provider, details, timestamp: Date.now() })
}
export function emitBrowserBotResolved(provider: string, waitMs: number): void {
  getGlobalEmitter().emit('browser:bot-resolved', { provider, waitMs, timestamp: Date.now() })
}

// H. Finding
export function emitFindingDiscovered(findingId: string, severity: string, technique: string, endpoint?: string, workerId?: string, source?: string): void {
  getGlobalEmitter().emit('finding:discovered', { findingId, severity, technique, endpoint, workerId, source: source ?? 'unknown', timestamp: Date.now() })
}
export function emitFindingVerified(findingId: string, verifiedBy: string, confidence: number): void {
  getGlobalEmitter().emit('finding:verified', { findingId, verifiedBy, confidence, timestamp: Date.now() })
}
export function emitFindingStatusChanged(findingId: string, from: string, to: string, workerId?: string): void {
  getGlobalEmitter().emit('finding:status-changed', { findingId, from, to, workerId, timestamp: Date.now() })
}

// I. Session
export function emitSessionInit(target: string, engine: string, model?: string, skills: string[] = []): void {
  getGlobalEmitter().emit('session:init', { target, engine, model, skills, timestamp: Date.now() })
}
export function emitSessionConfig(provider: string, model: string, engine: string): void {
  getGlobalEmitter().emit('session:config', { provider, model, engine, timestamp: Date.now() })
}
export function emitSessionError(phase: string, error: string, recoverable: boolean): void {
  getGlobalEmitter().emit('session:error', { phase, error, recoverable, timestamp: Date.now() })
}
export function emitSessionComplete(durationMs: number, findings: number, nodes: number, toolCalls: number): void {
  getGlobalEmitter().emit('session:complete', { durationMs, findings, nodes, toolCalls, timestamp: Date.now() })
}

// J. Spider
export function emitSpiderStart(target: string, maxPages: number, maxDurationMs: number): void {
  getGlobalEmitter().emit('spider:start', { target, maxPages, maxDurationMs, timestamp: Date.now() })
}
export function emitSpiderPage(url: string, status: number, links: number, forms: number): void {
  getGlobalEmitter().emit('spider:page', { url, status, links, forms, timestamp: Date.now() })
}
export function emitSpiderEndpoint(method: string, url: string, params: string[] = []): void {
  getGlobalEmitter().emit('spider:endpoint', { method, url, params, timestamp: Date.now() })
}
export function emitSpiderComplete(pages: number, endpoints: number, durationMs: number): void {
  getGlobalEmitter().emit('spider:complete', { pages, endpoints, durationMs, timestamp: Date.now() })
}
export function emitSpiderError(url: string, error: string): void {
  getGlobalEmitter().emit('spider:error', { url, error, timestamp: Date.now() })
}

// Legacy aliases (kept for back-compat)
export function emitActivityStart(worker: string, task: string): void {
  getGlobalEmitter().emit('activity:start', { worker, task })
}
export function emitActivityComplete(worker: string, result: string): void {
  getGlobalEmitter().emit('activity:complete', { worker, result })
}
export function emitActivityError(worker: string, error: string): void {
  getGlobalEmitter().emit('activity:error', { worker, error })
}
export function emitFindingLegacy(technique: string, severity: string, endpoint: string): void {
  getGlobalEmitter().emit('finding', { technique, severity, endpoint })
}
export const emitFinding = emitFindingLegacy
export function emitGraphUpdate(action: string, nodeType: string): void {
  getGlobalEmitter().emit('graph:update', { action, nodeType })
}
export function emitSpiderProgress(url: string, status: number): void {
  getGlobalEmitter().emit('spider:progress', { url, status })
}
export function emitRecorderInteraction(type: string, description: string): void {
  getGlobalEmitter().emit('recorder:interaction', { type, description })
}

export { TypedEventEmitter }
