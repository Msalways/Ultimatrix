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
import { createSolverBrain } from '../solver/brain-tools'
import { resolveModelRef } from '../models/routing'

function isRecoverableModelFailure(result: SolveResult): boolean {
  if (result.reason !== 'model_failed') return false
  const message = `${result.error ?? ''}`.toLowerCase()
  // Route on provider-neutral transport/model failures. Do not key this on
  // vendor names: any configured adapter may return these conditions.
  const status = message.match(/\b(400|404|408|409|429|500|502|503|504)\b/)?.[1]
  return Boolean(status)
    || message.includes('service_unavailable')
    || message.includes('temporarily overloaded')
    || message.includes('rate limit')
    || message.includes('quota')
    || message.includes('cannot connect')
    || message.includes('connection refused')
    || message.includes('network')
    || message.includes('stream startup timed out')
    || message.includes('progress stalled')
    || message.includes('provider returned error')
    || message.includes('model not found')
    || message.includes('unsupported model')
}

export function nextConfiguredModel(config: any, current: any, attempted: Set<string>): { provider: string; model: string } | undefined {
  const normalize = (provider: unknown, rawModel: unknown) => {
    const value = String(rawModel ?? '').trim()
    if (!value) return undefined
    const configuredProvider = String(provider ?? '').trim()
    // Provider model IDs (notably OpenRouter's `org/model`) legitimately
    // contain a slash. Only split a slash when it is the configured provider
    // prefix; otherwise preserve the model ID verbatim.
    const hasProviderPrefix = configuredProvider && value.startsWith(`${configuredProvider}/`)
    const resolvedProvider = configuredProvider || (value.includes('/') ? value.slice(0, value.indexOf('/')) : String(config.provider))
    const model = hasProviderPrefix ? value.slice(configuredProvider.length + 1) : value
    return { provider: resolvedProvider, model, key: `${resolvedProvider}/${model}` }
  }
  const candidates: Array<{ provider: string; model: string; key: string }> = []
  const add = (provider: unknown, model: unknown) => {
    const candidate = normalize(provider, model)
    if (candidate && !candidates.some(existing => existing.key === candidate.key)) candidates.push(candidate)
  }
  const addTier = (tier: unknown) => {
    const value = config.modelTiers?.[String(tier)]
    if (typeof value === 'string') add(config.provider, value)
    else if (value && typeof value === 'object') add(value.provider, value.model)
  }

  // Tier routing is the live authority. Put the brain's configured tier first
  // so configured role routing is a real failover rather than an ignored setting.
  addTier(config.modelRoleTiers?.brain ?? 'fast')
  add(config.modelRoles?.brain?.provider, config.modelRoles?.brain?.model)
  addTier('fast')
  addTier('balanced')
  addTier('powerful')
  for (const role of Object.values(config.modelRoles ?? {})) {
    if (role && typeof role === 'object' && 'provider' in role) add((role as any).provider, (role as any).model)
  }
  for (const key of Object.keys(config.modelCapabilities ?? {})) add(config.provider, key)
  // Provider credential files may declare a provider-local default model. This
  // is a generic failover source; it does not assume vendor names or model
  // prefixes and only considers credentials already loaded by config.
  for (const [provider, credentials] of Object.entries(config.creds ?? {})) {
    if (credentials && typeof credentials === 'object' && 'model' in credentials) {
      add(provider, (credentials as { model?: unknown }).model)
    }
  }

  const currentProvider = current?.provider ?? config.provider
  const currentModel = normalize(currentProvider, current?.model ?? config.model)?.key
  return candidates.find(candidate => candidate.key !== currentModel && !attempted.has(candidate.key))
}

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
  let targetDirForFailure: string | undefined

  try {
    return await runtime.run(async () => {
      setScopeConfig(config.scope ?? deriveScopeFromTarget(target))
      setExternalToolsConfig(config.externalTools ?? null)
      if (!options.quiet) showDisclaimer(target)

      const targetDir = runtime.workspace.getTargetDir(target)
      targetDirForFailure = targetDir
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
      let solverBrain = engine.solverBrain
      const initialRoute = resolveModelRef(config, { role: 'brain' })
      const initialModel = `${initialRoute.provider}/${initialRoute.model}`
      const attemptedModels = new Set<string>([initialModel])
      for (let round = 1; round <= maxRounds; round++) {
        const renderer = options.quiet ? undefined : createSolverRenderer({}, {}, { plain: true })
        result = await solve(solverBrain!, {
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
          lazyServices: engine.lazyServices,
          config: {
            maxToolCalls: config.solver?.maxToolCalls ?? DEFAULTS.solver.maxToolCalls,
            maxDurationMs: config.solver?.maxDurationMs ?? DEFAULTS.solver.maxDurationMs,
            staleThreshold: config.antiLoop?.staleThreshold ?? DEFAULTS.antiLoop.staleThreshold,
            maxParallel: config.solver?.maxParallel ?? DEFAULTS.solver.maxParallel,
          },
          onMessage: renderer,
        })
        renderer?.final?.()
        if (isRecoverableModelFailure(result)) {
          const currentRoute = resolveModelRef(config, { role: 'brain' })
          const current = { provider: currentRoute.provider, model: currentRoute.model }
          const fallback = nextConfiguredModel(config, current, attemptedModels)
          if (fallback) {
            attemptedModels.add(`${fallback.provider}/${fallback.model}`)
            engine.modelSelector?.recordFailure(current.provider, current.model)
            const fallbackConfig = {
              ...config,
              provider: fallback.provider,
              model: fallback.model,
              modelRoles: { ...(config.modelRoles ?? {}), brain: { provider: fallback.provider, model: fallback.model } },
            }
            solverBrain = createSolverBrain(fallbackConfig, {
              skillRegistry: engine.skillRegistry!,
              memory,
              modelSelector: engine.modelSelector,
              extensionRegistry: engine.extensionRegistry!,
              lazyServices: engine.lazyServices,
            })
            log.warn(`[model-fallback] Primary model unavailable; continuing with ${fallback.provider}/${fallback.model}`)
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
      return { workflowRef: runtime.workflow.state.workflowId, caseFile, durationMs: result.durationMs }
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
