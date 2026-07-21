import { log } from './utils/logger'
import { DEFAULTS, loadConfig } from './config'
import { detectChains } from './intelligence/chaining'
import type { FindingNode } from './graph/schema'
import { NodeType } from './graph/schema'
import { SessionLifecycle, type SessionResources } from './session/lifecycle'
import { solve } from './solver/solver'
import type { SolverStreamMessage } from './solver/solver'
import { getGlobalWorkspace } from './workspace'
import { writeFile, mkdir } from 'node:fs/promises'
import { mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getGlobalQuotaTracker } from './models/quota-tracker'
import { askUserConfirm } from './tools/interaction-tools'
import type { DebateMemory } from './council/types'
import { deserializeDebateMemory, serializeDebateMemory } from './council/debate-memory'
import { getGlobalGraphStore } from './graph/store'
import { createRenderModel, reduceMessage, type RenderModel } from './output/render-model'
import { ChatStream } from './output/layout'
import type { ChatBox } from './output/chatbox'
import type { UiStore } from './ui/store'
import { setLogSink, type LogSink } from './utils/logger'
import chalk from 'chalk'

const internalTools = new Set(['updateWorkingMemory', 'setWorkingMemory'])

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
  host: SolverRendererHost = {},
  ctx: SolverRenderContext = {},
  opts: { plain?: boolean; interaction?: { showReasoning?: boolean; showSystemEvents?: boolean }; chatbox?: ChatBox | null; uiStore?: UiStore | null } = {},
): SolverRenderer {
  const model: RenderModel = createRenderModel()
  model.engine = ctx.engine
  model.provider = ctx.provider
  model.target = ctx.target
  model.goal = ctx.goal

  // Display policy: config-driven, default on. These are product preferences,
  // never agent behavior.
  const showReasoning = opts.interaction?.showReasoning ?? true
  const showSystemEvents = opts.interaction?.showSystemEvents ?? true

  // Console mode (termcn/Ink): the Ink App owns the entire terminal (alternate
  // screen), so the renderer must NOT write to stdout. It folds every message
  // into the UiStore exactly once; the Ink panes read the store. Reversible:
  // when `uiStore` is absent, the legacy chat-box / plain paths run unchanged.
  if (opts.uiStore) {
    const render = (msg: SolverStreamMessage): void => {
      reduceMessage(model, msg)
      opts.uiStore.dispatchSolver(msg)
    }
    render.final = (): void => {
      opts.uiStore.commitTurn()
    }
    render.flush = (): void => { /* no buffered stdout in console mode */ }
    render.toggleReasoning = (): void => { /* TODO: console reasoning toggle */ }
    render.exit = (): void => { /* Ink unmount owned by session */ }
    return render
  }

  // Chat-box mode: one session-wide renderer owns all terminal output. The
  // ChatBox is adapted to the SolverRenderer interface so both solver call
  // sites stay unchanged. The session owns the sink (installed in `main`),
  // so this adapter never installs/restores it.
  if (opts.chatbox) {
    const cb = opts.chatbox
    cb.printUserMessage(ctx.prompt ?? ctx.goal ?? '')
    cb.beginAssistant()
    const render = (msg: SolverStreamMessage): void => {
      reduceMessage(model, msg)
      cb.streamAssistant(msg)
      // Mirror every folded message into the console store so the Ink UI shows
      // the same turn the chat box prints. Single fold (reduceMessage) â€” no
      // double reduction. The store is a pure consumer here.
      opts.uiStore?.dispatchSolver(msg)
    }
    render.final = (): void => {
      cb.endAssistant()
      opts.uiStore?.commitTurn()
    }
    render.flush = (): void => { /* ChatBox.endAssistant already flushed/cleared sink */ }
    render.toggleReasoning = (): void => cb.toggleReasoning()
    render.exit = (): void => { /* sink owned by session */ }
    return render
  }

  if (opts.plain) {
    // Lightweight streaming painter (used by `ultimatrix solve` and the
    // `--plain` fallback): no card framing, TTY-aware escape-free.
    const render = (msg: SolverStreamMessage): void => {
      reduceMessage(model, msg)
      if (model.answer) process.stdout.write(renderMarkdownPlain(model.answer) + '\n')
    }
    render.final = (): void => { /* plain stream already emitted */ }
    render.flush = (): void => { /* no buffered system events in plain mode */ }
    render.toggleReasoning = (): void => { /* no card to toggle */ }
    render.exit = (): void => { /* no TUI to tear down */ }
    return render
  }

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
    case 'success': return chalk.green('? ')
    case 'dim': return ''
    default: return ''
  }
}

