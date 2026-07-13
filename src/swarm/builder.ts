/**
 * @deprecated Use the council orchestrator (`src/council/orchestrator.ts`) or
 * the solver engine (`src/solver/solver.ts`) for agent coordination instead.
 * This module is retained solely for backward compatibility with legacy v6/v7
 * swarm workflows.
 */
import type { Agent } from '@mastra/core/agent'
import type { SkillRegistry } from '../solver/skills/registry'
import type { WorkerPool } from '../workers/pool'
import { detectCrossWorkerChains } from './chains'
import { formatSwarmResult } from './formatter'

export interface SwarmTask {
  skillId: string
  modelTier: 'fast' | 'balanced' | 'powerful'
  task: string
  context?: any
}

export interface SwarmResult {
  workerId: string
  skillId: string
  result: string
  findings: any[]
  error?: string
}

export interface SwarmInput {
  tasks: Array<{
    skillId: string
    modelTier: 'fast' | 'balanced' | 'powerful'
    task: string
    context?: any
  }>
  skillRegistry: SkillRegistry
  workerPool: WorkerPool
}

export interface SwarmOutput {
  completed: number
  results: SwarmResult[]
  chains: any[]
  summary: string
}

export async function runSwarm(input: SwarmInput): Promise<SwarmOutput> {
  const { tasks, workerPool } = input

  const swarmTasks: Array<{ config: SwarmTask; worker: Agent }> = []
  for (const task of tasks) {
    const worker = workerPool.spawn({
      skillId: task.skillId,
      task: task.task,
      tier: task.modelTier,
    })
    swarmTasks.push({
      config: { skillId: task.skillId, modelTier: task.modelTier, task: task.task, context: task.context },
      worker,
    })
  }

  const settled = await Promise.allSettled(
    swarmTasks.map(async ({ config, worker }) => {
      try {
        const result = await worker.generate(config.task)
        return {
          workerId: worker.id,
          skillId: config.skillId,
          result: result.text,
          findings: extractFindings(result),
        } as SwarmResult
      } catch (e) {
        return {
          workerId: worker.id,
          skillId: config.skillId,
          result: '',
          findings: [],
          error: e instanceof Error ? e.message : String(e),
        } as SwarmResult
      }
    }),
  )

  const results: SwarmResult[] = settled.map(s =>
    s.status === 'fulfilled' ? s.value : {
      workerId: 'unknown',
      skillId: 'unknown',
      result: '',
      findings: [],
      error: s.reason?.message || String(s.reason),
    },
  )

  const chains = detectCrossWorkerChains(results)

  return {
    completed: results.filter(r => !r.error).length,
    results,
    chains,
    summary: formatSwarmResult({ completed: results.filter(r => !r.error).length, results, chains }),
  }
}

function extractFindings(result: any): any[] {
  const findings: any[] = []
  if (result.toolCalls) {
    for (const tc of result.toolCalls) {
      if (tc.toolName === 'writeFinding' && tc.result?.ok) {
        findings.push(tc.result.value)
      }
    }
  }
  return findings
}
