import { createSupervisor } from './manager/agent'
import { getOrCreateBrowser, closeBrowser, getActivePage } from './browser/manager'
import { loadConfig } from './config'
import { log } from './utils/logger'
import { startOastServer, stopOastServer } from './oast/server'
import { createAllWorkers, createMemoryStore, createMemory } from './workers/registry'
import { userInputEmitter } from './tools/interaction-tools'
import { detectChains } from './intelligence/chaining'
import type { FindingNode } from './graph/schema'
import { createSpiderAgent } from './spider/agent'
import { createInterface } from 'node:readline/promises'
import { getGlobalWorkspace } from './workspace'
import { NetworkCapture } from './capture/network-capture'
import { chromium } from 'playwright'
import { resolve, dirname } from 'node:path'
import { ForensicLog } from './logging/forensic-log'
import { setForensicLog } from './tools/report-tools'
import { writeFile, mkdir } from 'node:fs/promises'
import { mkdirSync, existsSync } from 'node:fs'
import { Agent } from '@mastra/core/agent'
import { createToolRegistry } from './mastra/tools'
import { createAgent } from './mastra/index.js'
import { createSolverBrain } from './solver/brain-tools'
import { solve } from './solver/solver'
import { Blackboard } from './solver/blackboard'
import { EvidenceGate } from './intelligence/evidence-gate'
import { LoopDetector } from './intelligence/anti-loop'
import { ReflexionEngine } from './intelligence/reflexion'
import { CORE_CONTRACT } from './prompts/core-contract.js'
import { resolveSkillsForInput } from './skills/tool-filter'
import { HumanObserver, getGlobalObserver } from './capture/human-observer'
import { setActiveBrowser } from './browser/manager'
import { setReadlineInterface } from './tools/interaction-tools'
import { resolveModel } from './models/factory'
import { SkillRegistry } from './skills/registry'
import { WorkerPool } from './workers/pool'
import { bridgeHARToGraph } from './analysis/har-bridge'

const internalTools = new Set(['updateWorkingMemory', 'setWorkingMemory'])

async function startHarCapture(target: string, excludeDomains: string[]): Promise<{
  capture: NetworkCapture
  browser: Awaited<ReturnType<typeof chromium.launch>>
  stop: () => Promise<string | null>
}> {
  const captureBrowser = await chromium.launch({ headless: true })
  const page = await captureBrowser.newPage()
  const capture = new NetworkCapture({ excludeDomains })
  capture.start(page)

  page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})

  return {
    capture,
    browser: captureBrowser,
    stop: async () => {
      capture.stop()
      await capture.flush()
      await captureBrowser.close()
      const entries = capture.getEntries()
      if (entries.length === 0) return null
      const har = capture.exportHar()
      return JSON.stringify(har, null, 2)
    },
  }
}

