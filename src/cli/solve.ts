import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULTS, loadConfig } from '../config'
import { showDisclaimer } from '../authorization'
import { createEngagementRuntime } from '../runtime/engagement-runtime'
import { createMemory, createMemoryStore } from '../workers/registry'
import { createEngineServices } from '../session/engine-setup'
import { solve, type SolveResult } from '../solver/solver'
import { createSolverRenderer } from '../session'
import { setExternalToolsConfig, setScopeConfig, bindScopeToTarget } from '../safety/scope-guard'
import { verifyPendingFindings } from '../tools/control-tools'
import { redactObject } from '../security/secret-vault'
import { generateCaseFile, type CaseFile } from '../report/case-file'
import { coreEvidenceLedger } from '../core/evidence'
import { logSolveSummary } from '../utils/solver-summary'
import { log } from '../utils/logger'
import { sanitizeDurableContext } from '../runtime/context-envelope'
import { createSolverBrain } from '../solver/brain-tools'
import { resolveModelRef } from '../models/routing'
import { isRecoverableModelFailure, modelKey, nextConfiguredModel } from '../solver/model-fallback'

export interface SolveCommandResult {
  workflowRef: string
  caseFile: CaseFile
  durationMs: number
  assessmentStatus?: SolveResult['assessmentStatus']
  assessmentReport?: SolveResult['assessmentReport']
  campaign?: SolveResult['campaign']
}

