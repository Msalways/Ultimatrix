/**
 * Pheromone Scheduler - Stigmergic Task Scheduler
 * 
 * Replaces simple maxParallel with pheromone-weighted priority queue.
 * Workers subscribe to pheromone signals; tasks with higher pheromone
 * concentration get scheduled first.
 */

import { getPheromoneCoordinator, type PheromoneSignal } from './pheromone-coordinator';
import type { CampaignSlice } from '../campaign/types';

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

// Campaign slice wrapper for pheromone scheduling
export interface PheromoneSlice {
  slice: CampaignSlice;
  pheromoneBoost: number;
}

interface QueuedTask {
  task: TaskWithPheromone;
  pheromone: number;
  enqueuedAt: number;
}

interface QueuedSlice {
  slice: CampaignSlice;
  pheromone: number;
  enqueuedAt: number;
}

export class PheromoneScheduler {
  private queue: QueuedTask[] = [];
  private sliceQueue: QueuedSlice[] = [];
  private maxConcurrency: number;
  private running = new Set<string>();
  private runningSlices = new Set<string>();

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

  /**
   * Enqueue a campaign slice with pheromone-based prioritization
   */
  enqueueSlice(slice: CampaignSlice, basePheromoneBoost = 0): void {
    const pheromoneCoordinator = getPheromoneCoordinator();
    const endpointUrl = slice.endpoint?.url ?? 'global';
    
    // Boost by relevant pheromones on the target endpoint
    const signals = pheromoneCoordinator.getSignals(endpointUrl);
    let pheromoneBoost = 0;
    
    for (const signal of signals) {
      if (signal.expiresAt > Date.now() && this.isSignalRelevant(signal)) {
        pheromoneBoost += signal.strength * 0.5;
      }
    }

    this.sliceQueue.push({
      slice,
      pheromone: basePheromoneBoost + pheromoneBoost,
      enqueuedAt: Date.now(),
    });
    
    // Sort by pheromone (highest first)
    this.sliceQueue.sort((a, b) => b.pheromone - a.pheromone);
  }

  /**
   * Enqueue multiple slices at once
   */
  enqueueSlices(slices: CampaignSlice[], basePheromoneBoost = 0): void {
    for (const slice of slices) {
      this.enqueueSlice(slice, basePheromoneBoost);
    }
  }

  private isSignalRelevant(signal: PheromoneSignal): boolean {
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

  /**
   * Dequeue a campaign slice with pheromone-based prioritization
   */
  async dequeueSlice(): Promise<CampaignSlice | null> {
    if (this.sliceQueue.length === 0) return null;
    
    // Filter running slices
    if (this.runningSlices.size >= this.maxConcurrency) {
      return null;
    }

    const item = this.sliceQueue.shift();
    if (!item) return null;

    this.runningSlices.add(item.slice.id);
    return item.slice;
  }

  complete(taskId: string, _success: boolean): void {
    this.running.delete(taskId);
  }

  completeSlice(sliceId: string, _success: boolean): void {
    this.runningSlices.delete(sliceId);
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getSliceQueueLength(): number {
    return this.sliceQueue.length;
  }

  getRunningCount(): number {
    return this.running.size;
  }

  getRunningSliceCount(): number {
    return this.runningSlices.size;
  }

  getQueueSnapshot(): Array<{ id: string; pheromone: number; objective: string }> {
    return this.queue.map(q => ({
      id: q.task.id,
      pheromone: q.pheromone,
      objective: q.task.objective,
    }));
  }

  getSliceQueueSnapshot(): Array<{ id: string; pheromone: number; objective: string }> {
    return this.sliceQueue.map(q => ({
      id: q.slice.id,
      pheromone: q.pheromone,
      objective: q.slice.endpoint?.url ?? 'unknown',
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

/**
 * Emit pheromones for campaign slice completion
 */
export async function emitSlicePheromones(
  slice: CampaignSlice,
  outcome: { confirmed: number; findings: any[] }
): Promise<void> {
  const coordinator = getPheromoneCoordinator();
  
  // Emit endpoint discovered pheromone for the slice endpoint
  if (slice.endpoint?.url) {
    coordinator.emit({
      type: 'ENDPOINT_DISCOVERED',
      strength: 0.7,
      halfLifeMs: 4 * 60 * 60 * 1000,
      sourceWorkerId: 'campaign-executor',
      payload: { 
        targetId: slice.endpoint.url, 
        url: slice.endpoint.url, 
        method: slice.endpoint.method, 
        skillId: 'campaign',
        sliceId: slice.id,
      },
    });
  }

  // Emit on findings confirmed
  if (outcome.confirmed > 0) {
    for (const finding of outcome.findings) {
      coordinator.emit({
        type: 'VULN_FOUND',
        strength: 0.9,
        halfLifeMs: 24 * 60 * 60 * 1000,
        sourceWorkerId: 'campaign-executor',
        payload: { 
          targetId: slice.endpoint?.url ?? 'global', 
          findingId: finding.id, 
          technique: finding.technique, 
          skillId: 'campaign',
          sliceId: slice.id,
        },
      });
    }
  }

  // Emit technique success/failure pheromones
  if (outcome.confirmed > 0) {
    coordinator.emit({
      type: 'TECHNIQUE_SUCCESSFUL',
      strength: 0.8,
      halfLifeMs: 6 * 60 * 60 * 1000,
      sourceWorkerId: 'campaign-executor',
      payload: { 
        targetId: slice.endpoint?.url ?? 'global', 
        techniqueIds: slice.techniqueIds,
        skillId: 'campaign',
        sliceId: slice.id,
      },
    });
  }
}