function renderMarkdownPlain(text: string): string {
  // Escape-free streaming for plain/verify mode: reuse the markdown renderer's
  // TTY-agnostic path (isTTY false ? no escapes).
  try {
    // Lazy import kept local to avoid a hard dependency at module load.
    const { renderMarkdown } = require('./output/terminal') as typeof import('./output/terminal')
    return renderMarkdown(text, { isTTY: false })
  } catch {
    return text
  }
}

export async function main(targetUrl?: string, opts: { plain?: boolean } = {}) {
  const lifecycle = new SessionLifecycle()
  /** Tracks the most recent turn's renderer so /reasoning can re-toggle it. */
  let lastRenderMsg: SolverRenderer | undefined

  // Native terminal console: the plain `log.*` + streamed-answer path. The
  // termcn/Ink TUI (src/ui/*) is retained on disk but disabled â€” we do not
  // construct a ChatBox or UiStore here, so stdin stays owned by readline and
  // no in-place cursor rewrites can erase the user's typed line.
  const preCfg = loadConfig().interaction ?? {}
  const preChat = !opts.plain && (preCfg.chat ?? true)

  // Initialize: config ? resources ? browser ? infrastructure
  const resources = await lifecycle.init(targetUrl)

  const interactionCfg = resources.config?.interaction ?? {}
  const chatEnabled = !opts.plain && (interactionCfg.chat ?? true)

  // Both renderers are disabled in the native terminal: the REPL uses the
  // plain `log.*` / stdout streamer and a simple `> ` prompt.
  const chatbox = null

  // Spider: crawl ? HAR bridge (no activity sink in native terminal)
  await lifecycle.runSpider(undefined)

  // Engine: solver brain or legacy workers
  await lifecycle.setupEngine()

  // REPL loop
  await lifecycle.runREPL(async (line: string) => {
    // Coordinate the in-place markdown painter with the readline input line so
    // The native terminal owns stdin via readline; there is no ink/card surface
    // to coordinate with, so the solver stream writes directly to stdout.
    const rl = resources.readline

    // Activity sink is disabled in the native terminal: all output routes
    // through `log.*` / stdout below.
    const sink = undefined

    // Commands
    if (line.trim() === '/help') {
      const helpText = [
        'Commands:',
        '  /council <goal>  â€” deliberate with the council (strategist / operator / skeptic / analyst)',
        '  /report [id]     â€” write a Markdown report (whole engagement, or one finding by id)',
        '  /reasoning (/r)  â€” expand/collapse the last turn\'s reasoning block',
        '  /help            â€” show this help',
        '  <goal>           â€” send a goal to the solver brain',
      ].join('\n')
      if (sink) sink.printHelp(helpText)
      else {
        for (const h of helpText.split('\n')) log.info(h)
      }
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

    // Phase 7.2 ï¿½ pure-discovery skill selection. Skills are no longer
    // auto-matched from free-form user input via substring scanning. The brain
    // and council select skills themselves via the listSkills / searchSkills
    // tools. No skill instructions are pre-loaded from the REPL line.
    const matchedWithInstructions: any[] = []

    const { config, target, threadId, resourceId } = resources
    const councilMatch = line.match(/^\/council(?:\s+(.*))?$/)

    if (councilMatch) {
      const goal = (councilMatch[1] ?? '').trim()
      if (!goal) {
        log.warn('Usage: /council <goal>')
        return
      }
      if (!target || !resources.council) {
        log.warn('Council requires a target URL. Set one with: ultimatrix solve -t <url>')
        return
      }

      // Council path ï¿½ one debate cycle per REPL turn (not a blocking loop).
      // The human can interject between turns. Structured output, no text parsing.
      const { debateOnce } = await import('./council/orchestrator')
      const { proposalToWorkerConfig } = await import('./council/types')
      const council = resources.council

      // Matched skills for this turn (progressive disclosure): full skill bodies
      // are loaded only for the skills the REPL matched from user input. When the
      // council proposes one of these skills, the worker receives its instructions.
      const matchedById = new Map(matchedWithInstructions.map(s => [s.id, s]))

      // Wire execute callback ï¿½ proposals actually spawn workers via dispatchSlices
      // so multi-model routing, tier selection, concurrency, and tenant isolation apply.
      const execute = async (proposal: import('./council/types').MemberOutput) => {
        if (!proposal.proposal) return 'no proposal'
        try {
          const matched = matchedById.get(proposal.proposal.skillId)
          const workerConfig = proposalToWorkerConfig(proposal.proposal, {
            context: matched
              ? { skillInstructions: matched.instructions, skillReferences: matched.references }
              : undefined,
          })

          const slice: import('./workers/pool').DispatchSlice = {
            id: `council-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            skillId: workerConfig.skillId,
            task: workerConfig.task,
            complexity: proposal.proposal.complexity,
            requiredCapabilities: [],
            context: workerConfig.context,
            tenant: resources.tenant,
            sandboxId: resources.sandboxId,
          }

          const results = await resources.workerPool!.dispatchSlices([slice], {
            modelSelector: resources.modelSelector,
            perSliceRole: 'worker',
            perSliceTimeoutMs: config.council?.executeTimeoutMs ?? 120_000,
          })

          const sliceResult = results[0]
          if (sliceResult.error) throw new Error(sliceResult.error)
          const r = sliceResult.result
          if (!r) return 'no result'
          const text = typeof r.text === 'string' ? r.text : String(r.text ?? '')
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
          deserializeDebateMemory(prior?.properties?.summary) ?? {
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
    } else if (target && resources.coreServices) {
      // B3: Solver bypasses runner ï¿½ calls solve() directly with real brain agent
      // The runner's CouncilStrategy and SingleAgentStrategy are dead code stubs.
      let streamedResponse = false
      let reasoningBuf = ''
      const flushReasoning = (): void => {
        if (reasoningBuf) {
          process.stdout.write('\x1b[2m[thinking] ' + reasoningBuf.trim() + '\x1b[0m\n')
          reasoningBuf = ''
        }
      }
      const renderMsg = (event: SolverStreamMessage): void => {
        switch (event.kind) {
          case 'reasoning':
            streamedResponse = true
            reasoningBuf += event.text
            break
          case 'answer':
            streamedResponse = true
            flushReasoning()
            process.stdout.write(event.text)
            break
          case 'tool':
            log.dim(`  … ${event.name}`)
            break
        }
      }
      const result = await solve(resources.solverBrain!, {
        origin: target,
        goal: line,
        model: config.model,
        memory: { thread: threadId, resource: resourceId },
        matchedSkills: matchedWithInstructions.length > 0 ? matchedWithInstructions : undefined,
        blackboard: resources.coreServices.blackboard,
        evidence: resources.sessionEvidence,
        loopDetector: resources.coreServices.loopDetector,
        reflexion: resources.coreServices.reflexion,
        config: {
          maxToolCalls: config.solver?.maxToolCalls ?? DEFAULTS.solver.maxToolCalls,
          maxDurationMs: config.solver?.maxDurationMs ?? DEFAULTS.solver.maxDurationMs,
          staleThreshold: config.antiLoop?.staleThreshold ?? DEFAULTS.antiLoop.staleThreshold,
          maxParallel: config.solver?.maxParallel ?? DEFAULTS.solver.maxParallel,
        },
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
            },
          })
        },
      })

      flushReasoning()
      if (streamedResponse) process.stdout.write('\n')

      if (result.completed) {
        log.success(`Solver completed: ${result.reason}`)
      } else {
        log.warn(`Solver stopped: ${result.reason}`)
      }
      if (result.error) {
        log.error(`Error: ${result.error}`)
      }
      const finalAnswer = result.answer?.content || result.text
      if (!streamedResponse && finalAnswer) {
        // No live stream was shown — render the answer as the final message.
        if (result.answer?.reasoning) {
          log.dim('Reasoning: ' + result.answer.reasoning)
        }
        process.stdout.write('\x1b[1m' + finalAnswer + '\x1b[0m\n')
      }
      log.info(`Steps: ${result.steps ?? 0} | Facts: ${result.facts ?? 0} | Intents: ${result.intents ?? 0} | Tool calls: ${result.toolCalls ?? 0}`)

      const quotaTracker = getGlobalQuotaTracker()
      const providerStatus = quotaTracker.getStatus()
      const providerInfo = providerStatus[config.provider]
      if (providerInfo) {
        log.dim(`[quota] ${config.provider}: ${providerInfo.used} requests this session` +
          (providerInfo.inCooldown ? ' (COOLDOWN)' : ''))
      }
      if (result.planSummary) {
        log.info('Plan summary:')
        log.info(result.planSummary)
      }
    } else if (target) {
      // Fallback: solver without pre-built coreServices (backward compat)
      let streamedResponse = false
      let reasoningBuf = ''
      const flushReasoning = (): void => {
        if (reasoningBuf) {
          process.stdout.write('\x1b[2m[thinking] ' + reasoningBuf.trim() + '\x1b[0m\n')
          reasoningBuf = ''
        }
      }
      const renderMsg = (event: SolverStreamMessage): void => {
        switch (event.kind) {
          case 'reasoning':
            streamedResponse = true
            reasoningBuf += event.text
            break
          case 'answer':
            streamedResponse = true
            flushReasoning()
            process.stdout.write(event.text)
            break
          case 'tool':
            log.dim(`  … ${event.name}`)
            break
        }
      }
      const result = await solve(resources.solverBrain!, {
        origin: target,
        goal: line,
        model: config.model,
        memory: { thread: threadId, resource: resourceId },
        matchedSkills: matchedWithInstructions.length > 0 ? matchedWithInstructions : undefined,
        blackboard: resources.sessionBlackboard,
        evidence: resources.sessionEvidence,
        loopDetector: resources.sessionLoopDetector,
        reflexion: resources.sessionReflexion,
        config: {
          maxToolCalls: config.solver?.maxToolCalls ?? DEFAULTS.solver.maxToolCalls,
          maxDurationMs: config.solver?.maxDurationMs ?? DEFAULTS.solver.maxDurationMs,
          staleThreshold: config.antiLoop?.staleThreshold ?? DEFAULTS.antiLoop.staleThreshold,
          maxParallel: config.solver?.maxParallel ?? DEFAULTS.solver.maxParallel,
        },
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
            },
          })
        },
      })

      flushReasoning()
      if (streamedResponse) process.stdout.write('\n')

      if (result.completed) {
        log.success(`Solver completed: ${result.reason}`)
      } else {
        log.warn(`Solver stopped: ${result.reason}`)
      }
      if (result.error) {
        log.error(`Error: ${result.error}`)
      }
      const finalAnswer = result.answer?.content || result.text
      if (!streamedResponse && finalAnswer) {
        if (result.answer?.reasoning) {
          log.dim('Reasoning: ' + result.answer.reasoning)
        }
        process.stdout.write('\x1b[1m' + finalAnswer + '\x1b[0m\n')
      }
      log.info(`Steps: ${result.steps} | Facts: ${result.facts} | Intents: ${result.intents} | Tool calls: ${result.toolCalls}`)
      if (result.planSummary) {
        log.info('Plan summary:')
        log.info(result.planSummary)
      }
    } else {
      // @deprecated Legacy supervisor path — kept for backward compatibility with web UI
      const result = await resources.supervisor!.stream(line, {
        memory: { thread: threadId, resource: resourceId },
        maxSteps: config.agent.maxSteps,
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
  }, chatbox ?? undefined)

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
