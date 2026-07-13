/**
 * Council Orchestrator (A9 + A11).
 *
 * Root-cause rewrite: parallel debate with structured output.
 *
 * Old (sequential, text-parsing):
 *   strategist speaks → skeptic verifies → analyst comments → approve → execute → next round
 *
 * New (parallel, typed fields):
 *   ALL members speak in parallel → bus collects → human reviews → execute → results debate → next turn
 *
 * Design principle: typed fields, never substring scanning of free text.
 * - Completion: `output.intent === 'complete'` (not `/DONE|COMPLETE/i.test(text)`)
 * - Impact: `proposal.proposal.impact` (not regex on text)
 * - Tasks: `proposal.proposal.{skillId,action,endpointId}` (not text parsing)
 * - Results: `reflection.{whatWorked,whatFailed,whatLearned}` (not text parsing)
 */

import { ConversationBus } from './bus'
import { SharedBlackboard } from './blackboard-shared'
import { decideApproval } from './approval'
import type {
  CouncilConfig,
  CouncilMember,
  CouncilMemberRole,
  CouncilMessage,
  DebateCycleResult,
  DebateMemory,
  MemberOutput,
  TaskComplexity,
} from './types'
import { extractStances, extractFailedApproaches, extractProvenFindings, buildMemoryPrompt } from './debate-memory'
import { verifyClaimStructured } from '../tools/control-tools'
import { bridgeWorkerEvidence, type WorkerToolCall } from './evidence-bridge'
import { EvidenceLedger } from '../intelligence/evidence-ledger'

/**
 * Wall-clock timeouts for a single debate cycle. Without these, a hung member
 * LLM call or a stalled worker dispatch wedges the ENTIRE council (B10) — the
 * process then has to be killed and the async logger swallows the error.
 */
const DEFAULT_RESPOND_TIMEOUT_MS = 120_000
const DEFAULT_EXECUTE_TIMEOUT_MS = 180_000

/**
 * Wrap a promise with a wall-clock timeout. Returns the original result if it
 * resolves within `ms`, otherwise rejects with a TimeoutError. The timer is
 * `.unref()`'d so it doesn't keep the process alive.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timeout: ${label} exceeded ${ms}ms`))
    }, ms)
  })
  if (typeof timer! === 'object' && 'unref' in timer!) timer!.unref()
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!))
}

export interface CouncilExecuteContext {
  blackboard: SharedBlackboard
  bus: ConversationBus
  round: number
}

export interface RunCouncilParams {
  members: CouncilMember[]
  bus: ConversationBus
  blackboard: SharedBlackboard
  goal: string
  config: CouncilConfig
  /** Host-supplied execution (e.g. spawn worker / run solver step). */
  execute?: (proposal: MemberOutput, ctx: CouncilExecuteContext) => Promise<string>
  /** Human approval gate for HITL / high-impact proposals. */
  humanApprove?: (proposal: MemberOutput) => Promise<boolean>
  onPhase?: (phase: string, round: number, text?: string) => void
}

/** Parameters for a single debate cycle (one REPL turn). */
export interface DebateOnceParams {
  members: CouncilMember[]
  bus: ConversationBus
  blackboard: SharedBlackboard
  goal: string
  config: CouncilConfig
  /** Evidence ledger for verifying claims and recording results. */
  ledger?: EvidenceLedger
  /** Previous results from worker execution (for results debate). */
  previousResults?: string
  /** Host-supplied execution callback. */
  execute?: (proposal: MemberOutput, ctx: CouncilExecuteContext) => Promise<string>
  /** Human approval gate for HITL / high-impact proposals. */
  humanApprove?: (proposal: MemberOutput) => Promise<boolean>
  /** Debate memory — mutable, accumulated across REPL turns. */
  debateMemory?: DebateMemory
  onPhase?: (phase: string, round: number, text?: string) => void
}

function byRole(members: CouncilMember[], role: CouncilMemberRole): CouncilMember | undefined {
  return members.find(m => m.role === role)
}

function buildGoalPrompt(
  goal: string,
  transcript: string,
  previousResults?: string,
  debateMemory?: DebateMemory,
  role?: CouncilMemberRole,
): string {
  const parts = [
    `Goal: ${goal}`,
    '',
    'Council transcript so far (sliding window):',
    transcript || '(none yet)',
  ]

  // Inject debate memory — per-role view
  if (debateMemory && role) {
    const memorySection = buildMemoryPrompt(debateMemory, role)
    if (memorySection) {
      parts.push('', memorySection)
    }
  }

  if (previousResults) {
    parts.push('', 'Previous execution results:', previousResults)
    parts.push('Analyze what worked and what failed. Propose the next step based on these results.')
  } else {
    parts.push(
      '',
      'Use your judgment as a security professional to respond to this goal.',
    )
  }

  return parts.join('\n')
}

// ─── debateOnce: single cycle, parallel, structured ────────────────────────

