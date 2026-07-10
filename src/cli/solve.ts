import { loadConfig, DEFAULTS } from '../config'
import { log } from '../utils/logger'
import { solve } from '../solver/solver'
import { createSolverBrain } from '../solver/brain-tools'
import { getGlobalWorkspace } from '../workspace'
import { showDisclaimer } from '../authorization'
import { createMemoryStore, createMemory } from '../workers/registry'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { verifyPendingFindings } from '../tools/control-tools'
import { startOastServer, stopOastServer } from '../oast/server'
import { getOrCreateBrowser, closeBrowser } from '../browser/manager'
import { SkillRegistry } from '../solver/skills/registry'
import { WorkerPool } from '../workers/pool'
import { Blackboard } from '../solver/blackboard'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { LoopDetector } from '../intelligence/anti-loop'
import { ReflexionEngine } from '../intelligence/reflexion'
import { createSpiderAgent } from '../spider/agent'
import { createInterface } from 'node:readline/promises'
import { bridgeHARToGraph } from '../analysis/har-bridge'
import { startHarCapture } from '../session/har-capture'
import { generateCaseFile } from '../report/case-file'

export async function solveCommand(target: string, outputDir: string): Promise<void> {
  const config = loadConfig()
  config.target = target

  showDisclaimer(target)

  const workspace = getGlobalWorkspace()
  await workspace.switchTarget(target)

  // Ensure graph is loaded
  await workspace.getGraphStore()?.load()

  // Start OAST server
  const oastPort = await startOastServer()
  log.info(`OAST server on port ${oastPort}`)

  // Start browser
  const browser = await getOrCreateBrowser(config)

  // Create memory
  const targetDir = workspace.getTargetDir(target)
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
  const dbPath = resolve(targetDir, 'ultimatrix.db')
  const store = await createMemoryStore(dbPath)
  const memory = await createMemory(config, store, dbPath)

  // Create solver brain with full tool wiring
  const skillRegistry = new SkillRegistry()
  const workerPool = new WorkerPool(config, skillRegistry, browser)

  const agent = createSolverBrain(config, {
    skillRegistry,
    workerPool,
    browser,
    memory,
  })

  // Intelligence layers
  const sessionBlackboard = new Blackboard({ origin: target, goal: 'CLI solve' })
  const sessionEvidence = new EvidenceGate()
  const sessionLoopDetector = new LoopDetector(config.antiLoop?.maxFailedTarget ?? DEFAULTS.antiLoop.maxFailedTarget)
  const sessionReflexion = config.reflexion?.enabled === false
    ? undefined
    : new ReflexionEngine({
        maxSameVulnFails: config.reflexion?.maxSameVulnFails,
        maxTotalNoProgress: config.reflexion?.maxTotalNoProgress,
        escalationMaxLevel: config.reflexion?.escalationMaxLevel,
      })

  log.info(`Starting solver engine against ${target}`)

  // First, run the spider to populate the graph (with HAR capture + streaming)
  let harJson: string | null = null
  try {
    log.info('Crawling target to populate graph...')
    const harCapture = await startHarCapture(target, [])

    const spiderAgent = createSpiderAgent(config, memory, browser)
    const spiderResult = await spiderAgent.stream(
      `Navigate to ${target} using stagehand_navigate. Use stagehand tools to dismiss overlays, discover forms and record them, detect auth flows. Record everything with the graph tools.`,
      { maxSteps: config.agent.maxSteps },
    )

    for await (const chunk of spiderResult.fullStream) {
      switch (chunk.type) {
        case 'text-delta':
        case 'reasoning-delta':
          process.stdout.write(chunk.payload.text)
          break
        case 'tool-call':
          if (chunk.payload.toolName !== 'askUser') {
            log.dim(`  \u2192 ${chunk.payload.toolName}`)
          }
          break
        case 'tool-error':
          log.error(`  ${chunk.payload.toolName}: ${chunk.payload.error}`)
          break
      }
    }
    process.stdout.write('\n')

    await workspace.getGraphStore()?.save()
    log.success('Spider crawl complete')

    // Stop HAR capture and bridge to graph
    try {
      harJson = await harCapture.stop()
      if (harJson) {
        const capturesDir = resolve(workspace.getTargetDir(target), 'captures')
        await mkdir(capturesDir, { recursive: true })
        const harPath = resolve(capturesDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.har`)
        await writeFile(harPath, harJson, 'utf-8')
        log.success('HAR saved: ' + harPath)

        const bridgeResult = await bridgeHARToGraph(harJson, target)
        log.success(`Analyser: ${bridgeResult.endpointsWritten} endpoints, ${bridgeResult.secretsWritten} secrets, ${bridgeResult.factsWritten} facts, ${bridgeResult.hypothesesGenerated} hypotheses → graph`)
      } else {
        log.dim('No HAR entries captured')
      }
    } catch (err) {
      log.dim('HAR bridge failed (non-fatal): ' + (err instanceof Error ? err.message : String(err)))
    }
  } catch (err) {
    log.error('Spider failed: ' + (err instanceof Error ? err.message : String(err)))
  }

  // Run the solver with goal-driven outer loop
  const maxRounds = config.solver?.maxRounds ?? DEFAULTS.solver.maxRounds
  let round = 0
  let lastResult = null
  const goal = `Perform a comprehensive security assessment of ${target}. Test for SQL injection, XSS, IDOR, authentication bypass, and any other vulnerabilities. Record all findings.`

  while (round < maxRounds) {
    round++
    log.info(`Solve round ${round}/${maxRounds}`)

    const result = await solve(agent, {
      origin: target,
      goal,
      model: config.model,
      blackboard: sessionBlackboard,
      evidence: sessionEvidence,
      loopDetector: sessionLoopDetector,
      reflexion: sessionReflexion,
      config: {
        maxToolCalls: config.solver?.maxToolCalls ?? DEFAULTS.solver.maxToolCalls,
        maxDurationMs: config.solver?.maxDurationMs ?? DEFAULTS.solver.maxDurationMs,
        staleThreshold: config.antiLoop?.staleThreshold ?? DEFAULTS.antiLoop.staleThreshold,
        maxParallel: config.solver?.maxParallel ?? DEFAULTS.solver.maxParallel,
      },
    })

    lastResult = result

    if (result.completed) {
      log.success(`Goal achieved in round ${round}: ${result.reason}`)
      break
    }

    if (result.reason === 'stale') {
      log.warn('Stale — no progress, stopping')
      break
    }

    if (round < maxRounds) {
      log.info(`Round ${round} incomplete (${result.reason}), retrying with updated context...`)
    }
  }

  const result = lastResult!

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
  log.info(`Tool calls: ${result.toolCalls} | Facts: ${result.facts} | Intents: ${result.intents} | Duration: ${result.durationMs}ms`)

  // Token cost estimate
  const estimatedTokens = Math.ceil(result.toolCalls * 500 + result.steps * 1000)
  log.info(`[tokens] estimated total: ~${estimatedTokens} tokens (tool calls: ${result.toolCalls} × 500 + steps: ${result.steps} × 1000)`)

  // Maker/Checker: verify pending findings
  const verifierConfig = config.verifier ?? DEFAULTS.verifier
  if (verifierConfig.enabled) {
    log.nl()
    log.info('Verifying pending findings...')
    const verification = await verifyPendingFindings({
      maxPerRound: verifierConfig.maxPerRound,
      timeoutMs: verifierConfig.timeoutMs,
    })
    if (verification.verified.length > 0) log.success(`  Verified: ${verification.verified.length}`)
    if (verification.disproven.length > 0) log.warn(`  Disproven: ${verification.disproven.length}`)
    if (verification.skipped.length > 0) log.dim(`  Skipped: ${verification.skipped.length}`)
  }

  // Save results
  const reportDir = resolve(workspace.getTargetDir(target), 'reports')
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true })
  const reportPath = resolve(reportDir, `solve-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf-8')
  log.success('Results saved: ' + reportPath)

  // Generate case file export
  try {
    const caseFile = generateCaseFile(workspace.getGraphStore()!, target, undefined, result.durationMs)
    const caseFilePath = resolve(reportDir, `case-file-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(caseFilePath, JSON.stringify(caseFile, null, 2), 'utf-8')
    log.success(`Case file: ${caseFile.metadata.totalFindings} findings, ${caseFile.metadata.totalEndpoints} endpoints → ${caseFilePath}`)
  } catch (err) {
    log.dim('Case file generation skipped: ' + (err instanceof Error ? err.message : String(err)))
  }

  // Cleanup
  await workspace.getGraphStore()?.save()
  await workspace.getOastStore()?.save()
  await stopOastServer()
  await closeBrowser()
}
