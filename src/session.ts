import { log } from './utils/logger'
import { DEFAULTS } from './config'
import { detectChains } from './intelligence/chaining'
import type { FindingNode } from './graph/schema'
import { resolveSkillsForInput } from './solver/skills/tool-filter'
import { loadSkill } from './solver/skills/loader'
import { getGlobalReactionObserver } from './browser/reaction-observer'
import { SessionLifecycle, type SessionResources } from './session/lifecycle'
import { solve } from './solver/solver'
import { getGlobalWorkspace } from './workspace'
import { writeFile, mkdir } from 'node:fs/promises'
import { mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getGlobalQuotaTracker } from './models/quota-tracker'
import { askUserConfirm } from './tools/interaction-tools'
import type { DebateMemory } from './council/types'

const internalTools = new Set(['updateWorkingMemory', 'setWorkingMemory'])

export async function main(targetUrl?: string) {
  const lifecycle = new SessionLifecycle()

  // Initialize: config → resources → browser → infrastructure
  const resources = await lifecycle.init(targetUrl)

  // Spider: crawl → HAR bridge
  await lifecycle.runSpider()

  // Engine: solver brain or legacy workers
  await lifecycle.setupEngine()

  // REPL loop
  await lifecycle.runREPL(async (line: string) => {
    // Commands
    if (line.trim() === '/help') {
      log.info('Commands:')
      log.info('  /council <goal>  — deliberate with the council (strategist / operator / skeptic / analyst)')
      log.info('  /help            — show this help')
      log.info('  <goal>           — send a goal to the solver brain')
      return
    }

    // Dispatch skills based on user input
    const matchedSkills = resolveSkillsForInput(line)
    if (matchedSkills.length > 0) {
      log.dim(`Skills: ${matchedSkills.map(s => s.name).join(', ')}`)
    }

    // Load full skill bodies for matched skills (progressive disclosure — only load what's needed)
    const matchedWithInstructions = matchedSkills
      .map(s => loadSkill(s.id))
      .filter((s): s is NonNullable<typeof s> => s !== null)

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

      // Council path — one debate cycle per REPL turn (not a blocking loop).
      // The human can interject between turns. Structured output, no text parsing.
      const { debateOnce } = await import('./council/orchestrator')
      const { proposalToWorkerConfig } = await import('./council/types')
      const council = resources.council

      // Matched skills for this turn (progressive disclosure): full skill bodies
      // are loaded only for the skills the REPL matched from user input. When the
      // council proposes one of these skills, the worker receives its instructions.
      const matchedById = new Map(matchedWithInstructions.map(s => [s.id, s]))

      // Wire execute callback — proposals actually spawn workers via dispatchSlices
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
          return typeof r.text === 'string' ? r.text : String(r.text ?? '')
        } catch (err: any) {
          return `execution error: ${err.message}`
        }
      }

      // HITL approval gate — uses askUserConfirm which reads from REPL stdin
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

      // Initialize debate memory for this session (accumulates across REPL turns)
      if (!resources.debateMemory) {
        resources.debateMemory = { stances: [], failedApproaches: [], provenFindings: [] }
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
    } else if (target && resources.coreServices) {
      // B3: Solver bypasses runner — calls solve() directly with real brain agent
      // The runner's CouncilStrategy and SingleAgentStrategy are dead code stubs.
      let streamedResponse = false
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
        onPhase: (event) => {
          if (event.text) {
            if (event.reasoning) {
              log.dim(`[thinking] ${event.text}`)
            } else {
              process.stdout.write(event.text)
              streamedResponse = true
            }
          }
          if (event.toolName) log.dim(`  → ${event.toolName}`)
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
      log.nl()
      if (result.completed) {
        log.success(`Solver completed: ${result.reason}`)
      } else {
        log.warn(`Solver stopped: ${result.reason}`)
      }
      if (result.error) {
        log.error(`Error: ${result.error}`)
      }
      if (!streamedResponse && result.text) {
        process.stdout.write(result.text)
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
        onPhase: (event) => {
          if (event.text) {
            if (event.reasoning) {
              log.dim(`[thinking] ${event.text}`)
            } else {
              process.stdout.write(event.text)
              streamedResponse = true
            }
          }
          if (event.toolName) log.dim(`  → ${event.toolName}`)
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
      log.nl()
      if (result.completed) {
        log.success(`Solver completed: ${result.reason}`)
      } else {
        log.warn(`Solver stopped: ${result.reason}`)
      }
      if (result.error) {
        log.error(`Error: ${result.error}`)
      }
      if (!streamedResponse && result.text) {
        process.stdout.write(result.text)
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
  })
}

// ── Stream consumer (for legacy engine) ────────────────────────────

async function consumeStream(stream: AsyncIterable<any>, agentId: string, resources: SessionResources) {
  let textBuf: string[] = []
  let lastToolCall: { name: string; args?: unknown; time: number } | null = null
  let reactionBaseline = false
  const reactionObserver = getGlobalReactionObserver()
  const { forensicLog } = resources

  const BROWSER_TOOLS = new Set([
    'stagehand_navigate', 'stagehand_act', 'stagehand_click',
    'stagehand_extract', 'stagehand_observe', 'stagehand_screenshot',
    'httpRequest', 'spawnWorker', 'executeDirect',
  ])

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
        log.dim('  → ' + chunk.payload.toolName)
        lastToolCall = { name: chunk.payload.toolName, args: chunk.payload.args, time: Date.now() }
        forensicLog.log({
          type: 'tool-call',
          agent: agentId,
          tool: chunk.payload.toolName,
          args: chunk.payload.args as Record<string, unknown>,
        })
        if (BROWSER_TOOLS.has(chunk.payload.toolName)) {
          try { await reactionObserver.captureBaseline() } catch {}
          reactionBaseline = true
        }
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
        if (reactionBaseline && BROWSER_TOOLS.has(chunk.payload.toolName)) {
          try {
            const reactionResult = await reactionObserver.detectReaction()
            if (reactionResult.hasChanges && reactionResult.summary) {
              log.info(`UI reaction: ${reactionResult.summary}`)
              forensicLog.log({
                type: 'ui-reaction',
                agent: agentId,
                tool: chunk.payload.toolName,
                args: {
                  reactions: reactionResult.reactions,
                  summary: reactionResult.summary,
                },
              })
            }
          } catch {}
          reactionBaseline = false
        }
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
        reactionBaseline = false
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
