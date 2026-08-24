import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULTS, loadConfig } from '../config'
import { showDisclaimer } from '../authorization'
import { createEngagementRuntime } from '../runtime/engagement-runtime'
import { createMemory, createMemoryStore } from '../workers/registry'
import { createEngineServices } from '../session/engine-setup'
import { solve, type SolveResult } from '../solver/solver'
import { createSolverRenderer } from '../session'
import { setExternalToolsConfig, setScopeConfig, deriveScopeFromTarget } from '../safety/scope-guard'
import { verifyPendingFindings } from '../tools/control-tools'
import { redactObject } from '../security/secret-vault'
import { generateCaseFile, type CaseFile } from '../report/case-file'
import { coreEvidenceLedger } from '../core/evidence'
import { logSolveSummary } from '../utils/solver-summary'
import { log } from '../utils/logger'
import { sanitizeDurableContext } from '../runtime/context-envelope'

export interface SolveCommandResult {
  workflowRef: string
  caseFile: CaseFile
  durationMs: number
}

export async function solveCommand(
  target: string,
  outputDir: string,
  approvedOrigins: string[] = [],
  options: { quiet?: boolean } = {},
): Promise<SolveCommandResult> {
  const config = loadConfig()
  config.target = target
  const runtime = await createEngagementRuntime(config, target, { outputDir })

  try {
    return await runtime.run(async () => {
      setScopeConfig(config.scope ?? deriveScopeFromTarget(target))
      setExternalToolsConfig(config.externalTools ?? null)
      if (!options.quiet) showDisclaimer(target)

      const targetDir = runtime.workspace.getTargetDir(target)
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
      const dbPath = resolve(targetDir, 'ultimatrix.db')
      const memoryStore = await createMemoryStore(dbPath)
      const memory = await createMemory(config, memoryStore, dbPath, { mainAgent: true })
      const identity = {
        threadId: `ultimatrix-solve-${runtime.workflow.state.workflowId}`,
        resourceId: 'ultimatrix',
        workflowId: runtime.workflow.state.workflowId,
        target,
      }
      const engine = await createEngineServices({
        config,
        memory,
        target,
        identity,
        workflow: runtime.workflow,
        runtime,
        approvedOrigins,
      })

      const goal = `Perform an authorized, evidence-backed security assessment of ${target}. Select and activate only the capabilities needed, and persist concrete evidence for any finding.`
      const maxRounds = config.solver?.maxRounds ?? DEFAULTS.solver.maxRounds
      let result: SolveResult | undefined
      for (let round = 1; round <= maxRounds; round++) {
        const renderer = options.quiet ? undefined : createSolverRenderer({}, {}, { plain: true })
        result = await solve(engine.solverBrain!, {
          origin: target,
          goal,
          interactionMode: 'run',
          model: config.model,
          memory: { thread: identity.threadId, resource: identity.resourceId },
          blackboard: engine.sessionBlackboard,
          evidence: engine.sessionEvidence,
          loopDetector: engine.sessionLoopDetector,
          reflexion: engine.sessionReflexion,
          ultimatrixConfig: config,
          workflow: runtime.workflow,
          config: {
            maxToolCalls: config.solver?.maxToolCalls ?? DEFAULTS.solver.maxToolCalls,
            maxDurationMs: config.solver?.maxDurationMs ?? DEFAULTS.solver.maxDurationMs,
            staleThreshold: config.antiLoop?.staleThreshold ?? DEFAULTS.antiLoop.staleThreshold,
            maxParallel: config.solver?.maxParallel ?? DEFAULTS.solver.maxParallel,
          },
          onMessage: renderer,
        })
        renderer?.final?.()
        if (result.completed || result.reason === 'stale' || result.reason === 'response_complete') break
      }
      if (!result) throw new Error('Solver produced no result')
      if (!options.quiet) logSolveSummary(result)

      const verifier = config.verifier ?? DEFAULTS.verifier
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
      runtime.workflow.setStatus('completed')
      await engine.lazyServices?.close()
      await engine.extensionRegistry?.closeAll()
      await runtime.close({ status: 'completed' })
      return { workflowRef: runtime.workflow.state.workflowId, caseFile, durationMs: result.durationMs }
    })
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error))
    await runtime.close({ status: 'failed', error: error instanceof Error ? error.message : String(error) }).catch(() => {})
    throw error
  }
}
