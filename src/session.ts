import { log } from './utils/logger'
import { DEFAULTS } from './config'
import { NodeType } from './graph/schema'
import { SessionLifecycle, type SessionResources } from './session/lifecycle'
import { solve } from './solver/solver'
import type { SolverStreamMessage } from './solver/solver'
import { createSolverBrain } from './solver/brain-tools'
import { MAX_MODEL_ATTEMPTS, isRecoverableModelFailure, modelKey, nextConfiguredModel } from './solver/model-fallback'
import { getGlobalWorkspace } from './workspace'
import { getGlobalQuotaTracker } from './models/quota-tracker'
import { fullModelId, resolveModelRef } from './models/routing'
import { askUserConfirm } from './tools/interaction-tools'
import type {IntelligenceContext} from './council/types'
import { deserializeDebateMemory, serializeDebateMemory } from './council/debate-memory'
import { getGlobalGraphStore } from './graph/store'
import { appendDelta, createRenderModel, reduceMessage, type RenderModel } from './output/render-model'
import { ChatStream } from './output/layout'
import { ChatBox } from './output/chatbox'
import { z } from 'zod'

import { setLogSink, type LogSink } from './utils/logger'
import { logSolveSummary } from './utils/solver-summary'
import chalk from 'chalk'

const internalTools = new Set(['updateWorkingMemory', 'setWorkingMemory'])

function buildCouncilIntelligenceContext(resources: SessionResources): IntelligenceContext | undefined {
  const ctx: IntelligenceContext = {}
  const reflexion = resources.coreServices?.reflexion
  const loopDetector = resources.coreServices?.loopDetector

  if (reflexion) {
    if (reflexion.getAttemptCount() > 0) {
      const block = reflexion.toPromptBlock()
      if (block) ctx.reflexionBlock = block
      // G6: Wire toReflectionPrompt() — force strategy change override
      const override = reflexion.toReflectionPrompt()
      if (override) ctx.reflectionOverride = override
      ctx.escalationLevel = reflexion.getEscalationLevel()
      ctx.consecutiveFailures = reflexion.getConsecutiveFailures()
    }
  }

  if (loopDetector) {
    ctx.antiLoopStale = loopDetector.isStale(3)
    if (loopDetector.blockedTargets.size > 0) {
      ctx.blockedTargets = [...loopDetector.blockedTargets]
    }
  }

  try {
    const store = getGlobalGraphStore()
    const summary = store.getTargetSummary()
    if (summary.totalEndpoints > 0 || summary.totalFindings > 0) {
      ctx.graphState = {
        totalEndpoints: summary.totalEndpoints,
        totalFindings: summary.totalFindings,
        findingsBySeverity: summary.findingsBySeverity,
        totalTests: summary.totalTests,
        authFlows: summary.authFlows,
        rbacRoles: summary.rbacRoles,
        untestedActions: summary.untestedActions,
        totalCapturedHeaders: summary.totalCapturedHeaders,
        endpoints: summary.endpoints,
      }
    }

    const edges = store.queryEdges()
    const endpoints = store.queryNodes(NodeType.ENDPOINT) as Array<{ properties: Record<string, unknown>; id: string }>
    if (endpoints.length > 0) {
      const methodCounts: Record<string, number> = {}
      const originCounts: Record<string, number> = { target: 0, self: 0 }
      const edgeTypeCounts: Record<string, number> = {}
      for (const e of edges) edgeTypeCounts[e.type] = (edgeTypeCounts[e.type] ?? 0) + 1

      const endpointSummaries = endpoints.map((ep) => {
        const p = ep.properties
        const method = String(p.method ?? 'UNKNOWN')
        methodCounts[method] = (methodCounts[method] ?? 0) + 1
        const origin = String(p.origin ?? 'target')
        if (origin === 'self') originCounts.self += 1
        else originCounts.target += 1
        const outgoing = edges.filter((e) => e.fromId === ep.id)
        const incoming = edges.filter((e) => e.toId === ep.id)
        return {
          id: ep.id,
          method,
          url: String(p.url ?? ''),
          origin,
          paramNames: Array.isArray(p.params) ? (p.params as Array<{ name: string }>).map((x) => x.name) : [],
          outgoingEdgeTypes: outgoing.map((e) => e.type),
          incomingEdgeTypes: incoming.map((e) => e.type),
        }
      })

      ctx.captureOverview = {
        endpointCount: endpoints.length,
        methodCounts,
        originCounts,
        edgeTypeCounts,
        endpoints: endpointSummaries,
        truncated: false,
      }
    }
  } catch {
    // Graph store not available
  }

  const hasAny = ctx.reflexionBlock || ctx.graphState || ctx.captureOverview || ctx.antiLoopStale || ctx.blockedTargets?.length || ctx.escalationLevel
  return hasAny ? ctx : undefined
}