/**
 * Run one debate cycle: all members speak in parallel, human reviews, execute, results analysis.
 *
 * This is NOT a blocking loop — it runs one cycle and returns. The REPL calls
 * this per turn, so the human can interject between cycles.
 *
 * Parallel debate: all LLM members produce structured output simultaneously.
 * Structured synthesis: reads typed fields (intent, proposal, critique, reflection).
 * No regex on text. No substring scanning.
 */

export async function debateOnce(params: DebateOnceParams): Promise<DebateCycleResult> {
  const {
    members,
    bus,
    blackboard,
    goal,
    config,
    ledger,
    previousResults,
    execute,
    humanApprove,
    debateMemory,
    onPhase,
  } = params

  const round = bus.all().length > 0
    ? Math.max(...bus.all().map(m => m.round)) + 1
    : 1
  const llmMembers = members.filter(m => m.role !== 'human')

  // ── Phase 1: All members speak in parallel ──────────────────────────────
  onPhase?.('debate', round)
  const transcript = bus.transcript(20)

  // Build role-specific prompts with debate memory injection
  const promptMap = new Map<CouncilMemberRole, string>()
  for (const m of llmMembers) {
    promptMap.set(m.role, buildGoalPrompt(goal, transcript, previousResults, debateMemory, m.role))
  }

  const respondMs = config.respondTimeoutMs ?? DEFAULT_RESPOND_TIMEOUT_MS
  const outputs = await Promise.all(
    llmMembers.map(async (m) => {
      try {
        const prompt = promptMap.get(m.role) ?? buildGoalPrompt(goal, transcript, previousResults)
        return await withTimeout(m.respond(prompt), respondMs, `council-respond:${m.role}`)
      } catch (err: any) {
        return {
          text: `[${m.role}] Error: ${err.message}`,
          intent: 'propose' as const,
        } as MemberOutput
      }
    }),
  )

  // ── Phase 2: Post all outputs to bus + extract stances ──────────────────
  for (const output of outputs) {
    const role = llmMembers[outputs.indexOf(output)]?.role ?? 'strategist'
    const msgType = output.intent === 'critique' ? 'critique'
      : output.intent === 'complete' ? 'reflect'
      : output.intent === 'escalate' ? 'human'
      : 'proposal'
    bus.post(role, msgType, output.text, { round, claim: output.claim })

    // Extract stances and update debate memory
    if (debateMemory) {
      const stances = extractStances(output, role, round)
      debateMemory.stances.push(...stances)

      const failed = extractFailedApproaches(output, round)
      debateMemory.failedApproaches.push(...failed)

      const proven = extractProvenFindings(output, round)
      debateMemory.provenFindings.push(...proven)
    }
  }

  // ── Phase 3: Check for completion signals ───────────────────────────────
  // Completion requires: (1) a member signals 'complete', AND (2) at least one
  // execution has already happened in a previous round (we've actually done work).
  const completionSignals = outputs.filter(o => o.intent === 'complete')
  const previousExecutions = bus.all().filter(m => m.type === 'execute' && m.round < round)
  if (completionSignals.length > 0 && previousExecutions.length > 0) {
    // Aggregate reflections from all completing members
    const allWorked = completionSignals.flatMap(o => o.reflection?.whatWorked ?? [])
    const allFailed = completionSignals.flatMap(o => o.reflection?.whatFailed ?? [])
    const allLearned = completionSignals.flatMap(o => o.reflection?.whatLearned ?? [])

    const summary = [
      'Council signals completion.',
      allWorked.length > 0 ? `Worked: ${allWorked.join('; ')}` : '',
      allFailed.length > 0 ? `Failed: ${allFailed.join('; ')}` : '',
      allLearned.length > 0 ? `Learned: ${allLearned.join('; ')}` : '',
    ].filter(Boolean).join('\n')

    bus.post('strategist', 'reflect', summary, { round })

    return {
      summary,
      proposedTasks: [],
      newEvidence: 0,
      messages: bus.all(),
      complete: true,
    }
  }

  // ── Phase 4: Collect proposals (typed fields, not text parsing) ─────────
  const proposals = outputs.filter(o => o.intent === 'propose' && o.proposal)

  // ── Phase 5: Skeptic verification (structural, typed) ───────────────────
  // Only PROPOSALS THAT ASSERT A FINDING (carrying real observed facts) must be
  // gated against the evidence ledger. Plain ACTION proposals (recon / test /
  // explore) have no claim and must be approved so they can actually gather
  // evidence — otherwise the council deadlocks in a propose→reject loop with
  // zero evidence ever collected (chicken-and-egg against an empty ledger).
  const approvedProposals: MemberOutput[] = []
  const skeptic = byRole(members, 'skeptic')

  for (const proposal of proposals) {
    const claim = proposal.claim
    const assertsFinding = !!claim && !!claim.observed

    if (assertsFinding) {
      const verification = verifyClaimStructured(claim)
      if (!verification.verified) {
        bus.post('skeptic', 'reject', `Claim not supported: ${verification.missing.join(', ')}`, {
          round,
          to: 'strategist',
        })
        onPhase?.('reject', round, verification.missing.join(', '))
        continue
      }
      bus.post('skeptic', 'approve', 'Claim verified against recorded evidence.', { round })
    } else {
      bus.post('skeptic', 'approve', 'Action proposal — no evidence claim, approved to gather data.', { round })
    }
    approvedProposals.push(proposal)
  }

  // ── Phase 6: Approval gate (HITL / autonomous) ─────────────────────────
  const finalProposals: MemberOutput[] = []
  for (const proposal of approvedProposals) {
    const decision = await decideApproval({
      proposal,
      verification: { verified: true, missing: [], supporting: [] },
      approvalMode: config.approvalMode,
      humanApprove,
    })

    if (decision === 'rejected') {
      bus.post('human', 'reject', 'Human denied execution.', { round })
      onPhase?.('reject', round, 'human denied')
      continue
    }
    if (decision === 'pending-human') {
      bus.post('human', 'reject', 'High-impact proposal blocked: human approval required.', { round })
      onPhase?.('reject', round, 'no human harness')
      continue
    }
    finalProposals.push(proposal)
  }

  // ── Phase 7: Execute approved proposals ─────────────────────────────────
  let newEvidence = 0
  const executeMs = config.executeTimeoutMs ?? DEFAULT_EXECUTE_TIMEOUT_MS
  for (const proposal of finalProposals) {
    blackboard.claimIntent('operator', proposal.proposal!.action)
    bus.post('operator', 'execute', `Executing: ${proposal.proposal!.action}`, { round })

    let result = 'executed'
    if (execute) {
      try {
        result = await withTimeout(
          execute(proposal, { blackboard, bus, round }),
          executeMs,
          `council-execute:${proposal.proposal!.skillId}`,
        )
      } catch (err: any) {
        result = `execution timeout: ${err.message}`
        bus.post('operator', 'reject', result, { round })
        onPhase?.('reject', round, result)
      }
    }

    bus.post('operator', 'report', result, { round })
    onPhase?.('execute', round, result)

    // Bridge worker results → structured evidence items
    if (ledger) {
      const toolCalls: WorkerToolCall[] = [{
        toolName: 'council-execution',
        args: { skillId: proposal.proposal!.skillId, task: proposal.proposal!.action },
        result: { status: 200, url: proposal.proposal!.endpointId, body: result },
      }]
      newEvidence += bridgeWorkerEvidence(toolCalls, ledger)
    }

    blackboard.concludeIntent(
      blackboard.getIntents().find(i => i.status === 'claimed')?.id ?? '',
    )
  }

  // ── Phase 8: Results analysis (structured reflection) ───────────────────
  const reflections = outputs.filter(o => o.reflection)
  const allWhatWorked = reflections.flatMap(o => o.reflection!.whatWorked)
  const allWhatFailed = reflections.flatMap(o => o.reflection!.whatFailed)
  const allNextSteps = reflections.flatMap(o => o.reflection!.nextSteps)

  const proposedTasks = finalProposals.map(p => ({
    skillId: p.proposal!.skillId,
    task: p.proposal!.action,
    endpointId: p.proposal!.endpointId,
    complexity: p.proposal!.complexity,
  }))

  const summary = [
    `Round ${round}: ${finalProposals.length} proposals executed, ${newEvidence} evidence items recorded.`,
    allWhatWorked.length > 0 ? `Working: ${allWhatWorked.join('; ')}` : '',
    allWhatFailed.length > 0 ? `Failed: ${allWhatFailed.join('; ')}` : '',
    allNextSteps.length > 0 ? `Next: ${allNextSteps.join('; ')}` : '',
  ].filter(Boolean).join('\n')

  return {
    summary,
    proposedTasks,
    newEvidence,
    messages: bus.all(),
    complete: false,
  }
}

// ─── runCouncil: backward-compatible multi-round loop ──────────────────────

/**
 * Run multiple debate cycles in a loop (backward-compatible with old API).
 * Each cycle is a call to debateOnce(), so the human can interject between rounds.
 */
export async function runCouncil(params: RunCouncilParams): Promise<{
  rounds: number
  approved: number
  rejected: number
  messages: ReturnType<ConversationBus['all']>
  transcript: string
}> {
  const { members, bus, blackboard, goal, config, execute, humanApprove, onPhase } = params

  let completedRounds = 0
  let approved = 0
  let rejected = 0

  // Create debate memory for the multi-round loop
  const debateMemory: DebateMemory = { stances: [], failedApproaches: [], provenFindings: [] }

  for (let round = 1; round <= config.maxRounds; round++) {
    completedRounds = round

    const result = await debateOnce({
      members,
      bus,
      blackboard,
      goal,
      config,
      execute,
      humanApprove,
      debateMemory,
      onPhase,
    })

    approved += result.proposedTasks.length
    rejected += result.messages.filter(m => m.type === 'reject').length

    if (result.complete) break
  }

  return {
    rounds: completedRounds,
    approved,
    rejected,
    messages: bus.all(),
    transcript: bus.transcript(),
  }
}
