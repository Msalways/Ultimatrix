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
    const useSolver = config.engine === 'solver' || config.engine === 'multi-model'

    if (useSolver && target) {
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
          // Debounced graph save — coalesces rapid tool calls into 1-2 writes
          getGlobalWorkspace().getGraphStore()?.scheduleSave()
        },
        onPhase: (event) => {
          if (event.text) {
            if (event.phase === 'reason') {
              log.dim(event.text)
            } else {
              process.stdout.write(event.text)
            }
          }
          if (event.toolName) log.dim(`  → ${event.toolName}`)

          resources.forensicLog.log({
            type: 'solver-phase',
            agent: 'solver-brain',
            phase: event.phase,
            step: event.step,
            toolName: event.toolName,
            toolArgs: event.toolArgs,
            reason: event.reason,
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
      if (result.text) {
        process.stdout.write(result.text)
      }
      log.info(`Steps: ${result.steps} | Facts: ${result.facts} | Intents: ${result.intents} | Tool calls: ${result.toolCalls}`)
      if (result.planSummary) {
        log.info('Plan summary:')
        log.info(result.planSummary)
      }
    } else {
      // Legacy supervisor: stream conversation
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
                reactions: reactionResult.reactions,
                summary: reactionResult.summary,
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