/**
 * Host hooks so the chat-card renderer can coordinate with the REPL's readline
 * input line. In non-interactive runs (`ultimatrix solve`) these are omitted.
 */
export interface SolverRendererHost {
  /** Pause the input line before cursor manipulation. */
  pause?: () => void
  /** Resume the input line after a redraw. */
  resume?: () => void
}

/** Session context rendered into the chat card header / status. */
export interface SolverRenderContext {
  engine?: string
  provider?: string
  target?: string
  /** The solver's objective (drives the OODA loop). Engine semantics â€” not a display label. */
  goal?: string
  /** What the user actually typed this turn (displayed as the card's prompt line). */
  prompt?: string
}

/** Render callback with lifecycle hooks for one interactive turn. */
export interface SolverRenderer {
  (msg: SolverStreamMessage): void
  /** Draw the final card (no live caret). */
  final: () => void
  /** Flush buffered system events below the card, then restore the logger. */
  flush: () => void
  /** Toggle the collapsed reasoning block open/closed. */
  toggleReasoning: () => void
  /** Tear down any TUI state (restores logger sink). */
  exit: () => void
}

/**
 * Renders the structured solver stream to the terminal as inline "chat cards"
 * (opencode / Claude Code style) via the shared RenderModel + `ChatStream`.
 * Lives in the normal scrollback (no alternate-screen flicker), so long answers
 * stay naturally scrollable. TTY-aware: ANSI only on real terminals. The web UI
 * consumes the same RenderModel through a React reducer ï¿½ single contract.
 */
export function createSolverRenderer(
  _host: SolverRendererHost = {},
  ctx: SolverRenderContext = {},
  opts: { plain?: boolean; interaction?: { showReasoning?: boolean; liveReasoning?: boolean; showSystemEvents?: boolean }; chatbox?: ChatBox | null } = {},
): SolverRenderer {
  const model: RenderModel = createRenderModel()
  model.engine = ctx.engine
  model.provider = ctx.provider
  model.target = ctx.target
  model.goal = ctx.goal

  // Display policy: config-driven. Reasoning is opt-in; system events default on.
  // never agent behavior.
  const showReasoning = opts.interaction?.showReasoning !== false
  const showSystemEvents = opts.interaction?.showSystemEvents ?? true

  // Chat-box mode: one session-wide renderer owns all terminal output. The
  // ChatBox is adapted to the SolverRenderer interface so both solver call
  // sites stay unchanged. The session owns the sink (installed in `main`),
  // so this adapter never installs/restores it.
  if (opts.chatbox) {
    const cb = opts.chatbox
    cb.installSink()
    cb.printUserMessage(ctx.prompt ?? ctx.goal ?? '')
    cb.beginAssistant()
    const render = (msg: SolverStreamMessage): void => {
      reduceMessage(model, msg)
      cb.streamAssistant(msg)
    }
    render.final = (): void => {
      cb.endAssistant()
    }
    render.flush = (): void => { cb.uninstallSink() }
    render.toggleReasoning = (): void => cb.toggleReasoning()
    render.exit = (): void => { cb.uninstallSink() }
    return render
  }

  if (opts.plain) {
    // Lightweight incremental painter used by `ultimatrix solve` and
    // `--plain`. Track provider-cumulative chunks so text is never repainted.
    let renderedAnswer = ''
    let wroteAnswer = false
    const render = (msg: SolverStreamMessage): void => {
      reduceMessage(model, msg)
      switch (msg.kind) {
        case 'answer': {
          const next = appendDelta(renderedAnswer, msg.text)
          const suffix = next.startsWith(renderedAnswer)
            ? next.slice(renderedAnswer.length)
            : ''
          if (suffix) {
            process.stdout.write(suffix)
            wroteAnswer = true
          }
          renderedAnswer = next
          break
        }
        case 'tool':
          if (wroteAnswer) process.stdout.write('\n')
          log.dim(`  -> ${msg.name}`)
          break
        case 'tool-result':
          log.dim(`  ${msg.ok ? 'ok' : 'failed'} ${msg.name}`)
          break
        case 'event':
          if (msg.status === 'error') log.error(msg.label)
          else if (msg.status === 'warn') log.warn(msg.label)
          break
        case 'done':
          if (!wroteAnswer && msg.answer.content) {
            process.stdout.write(renderMarkdownPlain(msg.answer.content))
            wroteAnswer = true
          }
          break
      }
    }
    render.final = (): void => {
      if (wroteAnswer) process.stdout.write('\n')
    }
    render.flush = (): void => { /* no buffered system events in plain mode */ }
    render.toggleReasoning = (): void => { /* no card to toggle */ }
    render.exit = (): void => { /* no TUI to tear down */ }
    return render
  }

  // ─── ChatBox renderer (default for TTY interact) ──
  // Uses the restyled ChatBox for a clean, content-forward hacker aesthetic.
  // Falls through to the legacy ChatStream for non-TTY.
  const tty = !opts.plain && !opts.chatbox && Boolean(process.stdout?.isTTY)
  if (tty) {
    const cb = new ChatBox({
      isTTY: true,
      showReasoning: opts.interaction?.showReasoning !== false,
      liveReasoning: opts.interaction?.liveReasoning !== false,
      showSystemEvents: opts.interaction?.showSystemEvents ?? true,
      width: process.stdout?.columns,
    })
    cb.installSink()
    cb.printUserMessage(ctx.prompt ?? ctx.goal ?? '')
    cb.beginAssistant()
    const render = (msg: SolverStreamMessage): void => {
      reduceMessage(model, msg)
      cb.streamAssistant(msg)
    }
    render.final = (): void => { cb.endAssistant() }
    render.flush = (): void => { cb.uninstallSink() }
    render.toggleReasoning = (): void => { cb.toggleReasoning() }
    render.exit = (): void => { cb.uninstallSink() }
    return render
  }

  // ─── Legacy ChatStream fallback (non-TTY or --chatbox) ──
  const stream = new ChatStream({ showReasoning })
  stream.begin(ctx.prompt, ctx.goal)

  // Mute `INFO [ts]` noise during the turn so the answer card stays readable.
  // The sink stays installed until `render.flush()` is called (after the
  // post-solve logs), so the Steps/Plan/quota lines land in the buffer too and
  // are emitted as ONE dim `system events` block below the footer â€” never raw.
  const buffered: string[] = []
  const sink: LogSink = (level, msg) => {
    if (level === 'nl') return
    const tag = tagFor(level)
    buffered.push(`${chalk.dim('[sys]')} ${tag}${msg}`)
  }
  setLogSink(sink)

    const render = (msg: SolverStreamMessage): void => {
      reduceMessage(model, msg)
      stream.push(model)
    }
  render.final = (): void => {
    stream.final(model)
  }
  // Flush buffered system lines below the card, then restore the logger.
  // Gated by `showSystemEvents` â€” when off, nothing is emitted and the sink is
  // simply restored.
  render.flush = (): void => {
    setLogSink(null)
    if (!showSystemEvents) return
    if (buffered.length) {
      process.stdout.write(chalk.dim('------ system events ------') + '\n')
      for (const line of buffered) process.stdout.write(line + '\n')
      process.stdout.write(chalk.dim('--------------------------') + '\n')
    }
  }
  render.toggleReasoning = (): void => {
    stream.toggleReasoning(model)
  }
  render.exit = (): void => { setLogSink(null) }
  return render
}