export async function solveCommand(
  target: string,
  outputDir: string,
  approvedOrigins: string[] = [],
  options: { quiet?: boolean; bounty?: boolean } = {},
): Promise<SolveCommandResult> {
  const config = loadConfig()
  if (options.bounty && !config.bounty?.enabled) {
    config.bounty = { enabled: true, ...(config.scope?.allowedCategories ? { allowedCategories: config.scope.allowedCategories } : {}) }
  }
  config.target = target
  const runtime = await createEngagementRuntime(config, target, { outputDir })
  let targetDirForFailure: string | undefined

  try {
    return await runtime.run(async () => {
      setScopeConfig(bindScopeToTarget(target, runtime.services.scopeConfig ?? config.scope))
      setExternalToolsConfig(config.externalTools ?? null)
      const runtimeConfig = runtime.config
      if (!options.quiet) showDisclaimer(target)

      const targetDir = runtime.workspace.getTargetDir(target)
      targetDirForFailure = targetDir
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
      const dbPath = resolve(targetDir, 'ultimatrix.db')
      const memoryStore = await createMemoryStore(dbPath)
      const memory = await createMemory(runtimeConfig, memoryStore, dbPath, { mainAgent: true })
      const identity = {
        threadId: `ultimatrix-solve-${runtime.workflow.state.workflowId}`,
        resourceId: 'ultimatrix',
        workflowId: runtime.workflow.state.workflowId,
        target,
      }
      const engine = await createEngineServices({
        config: runtimeConfig,
        memory,
        target,
        identity,
        workflow: runtime.workflow,
        runtime,
        approvedOrigins,
      })

      const goal = `Perform an authorized, evidence-backed security assessment of ${target}. Select and activate only the capabilities needed, and persist concrete evidence for any finding.`
      const maxRounds = runtimeConfig.solver?.maxRounds ?? DEFAULTS.solver.maxRounds
      let result: SolveResult | undefined
      let solverBrain = engine.solverBrain
      // Turn-level findings baseline (see session.ts): rounds after the
      // first must not report newFindings 0 for findings earlier rounds
      // recorded.
      let turnStartFindings: number | undefined
      try {
        const summary = runtime.graph.getTargetSummary()
        if (typeof summary?.totalFindings === 'number') turnStartFindings = summary.totalFindings
      } catch { /* graph unavailable — per-round snapshots still apply */ }
      const initialRoute = resolveModelRef(runtimeConfig, { role: 'brain' })
      const initialModel = modelKey(initialRoute.provider, initialRoute.model)
      const attemptedModels = new Set<string>([initialModel])
      for (let round = 1; round <= maxRounds; round++) {
        const renderer = options.quiet ? undefined : createSolverRenderer({}, {}, { plain: true })
        result = await solve(solverBrain!, {
          origin: target,
          goal,
          interactionMode: 'run',
          model: runtimeConfig.model,
          memory: { thread: identity.threadId, resource: identity.resourceId },
          blackboard: engine.sessionBlackboard,
          evidence: engine.sessionEvidence,
          loopDetector: engine.sessionLoopDetector,
          reflexion: engine.sessionReflexion,
          ultimatrixConfig: runtimeConfig,
          workflow: runtime.workflow,
          lazyServices: engine.lazyServices,
          turnStartFindings,
          config: {
            maxToolCalls: runtimeConfig.solver?.maxToolCalls ?? DEFAULTS.solver.maxToolCalls,
            maxDurationMs: runtimeConfig.solver?.maxDurationMs ?? DEFAULTS.solver.maxDurationMs,
            staleThreshold: runtimeConfig.antiLoop?.staleThreshold ?? DEFAULTS.antiLoop.staleThreshold,
            maxParallel: runtimeConfig.solver?.maxParallel ?? DEFAULTS.solver.maxParallel,
            progressTimeoutMs: runtimeConfig.solver?.progressTimeoutMs,
          },
          onMessage: renderer,
        })
        renderer?.final?.()
        if (isRecoverableModelFailure(result)) {
          const currentRoute = resolveModelRef(runtimeConfig, { role: 'brain' })
          const current = { provider: currentRoute.provider, model: currentRoute.model }
          const fallback = nextConfiguredModel(config, current, attemptedModels)
          if (fallback) {
            attemptedModels.add(modelKey(fallback.provider, fallback.model))
            engine.modelSelector?.recordFailure(current.provider, current.model)
            const fallbackConfig = {
              ...runtimeConfig,
              provider: fallback.provider,
              model: fallback.model,
              modelRoles: { ...(runtimeConfig.modelRoles ?? {}), brain: { provider: fallback.provider, model: fallback.model } },
            }
            solverBrain = createSolverBrain(fallbackConfig, {
              skillRegistry: engine.skillRegistry!,
              memory,
              modelSelector: engine.modelSelector,
              extensionRegistry: engine.extensionRegistry!,
              lazyServices: engine.lazyServices,
            })
            log.warn(`[model-fallback] Primary model unavailable; continuing with ${modelKey(fallback.provider, fallback.model)}`)
            continue
          }
        }
        if (
          result.completed ||
          result.reason === 'response_complete' ||
          result.reason === 'frontier_exhausted' ||
          ['model_failed', 'tool_unavailable', 'browser_failed', 'tool_failed', 'budget_reached', 'interrupted'].includes(result.reason)
        ) break
      }
      if (!result) throw new Error('Solver produced no result')
      if (!options.quiet) logSolveSummary(result)

      const verifier = runtimeConfig.verifier ?? DEFAULTS.verifier
      if (verifier.enabled) await verifyPendingFindings({ maxPerRound: verifier.maxPerRound, timeoutMs: verifier.timeoutMs })

      const reportDir = resolve(targetDir, 'reports')
      if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true })
      const reportPath = resolve(reportDir, `solve-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
      writeFileSync(reportPath, JSON.stringify(sanitizeDurableContext(redactObject(result as unknown)), null, 2), 'utf8')
      runtime.artifacts.create('report', { path: reportPath, initialStatus: 'redacted', provenance: [{ source: 'solve', ref: 'solveCommand' }] })
      const caseFile = generateCaseFile(runtime.graph, target, undefined, result.durationMs)
      const caseFilePath = resolve(reportDir, `case-file-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
      writeFileSync(caseFilePath, JSON.stringify(caseFile, null, 2), 'utf8')

      runtime.workflow.syncEvidence(coreEvidenceLedger.all())
      runtime.workflow.syncModelUsage(runtime.usage.getEntries())
      const failed = !result.completed && ['model_failed', 'tool_unavailable', 'browser_failed', 'tool_failed', 'budget_reached', 'interrupted'].includes(result.reason)
      runtime.workflow.setStatus(failed ? 'failed' : 'completed')
      await engine.lazyServices?.close()
      await engine.extensionRegistry?.closeAll()
      await runtime.close(failed
        ? { status: 'failed', error: result.error ?? `Solve did not complete: ${result.reason}` }
        : { status: 'completed' })
      if (failed) {
        throw new Error(result.error ?? `Solve did not complete: ${result.reason}`)
      }
      return {
        workflowRef: runtime.workflow.state.workflowId,
        caseFile,
        durationMs: result.durationMs,
        assessmentStatus: result.assessmentStatus,
        assessmentReport: result.assessmentReport,
        campaign: result.campaign,
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error(message)
    // Never let an early browser/provider failure disappear without a durable
    // artifact. The solver report is written only after the brain returns; a
    // failure during runtime/bootstrap previously left no evidence that the
    // run had started or where it stopped.
    try {
      const failureDir = targetDirForFailure ?? runtime.workspace.getTargetDir(target)
      if (!existsSync(failureDir)) mkdirSync(failureDir, { recursive: true })
      const reportDir = resolve(failureDir, 'reports')
      if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true })
      const failurePath = resolve(reportDir, `run-failure-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
      writeFileSync(failurePath, JSON.stringify({
        target,
        workflowId: runtime.workflow.state.workflowId,
        status: 'failed',
        phase: 'runtime-or-solver-bootstrap',
        error: message,
        timestamp: new Date().toISOString(),
      }, null, 2), 'utf8')
      log.warn(`Failure state saved: ${failurePath}`)
    } catch (persistError) {
      log.warn(`Could not persist failure state: ${persistError instanceof Error ? persistError.message : String(persistError)}`)
    }
    await runtime.close({ status: 'failed', error: error instanceof Error ? error.message : String(error) }).catch(() => {})
    throw error
  }
}
