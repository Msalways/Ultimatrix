import { loadConfig } from '../config'
import { log } from '../utils/logger'
import { solve } from '../solver/solver'
import { createSolverBrain } from '../solver/brain-tools'
import { getGlobalWorkspace } from '../workspace'
import { showDisclaimer } from '../authorization'
import { createAllWorkers, createMemoryStore } from '../workers/registry'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'

export async function solveCommand(target: string, outputDir: string): Promise<void> {
  const config = loadConfig()
  config.target = target

  showDisclaimer(target)

  const workspace = getGlobalWorkspace()
  await workspace.switchTarget(target)

  // Create fully-wired solver brain (all tools, no browser in CLI mode)
  const { SkillRegistry } = await import('../skills/registry')
  const { WorkerPool } = await import('../workers/pool')
  const skillRegistry = new SkillRegistry()
  const workerPool = new WorkerPool(config, skillRegistry)

  const agent = createSolverBrain(config, {
    skillRegistry,
    workerPool,
  })

  log.info(`Starting solver engine against ${target}`)

  const result = await solve(agent, {
    origin: target,
    goal: config.target || 'Find vulnerabilities',
    config: {
      maxToolCalls: config.solver?.maxToolCalls || 50,
      maxDurationMs: config.solver?.maxDurationMs || 300000,
      staleThreshold: config.antiLoop?.staleThreshold || 3,
    },
  })

  log.nl()
  if (result.completed) {
    log.success(`Solver completed: ${result.reason}`)
  } else {
    log.warn(`Solver stopped: ${result.reason}`)
  }
  log.info(`Tool calls: ${result.toolCalls} | Facts: ${result.facts} | Intents: ${result.intents}`)

  // Save results
  const reportDir = resolve(workspace.getTargetDir(target), 'reports')
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true })
  const reportPath = resolve(reportDir, `solve-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf-8')
  log.success('Results saved: ' + reportPath)
}