function tagFor(level: string): string {
  switch (level) {
    case 'warn': return chalk.yellow('? ')
    case 'error': return chalk.red('? ')
    case 'success': return chalk.green('✔ ')
    case 'dim': return ''
    default: return ''
  }
}

function renderMarkdownPlain(text: string): string {
  // Escape-free streaming for plain/verify mode: reuse the markdown renderer's
  // TTY-agnostic path (isTTY false ? no escapes).
  try {
    // Lazy import kept local to avoid a hard dependency at module load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { renderMarkdown } = require('./output/terminal') as typeof import('./output/terminal')
    return renderMarkdown(text, { isTTY: false })
  } catch {
    return text
  }
}

export async function main(targetUrl?: string, _opts: { plain?: boolean; approvedOrigins?: string[] } = {}) {
  const lifecycle = new SessionLifecycle()
  /** Tracks the most recent turn's renderer so /reasoning can re-toggle it. */
  let lastRenderMsg: SolverRenderer | undefined

  // Initialize only the lightweight interactive control plane.
  const resources = await lifecycle.init(targetUrl, { approvedOrigins: _opts.approvedOrigins })

  const chatbox = !_opts.plain && resources.config.interaction?.chat !== false
    ? new ChatBox({
      isTTY: process.stdout.isTTY,
      showReasoning: resources.config.interaction?.showReasoning !== false,
      liveReasoning: resources.config.interaction?.liveReasoning !== false,
      showSystemEvents: resources.config.interaction?.showSystemEvents === true && process.env.ULTIMATRIX_DEBUG_EVENTS === '1',
        pause: resources.readline ? () => resources.readline?.pause() : undefined,
        resume: resources.readline ? () => resources.readline?.resume() : undefined,
      })
    : null

  // REPL loop
  await lifecycle.runREPL(async (line: string) => {
    const sink: ChatBox | null = chatbox

    // Commands
    if (line.trim() === '/exit' || line.trim() === '/quit') {
      log.dim('Ending interactive session.')
      return false
    }

    if (line.trim() === '/clear') {
      if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H')
      else process.stdout.write('\n'.repeat(3))
      return
    }

    if (line.trim() === '/status') {
      const summary = getGlobalWorkspace().getGraphStore()?.getTargetSummary()
      const lines = [
        `Target: ${resources.target || 'not set'}`,
        `Engine: ${resources.config.engine}`,
        `Model: ${fullModelId(resources.config.provider, resources.config.model)}`,
        `Graph: ${summary?.totalEndpoints ?? 0} endpoints | ${summary?.totalFindings ?? 0} findings | ${summary?.totalTests ?? 0} tests`,
      ]
      for (const statusLine of lines) log.info(statusLine)
      return
    }

    // Phase D — deterministic briefing (relation-native, no LLM).
    if (line.trim() === '/brief') {
      const { buildBriefing } = await import('./runtime/briefing')
      const briefing = buildBriefing()
      if (sink) sink.printReport(briefing.prose)
      else for (const l of briefing.prose.split('\n')) log.info(l)
      sink?.flushSystem()
      return
    }

    // Phase D / spec 05 — evolution visibility: what the system learned.
    if (line.trim() === '/learned') {
      const { getEvolutionSummary } = await import('./intelligence/evolution')
      const { getSkillKnowledgeStore } = await import('./intelligence/skill-knowledge')
      const evo = getEvolutionSummary()
      const sharedKnowledge = await getSkillKnowledgeStore().list().catch(() => [])
      const lines: string[] = []
      if (evo.techniques.length === 0) {
        lines.push('Nothing learned yet this session — confirmed findings and failed attempts feed the loop.')
      } else {
        lines.push('Technique outcomes this session (confirmed/failed):')
        for (const t of evo.techniques) lines.push(`  ${t.techniqueId}: +${t.confirmed} / -${t.failed}`)
        if (evo.promoted.length > 0) lines.push(`Weight promoted: ${evo.promoted.join(', ')}`)
        if (evo.demoted.length > 0) lines.push(`Weight demoted: ${evo.demoted.join(', ')}`)
        lines.push('Cross-session memory updates on engagement close; target drafts land in skills-drafts/ and shared revision proposals in global/skill-revisions/.')
      }
      if (sharedKnowledge.length > 0) {
        const confirmed = sharedKnowledge.reduce((sum, record) => sum + record.confirmed, 0)
        const failed = sharedKnowledge.reduce((sum, record) => sum + record.failed, 0)
        lines.push(`Shared skill knowledge: ${sharedKnowledge.length} technique pattern(s), ${confirmed} confirmed / ${failed} failed outcomes. Used to rank future methodology skills.`)
      } else {
        lines.push('Shared skill knowledge is empty; confirmed outcomes will accumulate through the policy-gated learning store.')
      }
      if (sink) sink.printReport(lines.join('\n'))
      else for (const l of lines) log.info(l)
      sink?.flushSystem()
      return
    }

    if (line.trim() === '/help') {
      const helpText = [
        'Commands:',
        '  /council <goal>  â€” deliberate with the council (strategist / operator / skeptic / analyst)',
        '  /report [id]     â€” write a Markdown report (whole engagement, or one finding by id)',
        '  /brief           — engagement briefing (state, gaps, suggested moves)',
        '  /learned         — what the system learned this session (technique outcomes, weight shifts)',
        '  /rulings         — what you and I have ruled on, with reasons',
        '  /reasoning (/r)  â€” show the last turn\'s reasoning',
        '  /status          â€” show target, engine, model, and graph counts',
        '  /clear           â€” clear the terminal view',
        '  /exit            â€” save and end the session',
        '  /help            â€” show this help',
        '  <goal>           â€” send a goal to the solver brain',
      ].join('\n')
      if (sink) sink.printHelp(helpText)
      else {
        for (const h of helpText.split('\n')) log.info(h)
      }
      return
    }

    // Ruling history — the operator's own knowledge, readable back. This exists
    // because a correction that lives only in scrollback is not knowledge; it
    // is a message that scrolls away.
    if (line.trim() === '/rulings') {
      const store = getGlobalGraphStore()
      const lines: string[] = []
      const items = store && typeof store.getDispositions === 'function' ? store.getDispositions() : []
      if (items.length === 0) {
        lines.push('No rulings yet. Tell me how the application actually behaves and I will record it — I will not re-derive it next session.')
      } else {
        // Split bound from unbound. Verified live: a run where early attempts
        // recorded rulings that matched no finding left six orphan rows that
        // buried the one ruling actually suppressing a finding. The operator
        // cannot tell signal from noise unless the view says which is which.
        const bound: typeof items = []
        const loose: typeof items = []
        for (const d of items) {
          const attached = typeof (store as { resolveFindingByClaim?: unknown }).resolveFindingByClaim === 'function'
            ? Boolean((store as unknown as { resolveFindingByClaim(r: string): unknown }).resolveFindingByClaim(d.properties.claimRef))
            : true
          ;(attached ? bound : loose).push(d)
        }
        const render = (d: (typeof items)[number]) => {
          const p = d.properties
          const who = p.origin === 'human' ? 'you' : 'I'
          const value = p.value === 'expected' ? 'expected/normal' : p.value
          return `  [${value}] ${p.claimLabel || p.claimRef} — ${who}: ${p.reason || '(no reason given)'}`
        }
        if (bound.length > 0) {
          lines.push(`Attached to a finding (${bound.length}) — these are suppressing real findings:`)
          for (const d of bound) lines.push(render(d))
        }
        if (loose.length > 0) {
          lines.push(`Standing notes, not bound to a finding (${loose.length}) — recorded knowledge, suppressing nothing:`)
          for (const d of loose) lines.push(render(d))
        }
        lines.push('Say "that is normal" or "that is not a bug" and I will record it against the finding.')
      }
      if (sink) sink.printReport(lines.join('\n'))
      else for (const l of lines) log.info(l)
      sink?.flushSystem()
      return
    }

    // Toggle the collapsed reasoning block of the last completed turn.
    if (line.trim() === '/reasoning' || line.trim() === '/r') {
      lastRenderMsg?.toggleReasoning()
      return
    }

    // W-R ï¿½ on-demand Markdown report. "/report" ? whole engagement;
    // "/report <findingId>" ? single finding. Prints the written path to chat.
    const reportMatch = line.match(/^\/report(?:\s+(\S+))?$/)
    if (reportMatch) {
      const { writeOnDemandReport } = await import('./report/on-demand')
      const res = writeOnDemandReport(reportMatch[1] ? 'finding' : 'engagement', reportMatch[1])
      if (res.ok) {
        if (sink) sink.printReport(`Report written (${res.findingCount} finding(s)): ${res.path}`)
        else log.info(`Report written (${res.findingCount} finding(s)): ${res.path}`)
      } else {
        if (sink) sink.printReport(res.error ?? 'report failed')
        else log.warn(res.error ?? 'report failed')
      }
      sink?.flushSystem()
      return
    }

    const { config, target, threadId, resourceId } = resources
    const councilMatch = line.match(/^\/council(?:\s+(.*))?$/)
    if (!councilMatch && config.engine === 'legacy') await lifecycle.ensureResearchReady()

    if (councilMatch) {
      const goal = (councilMatch[1] ?? '').trim()
      if (!goal) {
        log.warn('Usage: /council <goal>')
        return
      }
      if (!target) {
        log.warn('Council requires a target URL. Set one with: ultimatrix solve -t <url>')
        return
      }
      if (!resources.lazyServices || !resources.sessionBlackboard) throw new Error('Council engine is unavailable')
      const workerServices = await resources.lazyServices.ensureWorkers()
      resources.workerPool = workerServices.workerPool
      resources.taskCoordinator = workerServices.taskCoordinator
      resources.council = await resources.lazyServices.ensureCouncil(resources.sessionBlackboard)

      // Council path ï¿½ one debate cycle per REPL turn (not a blocking loop).
      // The human can interject between turns. Structured output, no text parsing.
      const { debateOnce } = await import('./council/orchestrator')
      const { proposalToWorkerConfig } = await import('./council/types')
      const council = resources.council

      // Council proposals execute as durable tasks; the coordinator owns attempts,
      // cancellation, budgets, attribution, and restart-safe checkpoints.
      const execute = async (proposal: import('./council/types').MemberOutput) => {
        if (!proposal.proposal) return 'no proposal'
        try {
          const workerConfig = proposalToWorkerConfig(proposal.proposal)
          if (!resources.taskCoordinator) throw new Error('Task coordinator is unavailable')
          const selection = resources.modelSelector?.selectForTask({
            skillId: workerConfig.skillId,
            taskDescription: workerConfig.task,
            complexity: proposal.proposal.complexity,
            requiredCapabilities: [],
          }, 'worker')
          const task = await resources.taskCoordinator.run({
            taskId: `council-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            objective: workerConfig.task,
            skillId: workerConfig.skillId,
            complexity: proposal.proposal.complexity,
            timeoutMs: config.council?.executeTimeoutMs ?? 120_000,
            modelId: selection?.modelId,
            provider: selection?.provider,
            tier: selection?.tier ?? workerConfig.tier,
          })
          if (task.status !== 'completed') throw new Error(task.error ?? `Task ended as ${task.status}`)
          const text = task.resultSummary ?? ''
          // B3: accumulate this execution's real result for the next turn's
          // results debate (carry-over, deterministic ï¿½ no meaning scanning).
          resources.councilPreviousResults =
            `${resources.councilPreviousResults ? resources.councilPreviousResults + '\n' : ''}${text}`
          return text
        } catch (err: any) {
          const msg = `execution error: ${err.message}`
          resources.councilPreviousResults =
            `${resources.councilPreviousResults ? resources.councilPreviousResults + '\n' : ''}${msg}`
          return msg
        }
      }

      // HITL approval gate ï¿½ uses askUserConfirm which reads from REPL stdin
      // and returns a boolean. Low/medium impact proposals are auto-approved
      // (governed by council approvalMode in approval.ts).
      const humanApprove = async (proposal: import('./council/types').MemberOutput): Promise<boolean> => {
        if (!proposal.proposal) return false
        const p = proposal.proposal
        const question =
          `\n[HITL] Council proposes: ${p.action}\n` +
          `Skill: ${p.skillId} | Impact: ${p.impact} | Complexity: ${p.complexity}\n` +
          `Reasoning: ${p.reasoning}\nApprove? (y/n): `
        try {
          return await askUserConfirm(question)
        } catch {
          return false
        }
      }

      // Initialize debate memory for this session (accumulates across REPL turns).
      // On a fresh session, restore any prior-session memory persisted to the graph
      // for this same goal so the council doesn't repeat failed approaches.
      if (!resources.debateMemory) {
        const prior = getGlobalGraphStore()
          .queryNodes(NodeType.COUNCIL_DEBATE, { goal })
          .filter((n: any) => n.properties?.summary?.startsWith('DEBATE_MEMORY::'))
          .sort((a: any, b: any) => (b.properties?.round ?? 0) - (a.properties?.round ?? 0))[0]
        resources.debateMemory =
          deserializeDebateMemory((prior?.properties as any)?.summary) ?? {
            stances: [],
            failedApproaches: [],
            provenFindings: [],
          }
      }

      const result = await debateOnce({
        members: council.members,
        bus: council.bus,
        blackboard: council.blackboard,
        goal,
        config: council.councilConfig,
        ledger: resources.coreServices?.evidence,
        execute,
        humanApprove,
        previousResults: resources.councilPreviousResults,
        debateMemory: resources.debateMemory,
        intelligenceContext: buildCouncilIntelligenceContext(resources),
        onPhase: (phase, round, text) => {
          if (phase === 'execute') {
            log.success(text ?? '')
          } else if (phase === 'reject') {
            log.warn(`[council] rejected r${round}: ${text ?? ''}`)
            // Surface timeout rejections to forensic log for post-mortem.
            if (text?.includes('timeout')) {
              resources.forensicLog.log({
                type: 'council-timeout',
                agent: 'council',
                args: { phase, round, reason: text },
              })
            }
          } else {
            log.dim(`[council:${phase}] r${round}`)
          }
        },
      })
      log.nl()
      if (result.complete) {
        log.success(`Council signals completion: ${result.summary}`)
      } else {
        log.info(`Council debate: ${result.proposedTasks.length} tasks proposed, ${result.newEvidence} evidence items`)
        if (result.summary) log.dim(result.summary)
      }

      // B4: persist this debate cycle to the graph for post-session audit.
      // The full DebateMemory is serialized into `summary` (marker-prefixed)
      // so subsequent sessions can restore member stances and failed approaches.
      try {
        getGlobalGraphStore().addCouncilDebate({
          goal,
          round: result.messages.length > 0 ? result.messages[result.messages.length - 1].round : 0,
          members: council.members.map(m => m.role),
          summary: serializeDebateMemory(resources.debateMemory),
          proposedTasks: result.proposedTasks.length,
          newEvidence: result.newEvidence,
          complete: result.complete,
        })
      } catch (err: any) {
        log.dim(`[council] debate persist skipped: ${err.message}`)
      }
      sink?.flushSystem()
    } else if (config.engine !== 'legacy' && resources.coreServices) {
      // B3: Solver bypasses runner ï¿½ calls solve() directly with real brain agent
      // The runner's CouncilStrategy and SingleAgentStrategy are dead code stubs.
      const renderMsg = createSolverRenderer({}, {
        engine: config.engine,
        provider: fullModelId(config.provider, config.model),
        target,
        prompt: line,
      }, {
        plain: _opts.plain,
        interaction: config.interaction,
        chatbox,
      })
      lastRenderMsg = renderMsg
      lifecycle.markTurnActive()
      let result: Awaited<ReturnType<typeof solve>> | null = null
      let aborted = false
      let turnError: unknown = null
      // Turn survivability: a recoverable model failure (stream stall,
      // overload, rate limit) retries on the next configured tier instead of
      // abandoning the turn. The shared blackboard/evidence/loop state carries
      // over, so the retry continues the same investigation. Bounded to
      // MAX_MODEL_ATTEMPTS so a dead provider cannot loop forever.
      const attemptedModels = new Set<string>()
      try {
        const seedRoute = resolveModelRef(config, { role: 'brain' })
        attemptedModels.add(modelKey(seedRoute.provider, seedRoute.model))
      } catch { /* routing unavailable — fallback walk still applies */ }
      let brain = resources.solverBrain!
      // Turn-level findings baseline (taken once, before attempt 1) so a
      // retry's done card cannot report newFindings 0 for findings its own
      // failed attempt recorded. Best-effort: absence preserves behavior.
      let turnStartFindings: number | undefined
      try {
        const summary = getGlobalWorkspace().getGraphStore()?.getTargetSummary()
        if (typeof summary?.totalFindings === 'number') turnStartFindings = summary.totalFindings
      } catch { /* graph unavailable — per-attempt snapshots still apply */ }
      try {
        for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt++) {
          try {
            result = await solve(brain, {
              origin: target || 'conversation',
              goal: line,
              model: config.model,
              memory: { thread: threadId, resource: resourceId },
              blackboard: resources.coreServices.blackboard,
              evidence: resources.sessionEvidence,
              loopDetector: resources.coreServices.loopDetector,
              reflexion: resources.coreServices.reflexion,
              lazyServices: resources.lazyServices,
              turnStartFindings,
              config: {
                maxToolCalls: config.solver?.maxToolCalls ?? DEFAULTS.solver.maxToolCalls,
                maxDurationMs: config.solver?.maxDurationMs ?? DEFAULTS.solver.maxDurationMs,
                staleThreshold: config.antiLoop?.staleThreshold ?? DEFAULTS.antiLoop.staleThreshold,
                maxParallel: config.solver?.maxParallel ?? DEFAULTS.solver.maxParallel,
                progressTimeoutMs: config.solver?.progressTimeoutMs,
              },
              signal: lifecycle.abortController.signal,
              onToolComplete: (_toolName: string, _result?: unknown) => {
                getGlobalWorkspace().getGraphStore()?.scheduleSave()
              },
              onMessage: renderMsg,
              onPhase: (event) => {
                resources.forensicLog.log({
                  type: 'solver-phase',
                  agent: 'solver-brain',
                  args: {
                    phase: event.phase,
                    step: event.step,
                    toolName: event.toolName,
                    toolArgs: event.toolArgs,
                    reason: event.reason,
                    activity: event.activity,
                  },
                })
              },
              workflow: resources.workflow,
              ultimatrixConfig: config,
            })
          } catch (err: any) {
            // Soft-abort: solver was interrupted by Ctrl+C — show message, skip summary
            if (lifecycle.isTurnAborted || err?.message === 'Solver interrupted') {
              aborted = true
            } else {
              // Keep the renderer lifecycle balanced even when model/provider
              // startup or streaming fails. Previously this left the ChatBox
              // active with its log sink installed, corrupting the next prompt.
              turnError = err
            }
            break
          }
          if (
            result &&
            result.reason === 'model_failed' &&
            isRecoverableModelFailure(result) &&
            attempt < MAX_MODEL_ATTEMPTS &&
            resources.skillRegistry && resources.memory && resources.modelSelector &&
            resources.extensionRegistry && resources.lazyServices
          ) {
            const currentRoute = resolveModelRef(config, { role: 'brain' })
            const current = { provider: currentRoute.provider, model: currentRoute.model }
            // Budget gate: never retry onto a provider the quota tracker
            // already flagged exhausted/cooling-down. Every call still passes
            // the per-call quota/rate-limit gates; this just avoids a doomed
            // turn when the whole provider is tapped out.
            const quotaGate = (provider: string): boolean => {
              try {
                return getGlobalQuotaTracker().isExhausted(provider)
              } catch {
                return false
              }
            }
            const fallback = nextConfiguredModel(config, current, attemptedModels, quotaGate)
            if (!fallback) break
            attemptedModels.add(modelKey(fallback.provider, fallback.model))
            resources.modelSelector?.recordFailure(current.provider, current.model)
            const fallbackConfig = {
              ...config,
              provider: fallback.provider,
              model: fallback.model,
              modelRoles: { ...(config.modelRoles ?? {}), brain: { provider: fallback.provider, model: fallback.model } },
            }
            brain = createSolverBrain(fallbackConfig, {
              skillRegistry: resources.skillRegistry,
              memory: resources.memory,
              modelSelector: resources.modelSelector,
              extensionRegistry: resources.extensionRegistry,
              lazyServices: resources.lazyServices,
            })
            resources.solverBrain = brain
            const label = `[model-fallback] ${modelKey(current.provider, current.model)} failed (${result.error ?? result.reason}); retrying turn with ${modelKey(fallback.provider, fallback.model)}`
            log.warn(label)
            renderMsg({ kind: 'event', event: 'model.fallback', label, status: 'warn' })
            continue
          }
          break
        }
      } finally {
        lifecycle.markTurnComplete()
      }

      if (turnError) {
        const message = turnError instanceof Error ? turnError.message : String(turnError)
        renderMsg({
          kind: 'event',
          event: 'turn.failed',
          label: `Turn failed before completion: ${message}`,
          status: 'error',
        })
      }
      renderMsg.final()
      if (!aborted) {
        if (result && (result.toolCalls > 0 || result.error)) {
          // ChatBox owns the turn's answer, failure state, and footer. Logging
          // the generic solver summary here duplicated fallback answers (for
          // example "No deliverable response") after the card had completed.
          // Plain/non-chat renderers still need the summary in the log.
          if (!chatbox) {
            logSolveSummary(result)
            log.info(`Facts: ${result.facts ?? 0} | Intents: ${result.intents ?? 0}`)
          }
        }

        const quotaTracker = getGlobalQuotaTracker()
        const providerStatus = quotaTracker.getStatus()
        const providerInfo = providerStatus[config.provider]
        if (providerInfo) {
          log.dim(`[quota] ${config.provider}: ${providerInfo.used} requests this session` +
            (providerInfo.inCooldown ? ' (COOLDOWN)' : ''))
        }
        if (result?.planSummary) {
          log.info('Plan summary:')
          log.info(result.planSummary)
        }
      }
      renderMsg.flush()
      if (turnError) throw turnError
    } else {
      // @deprecated Legacy supervisor path — kept for backward compatibility with web UI
      const result = await resources.supervisor!.stream(line, {
        memory: { thread: threadId, resource: resourceId },
        maxSteps: config.agent.maxSteps,
        structuredOutput: { schema: z.any() },
      })
      await consumeStream(result.fullStream, 'supervisor', resources)
    }

    process.stdout.write('\n')

    // Chain detection
    lifecycle.detectAndReportChains()

    // Auto-save after each turn
    await Promise.all([
      getGlobalWorkspace().getGraphStore()?.save(),
      getGlobalWorkspace().getOastStore()?.save(),
    ])
  }, chatbox)

  // Native terminal: stdin is owned by readline throughout; no alternate screen
  // or logger sink to tear down. (The termcn/Ink TUI, if re-enabled, would own
  // those — but it is currently disabled.)
}

// -- Stream consumer (for legacy engine) ----------------------------

async function consumeStream(stream: AsyncIterable<any>, agentId: string, resources: SessionResources) {
  let textBuf: string[] = []
  let lastToolCall: { name: string; args?: unknown; time: number } | null = null
  const { forensicLog } = resources

  const flushText = (asResponse: boolean) => {
    if (textBuf.length > 0) {
      const text = textBuf.join('')
      if (asResponse) {
        process.stdout.write(text)
      } else {
        log.dim(text)
      }
      textBuf = []
    }
  }

  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'text-delta':
        textBuf.push(chunk.payload.text)
        break
      case 'reasoning-delta':
        textBuf.push(chunk.payload.text)
        break
      case 'reasoning-end':
        break
      case 'tool-call':
        if (chunk.payload.toolName === 'askUser') break
        if (internalTools.has(chunk.payload.toolName)) break
        flushText(false)
        log.dim('  ? ' + chunk.payload.toolName)
        lastToolCall = { name: chunk.payload.toolName, args: chunk.payload.args, time: Date.now() }
        forensicLog.log({
          type: 'tool-call',
          agent: agentId,
          tool: chunk.payload.toolName,
          args: chunk.payload.args as Record<string, unknown>,
        })
        break
      case 'tool-result':
        if (internalTools.has(chunk.payload.toolName)) break
        flushText(false)
        log.success(chunk.payload.toolName)
        forensicLog.log({
          type: 'tool-result',
          agent: agentId,
          tool: chunk.payload.toolName,
          result: chunk.payload.result,
          duration: lastToolCall ? Date.now() - lastToolCall.time : undefined,
        })
        lastToolCall = null
        break
      case 'tool-error':
        flushText(false)
        log.error(chunk.payload.toolName + ': ' + chunk.payload.error)
        forensicLog.log({
          type: 'tool-error',
          agent: agentId,
          tool: chunk.payload.toolName,
          error: chunk.payload.error,
        })
        lastToolCall = null
        break
      case 'error':
        flushText(false)
        log.error(String(chunk.payload.error))
        forensicLog.log({
          type: 'error',
          agent: agentId,
          error: String(chunk.payload.error),
        })
        break
      case 'step-finish':
        flushText(true)
        getGlobalWorkspace().getGraphStore()?.scheduleSave()
        break
      case 'background-task-started':
        flushText(false)
        log.dim('background task: ' + chunk.payload.toolName + '...')
        break
      case 'background-task-completed':
        flushText(false)
        log.success('background task: ' + chunk.payload.toolName)
        break
      case 'background-task-failed':
        flushText(false)
        log.error('background task: ' + chunk.payload.toolName)
        break
      case 'finish':
        // Token usage from legacy engine stream
        break
    }
  }
  flushText(true)
}
