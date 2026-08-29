/**
 * Pheromone Scheduler - Stigmergic Task Scheduler
 * 
 * Replaces simple maxParallel with pheromone-weighted priority queue.
 * Workers subscribe to pheromone signals; tasks with higher pheromone
 * concentration get scheduled first.
 */

import { getPheromoneCoordinator, type PheromoneSignal } from './pheromone-coordinator';

export interface TaskWithPheromone {
  id: string;
  objective: string;
  skillId: string;
  priority: number;
  pheromoneBoost: number;
  contextRefs: string[];
  requiredCapabilities: string[];
  complexity: 'low' | 'medium' | 'high' | 'critical';
}

interface QueuedTask {
  task: TaskWithPheromone;
  pheromone: number;
  enqueuedAt: number;
}

export class PheromoneScheduler {
  private queue: QueuedTask[] = [];
  private maxConcurrency: number;
  private running = new Set<string>();

  constructor(maxConcurrency = 10) {
    this.maxConcurrency = maxConcurrency;
  }

  setMaxConcurrency(max: number): void {
    this.maxConcurrency = max;
  }

  enqueue(task: TaskWithPheromone): void {
    const basePheromone = task.pheromoneBoost;
    const pheromoneCoordinator = getPheromoneCoordinator();
    
    // Boost by relevant pheromones on the target
    const signals = pheromoneCoordinator.getSignals('global');
    let pheromoneBoost = 0;
    
    for (const signal of signals) {
      if (signal.expiresAt > Date.now()) {
        // Boost if signal is relevant to this task
        if (this.isSignalRelevant(signal)) {
          pheromoneBoost += signal.strength * 0.5;
        }
      }
    }

    this.queue.push({
      task,
      pheromone: basePheromone + pheromoneBoost,
      enqueuedAt: Date.now(),
    });
    
    // Sort by pheromone (highest first)
    this.queue.sort((a, b) => b.pheromone - a.pheromone);
  }

  private isSignalRelevant(_signal: PheromoneSignal): boolean {
    // Check if signal is relevant to current execution context
    // This could be expanded based on skill types, target domains, etc.
    return true;
  }

  async dequeue(): Promise<TaskWithPheromone | null> {
    if (this.queue.length === 0) return null;
    
    // Filter running tasks
    if (this.running.size >= this.maxConcurrency) {
      return null;
    }

    const item = this.queue.shift();
    if (!item) return null;

    this.running.add(item.task.id);
    return item.task;
  }

  complete(taskId: string, _success: boolean): void {
    this.running.delete(taskId);
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getRunningCount(): number {
    return this.running.size;
  }

  getQueueSnapshot(): Array<{ id: string; pheromone: number; objective: string }> {
    return this.queue.map(q => ({
      id: q.task.id,
      pheromone: q.pheromone,
      objective: q.task.objective,
    }));
  }
}

// Singleton
let globalScheduler: PheromoneScheduler | null = null;

export function getPheromoneScheduler(maxConcurrency = 10): PheromoneScheduler {
  if (!globalScheduler) {
    globalScheduler = new PheromoneScheduler(maxConcurrency);
  }
  return globalScheduler;
}

export function resetPheromoneScheduler(): void {
  globalScheduler = null;
}

/**
 * Hook into worker execution to emit pheromones on completion
 */
export async function emitWorkerPheromones(
  workerId: string,
  skillId: string,
  result: any,
  targetUrl?: string
): Promise<void> {
  if (!result) return;

  // Emit endpoint discovered pheromone
  if (result?.url) {
    getPheromoneCoordinator().emit({
      type: 'ENDPOINT_DISCOVERED',
      strength: 0.7,
      halfLifeMs: 4 * 60 * 60 * 1000,
      sourceWorkerId: workerId,
      payload: { targetId: targetUrl ?? result.url, url: result.url, method: result.method, status: result.status, skillId },
    });
  }

  // Emit on finding confirmed
  if (result?.finding?.confirmed) {
    getPheromoneCoordinator().emit({
      type: 'VULN_FOUND',
      strength: 0.9,
      halfLifeMs: 24 * 60 * 60 * 1000,
      sourceWorkerId: workerId,
      payload: { targetId: targetUrl ?? result.url ?? 'global', findingId: result.findingId, technique: result.technique, skillId },
    });
  }
}