export async function main(targetUrl?: string) {
  const config = loadConfig()
  if (targetUrl) config.target = targetUrl

  const workspace = getGlobalWorkspace()
  const target = config.target || ''
  const threadBase = target
    ? `ultimatrix-${target.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}`
    : 'ultimatrix'
  const resourceId = 'ultimatrix'

  // PERSIST-5: Per-target DB path — ensure directory exists first
  if (target) {
    const dir = workspace.getTargetDir(target)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  const dbPath = target
    ? resolve(workspace.getTargetDir(target), 'ultimatrix.db')
    : undefined
  const store = await createMemoryStore(dbPath)
  const memory = await createMemory(config, store, dbPath)

  // PERSIST-1: Deterministic threadId — resume latest existing thread or create new
  const { threads: existingThreads } = await memory.listThreads({ filter: { resourceId } })
  const targetThread = existingThreads.find((t: any) => t.id.startsWith(threadBase))
  const threadId = targetThread?.id || threadBase

  if (targetThread) {
    log.info(`Resuming existing session: ${threadId}`)
  } else if (target) {
    // PERSIST-2: Create thread with target URL metadata
    await memory.saveThread({
      thread: {
        id: threadId,
        title: `Ultimatrix — ${target}`,
        resourceId,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: { targetUrl: target },
      },
    })
  }

  if (target) {
    await workspace.switchTarget(target)
  }

  // LOG-1: Initialize forensic log per session
  const slug = target
    ? target.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
    : 'default'
  const forensicLogPath = resolve(workspace.getTargetDir(target || '.'), 'forensic.ndjson')
  const forensicLog = new ForensicLog(forensicLogPath)
  setForensicLog(forensicLog)

  const [browser, oastPort] = await Promise.all([
    (async () => {
      const b = getOrCreateBrowser(config)
      await b.ensureReady()
      return b
    })(),
    startOastServer(),
  ])
  log.info(`OAST server started on port ${oastPort}`)

  // Wire human observer for browser interaction capture
  const observer = getGlobalObserver()
  const attachObserver = () => {
    const page = getActivePage()
    if (page && !observer.isCapturing()) {
      observer.attach(page)
      observer.onAction((action) => {
        forensicLog.log({
          type: 'human-action',
          agent: 'human',
          args: { type: action.type, selector: action.selector, url: action.url, value: action.value },
        })
      })
      log.dim('👁️ Human action capture active')
    }
  }
  setTimeout(attachObserver, 3000)

  if (!config.browser.headless) {
    log.info('🌐 Browser is visible — interact with it directly')
    log.info('   The agent captures your actions automatically')
  } else {
    log.dim('🔒 Browser is headless (set HEADLESS=false to see it)')
  }

  let harCapture: Awaited<ReturnType<typeof startHarCapture>> | null = null
  if (target) {
    try {
      const targetHost = new URL(target).hostname
      harCapture = await startHarCapture(target, ['localhost', '127.0.0.1'])
      log.info('HAR capture started')
    } catch (err) {
      log.dim('HAR capture unavailable: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
  setReadlineInterface(rl)

  // Graceful shutdown on Ctrl+C
  let shuttingDown = false
  process.on('SIGINT', async () => {
    if (shuttingDown) {
      log.info('Forced exit.')
      process.exit(1)
    }
    shuttingDown = true
    process.stdout.write('\n')
    log.info('Shutting down gracefully...')
    try {
      await Promise.all([
        workspace.getGraphStore()?.save(),
        workspace.getOastStore()?.save(),
      ])
      if (harCapture) {
        try { await harCapture.stop() } catch {}
      }
      await stopOastServer()
      await closeBrowser()
      rl.close()

      // Print session summary
      const graph = workspace.getGraphStore()
      if (graph) {
        const summary = graph.getTargetSummary()
        log.nl()
        log.info('=== Session Summary ===')
        if (target) log.info(`Target: ${target}`)
        log.info(`Endpoints: ${summary.totalEndpoints} (${summary.totalCapturedHeaders} with headers)`)
        log.info(`Findings: ${Object.entries(summary.findingsBySeverity).filter(([, c]) => c > 0).map(([s, c]) => `${s}=${c}`).join(', ') || 'none'}`)
        log.info(`Auth flows: ${summary.authFlows} | RBAC roles: ${summary.rbacRoles}`)
        log.info(`Untested actions: ${summary.untestedActions}`)
      }
    } catch {
      // Best-effort cleanup
    }
    process.exit(0)
  })

  function getLine(): Promise<string | null> {
    return new Promise(resolve => {
      const onLine = (line: string) => {
        rl.removeListener('close', onClose)
        resolve(line)
      }
      const onClose = () => {
        rl.removeListener('line', onLine)
        resolve(null)
      }
      rl.once('line', onLine)
      rl.once('close', onClose)
    })
  }

  userInputEmitter.on('askUser-question', (question: string) => {
    process.stdout.write('\n' + question + ' ')
    rl.once('line', (answer: string) => {
      userInputEmitter.emit('askUser-response', answer)
    })
  })

  async function consumeStream(stream: AsyncIterable<any>, agentId?: string) {
    let textBuf: string[] = []
    let lastToolCall: { name: string; args?: unknown; time: number } | null = null

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
          // LOG-2: Record tool call event
          lastToolCall = { name: chunk.payload.toolName, args: chunk.payload.args, time: Date.now() }
          forensicLog.log({
            type: 'tool-call',
            agent: agentId || 'supervisor',
            tool: chunk.payload.toolName,
            args: chunk.payload.args as Record<string, unknown>,
          })
          break
        case 'tool-result':
          if (internalTools.has(chunk.payload.toolName)) break
          flushText(false)
          log.success(chunk.payload.toolName)
          // LOG-2: Record tool result event
          forensicLog.log({
            type: 'tool-result',
            agent: agentId || 'supervisor',
            tool: chunk.payload.toolName,
            result: chunk.payload.result,
            duration: lastToolCall ? Date.now() - lastToolCall.time : undefined,
          })
          lastToolCall = null
          break
        case 'tool-error':
          flushText(false)
          log.error(chunk.payload.toolName + ': ' + chunk.payload.error)
          // LOG-2: Record tool error event
          forensicLog.log({
            type: 'tool-error',
            agent: agentId || 'supervisor',
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
            agent: agentId || 'supervisor',
            error: String(chunk.payload.error),
          })
          break
        case 'step-finish':
          flushText(true)
          workspace.getGraphStore()?.save().catch(err => log.error('Graph save failed: ' + String(err)))
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
      }
    }
    flushText(true)
  }

  let harContextForLLM: string | undefined

  if (target) {
    // Ensure graph is loaded and check existing crawl data
    await workspace.getGraphStore()?.load()
    const existingSummary = workspace.getGraphStore()?.getTargetSummary()
    
    let shouldCrawl = true
    if (existingSummary && existingSummary.totalEndpoints > 0) {
      log.info(`Graph already has ${existingSummary.totalEndpoints} endpoints, ${existingSummary.totalFindings} findings for this target.`)
      log.dim('Existing crawl data detected. The spider will check existing data first (Phase 0) and ask if you want a fresh crawl.')
      // The spider's Phase 0 will handle asking the user about fresh vs continued crawl
    }
    
    try {
      log.info('Crawling ' + target + '...')
      const spiderAgent = createSpiderAgent(config, memory, browser)
      const result = await spiderAgent.stream(
        `Navigate to ${target} using stagehand_navigate. Use stagehand tools to dismiss overlays, discover forms and record them, detect auth flows and record their structure (do NOT submit login forms without credentials). Record everything with the graph tools. Report all findings.`,
        { memory: { thread: threadId + '-spider', resource: resourceId + '-spider' }, maxSteps: config.agent.maxSteps },
      )
      await consumeStream(result.fullStream, 'spider')
      await workspace.getGraphStore()?.save()
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err))
      workspace.getGraphStore()?.save().catch(() => {})
    }
  }

  if (harCapture && target) {
    try {
      const harJson = await harCapture.stop()
      if (harJson) {
        const capturesDir = resolve(workspace.getTargetDir(target), 'captures')
        await mkdir(capturesDir, { recursive: true })
        const harPath = resolve(capturesDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.har`)
        await writeFile(harPath, harJson, 'utf-8')
        log.success('HAR saved: ' + harPath)

        // Bridge HAR analysis → graph + LLM context
        try {
          const bridgeResult = await bridgeHARToGraph(harJson, target)
          if (bridgeResult.contextForLLM) {
            harContextForLLM = bridgeResult.contextForLLM
            log.success(`HAR bridge: ${bridgeResult.endpointsWritten} endpoints, ${bridgeResult.secretsWritten} secrets, ${bridgeResult.factsWritten} facts, ${bridgeResult.hypothesesGenerated} hypotheses → graph`)
          }
        } catch (err) {
          log.dim('HAR bridge failed (non-fatal): ' + (err instanceof Error ? err.message : String(err)))
        }
      } else {
        log.dim('No HAR entries captured')
      }
    } catch (err) {
      log.error('HAR save failed: ' + (err instanceof Error ? err.message : String(err)))
    }
    harCapture = null
  }

  const useSolver = config.engine === 'solver'

  let workers: Awaited<ReturnType<typeof createAllWorkers>> | undefined
  let supervisor: Awaited<ReturnType<typeof createSupervisor>> | undefined
  let solverBrain: Agent | undefined
  let skillRegistry: SkillRegistry | undefined
  let workerPool: WorkerPool | undefined
  let sessionBlackboard: Blackboard | undefined
  let sessionEvidence: EvidenceGate | undefined
  let sessionLoopDetector: LoopDetector | undefined
  let sessionReflexion: ReflexionEngine | undefined

  if (!useSolver) {
    workers = await createAllWorkers(config, browser, memory)
    supervisor = createSupervisor(config, { workers, browser, memory })
  } else {
    skillRegistry = new SkillRegistry()
    skillRegistry.loadFromDirectory('skills')
    workerPool = new WorkerPool(config, skillRegistry, browser)
    solverBrain = createSolverBrain(config, {
      skillRegistry,
      workerPool,
      browser,
      memory,
      extraContext: harContextForLLM,
    })
    sessionBlackboard = new Blackboard({ origin: target || 'unknown', goal: 'Session started' })
    sessionEvidence = new EvidenceGate()
    sessionLoopDetector = new LoopDetector()
    sessionReflexion = new ReflexionEngine()
    log.info('Solver engine ready with orchestration tools')
  }

  log.banner(
    'Ultimatrix v8',
    'Model: ' + config.model + (target ? '  |  Target: ' + target : '') + `  |  OAST: :${oastPort}` + (useSolver ? '  |  Engine: solver' : '  |  Engine: legacy'),
  )

  if (!target) {
    log.info('No target set. Tell me a URL to investigate.')
  }

  log.nl()
  log.dim(useSolver
    ? 'Entering interactive mode (solver engine). Type your goal or Ctrl+C to exit.'
    : 'Entering interactive mode. Type your message or Ctrl+C to exit.')
  log.nl()

  try {
    for (;;) {
      process.stdout.write('> ')
      const line = await getLine()
      if (line === null) break
      if (!line.trim()) continue

      try {
        process.stdout.write('\n')

        // Dispatch skills based on user input
        const matchedSkills = resolveSkillsForInput(line)
        if (matchedSkills.length > 0) {
          log.dim(`Skills: ${matchedSkills.map(s => s.name).join(', ')}`)
        }

        if (useSolver && target) {
          // Solver engine: reuse pre-created brain (same agent instance across all messages)
          const result = await solve(solverBrain!, {
            origin: target,
            goal: line,
            model: config.model,
            memory: { thread: threadId, resource: resourceId },
            matchedSkills: matchedSkills.length > 0 ? matchedSkills : undefined,
            blackboard: sessionBlackboard,
            evidence: sessionEvidence,
            loopDetector: sessionLoopDetector,
            reflexion: sessionReflexion,
            config: {
              maxToolCalls: config.solver?.maxToolCalls || 50,
              maxDurationMs: config.solver?.maxDurationMs || 300000,
              staleThreshold: config.antiLoop?.staleThreshold || 3,
              maxParallel: config.solver?.maxParallel || 1,
            },
            onToolComplete: (_toolName: string, result?: unknown) => {
              // Feed tool result into session evidence gate for anti-hallucination tracking
              if (result && sessionEvidence) {
                const output = typeof result === 'string' ? result : JSON.stringify(result)
                sessionEvidence.recordToolOutput(output)
              }
              workspace.getGraphStore()?.save().catch(err =>
                log.error('Graph save failed during solver: ' + String(err))
              )
            },
            onPhase: (event) => {
              if (event.text) {
                process.stdout.write(event.text)
              }

              if (event.toolName) {
                log.dim(`  → ${event.toolName}`)
              }

              forensicLog.log({
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
          log.info(`Steps: ${result.steps} | Facts: ${result.facts} | Intents: ${result.intents} | Tool calls: ${result.toolCalls}`)
          if (result.planSummary) {
            log.info('Plan summary:')
            log.info(result.planSummary)
          }
        } else {
          // Legacy supervisor: stream conversation
          const result = await supervisor!.stream(line, {
            memory: { thread: threadId, resource: resourceId },
            maxSteps: config.agent.maxSteps,
          })
          await consumeStream(result.fullStream, 'supervisor')
        }

        process.stdout.write('\n')

        const graph = workspace.getGraphStore()
        if (graph) {
          const allNodes = graph.queryNodes()
          const findings = allNodes.filter(n => n.type === 'Finding') as FindingNode[]
          if (findings.length > 0) {
            const chains = detectChains(findings)
            for (const chain of chains) {
              log.info('Chain detected: ' + chain.rule.name + ' — ' + chain.source.properties.technique + ' → ' + chain.target.properties.technique + ' (' + chain.rule.severity + ')')
              // Feed chain into blackboard so next solve() turn knows about it
              sessionBlackboard?.addFact(
                `Chain detected: ${chain.source.properties.technique} → ${chain.target.properties.technique} (${chain.rule.description}) [severity=${chain.rule.severity}]`,
                'chain',
              )
            }
          }
        }

        await Promise.all([
          workspace.getGraphStore()?.save(),
          workspace.getOastStore()?.save(),
        ])
      } catch (err) {
        process.stdout.write('\n')
        log.error(err instanceof Error ? err.message : String(err))
      }
      process.stdout.write('\n')
    }
  } finally {
    await Promise.all([
      workspace.getGraphStore()?.save(),
      workspace.getOastStore()?.save(),
    ])
    if (harCapture) {
      try {
        const harJson = await harCapture.stop()
        if (harJson && target) {
          const capturesDir = resolve(workspace.getTargetDir(target), 'captures')
          await mkdir(capturesDir, { recursive: true })
          const harPath = resolve(capturesDir, `session-${new Date().toISOString().replace(/[:.]/g, '-')}.har`)
          await writeFile(harPath, harJson, 'utf-8')
        }
      } catch {}
    }
    await stopOastServer()
    await closeBrowser()
    rl.close()

    // Print session summary
    const graph = workspace.getGraphStore()
    if (graph) {
      const summary = graph.getTargetSummary()
      log.nl()
      log.info('=== Session Summary ===')
      if (target) log.info(`Target: ${target}`)
      log.info(`Endpoints: ${summary.totalEndpoints} (${summary.totalCapturedHeaders} with headers)`)
      const findings = Object.entries(summary.findingsBySeverity).filter(([, c]) => c > 0)
      log.info(`Findings: ${findings.map(([s, c]) => `${s}=${c}`).join(', ') || 'none'}`)
      log.info(`Auth flows: ${summary.authFlows} | RBAC roles: ${summary.rbacRoles}`)
      log.info(`Untested actions: ${summary.untestedActions}`)
    }
  }
}
