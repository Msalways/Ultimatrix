/**
 * Pheromone Coordinator - Stigmergic Coordination Layer
 * 
 * Implements ant-colony-inspired coordination for swarm intelligence.
 * Workers emit pheromones on discoveries; other workers follow trails.
 * Pheromones decay exponentially; expired trails evaporate.
 */

import type { GraphStore } from '../graph/store';
import { getGlobalGraphStore } from '../graph/store';

export type PheromoneType =
  | 'ENDPOINT_DISCOVERED' 
  | 'VULN_FOUND' 
  | 'CREDENTIAL_FOUND' 
  | 'SESSION_ESTABLISHED'
  | 'TECHNIQUE_SUCCESSFUL'
  | 'TECHNIQUE_FAILED'
  | 'ENDPOINT_ERROR'
  | 'AUTH_BYPASS'
  | 'PRIVILEGE_ESCALATION'
  | 'DATA_EXFILTRATION';

export interface PheromoneSignal {
  type: PheromoneType;
  strength: number;              // 0.0 - 1.0 initial strength
  halfLifeMs: number;            // decay half-life in ms
  sourceWorkerId: string;
  targetWorkerIds?: string[];    // undefined = broadcast
  payload: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

export interface PheromoneTrail {
  id: string;
  signals: PheromoneSignal[];
  createdAt: number;
  updatedAt: number;
}

interface PheromoneSubscription {
  workerId: string;
  types: PheromoneType[];
  handler: (signal: PheromoneSignal) => void;
}

const DEFAULT_HALF_LIVES: Record<PheromoneType, number> = {
  ENDPOINT_DISCOVERED: 4 * 60 * 60 * 1000,      // 4 hours
  VULN_FOUND: 24 * 60 * 60 * 1000,              // 24 hours
  CREDENTIAL_FOUND: 12 * 60 * 60 * 1000,        // 12 hours
  SESSION_ESTABLISHED: 8 * 60 * 60 * 1000,      // 8 hours
  TECHNIQUE_SUCCESSFUL: 6 * 60 * 60 * 1000,     // 6 hours
  TECHNIQUE_FAILED: 30 * 60 * 1000,             // 30 minutes
  ENDPOINT_ERROR: 15 * 60 * 1000,               // 15 minutes
  AUTH_BYPASS: 24 * 60 * 60 * 1000,             // 24 hours
  PRIVILEGE_ESCALATION: 24 * 60 * 60 * 1000,   // 24 hours
  DATA_EXFILTRATION: 24 * 60 * 60 * 1000,       // 24 hours
};

const DEFAULT_DECAY_INTERVAL_MS = 60_000; // 1 minute

export class PheromoneCoordinator {
  private trails = new Map<string, PheromoneTrail>(); // key = target identifier
  private subscriptions = new Map<string, PheromoneSubscription[]>();
  private decayInterval: NodeJS.Timeout | null = null;
  private graphStore: GraphStore | null = null;

  constructor(graphStore?: GraphStore) {
    this.graphStore = graphStore || getGlobalGraphStore();
    this.startDecayLoop();
  }

  private startDecayLoop(): void {
    this.decayInterval = setInterval(() => {
      this.decay();
    }, DEFAULT_DECAY_INTERVAL_MS);
  }

  stop(): void {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
    }
  }

  private decay(): void {
    const now = Date.now();
    for (const [target, trail] of this.trails) {
      // Remove expired signals
      const originalLength = trail.signals.length;
      trail.signals = trail.signals.filter(s => s.expiresAt > Date.now());
      
      // Clean up empty trails
      if (trail.signals.length === 0) {
        this.trails.delete(target);
      } else if (trail.signals.length !== originalLength) {
        trail.updatedAt = Date.now();
      }
    }
  }

  /**
   * Emit a pheromone signal on a target
   */
  emit(input: Omit<PheromoneSignal, 'createdAt' | 'expiresAt'>): void {
    const now = Date.now();
    const halfLife = input.halfLifeMs ?? DEFAULT_HALF_LIVES[input.type] ?? 60_000;
    
    const signal: PheromoneSignal = {
      ...input,
      createdAt: now,
      expiresAt: now + halfLife,
    };

    const targetId = typeof signal.payload.targetId === 'string' ? signal.payload.targetId : 'global';
    const trail = this.trails.get(targetId) ?? {
      id: targetId,
      signals: [],
      createdAt: now,
      updatedAt: now,
    };

    trail.signals.push(signal);
    trail.updatedAt = now;
    this.trails.set(trail.id, trail);

    // Notify subscribers
    this.notifySubscribers(signal);
  }

  /**
   * Subscribe to pheromone signals of specific types
   */
  subscribe(workerId: string, types: PheromoneType[], handler: (signal: PheromoneSignal) => void): () => void {
    const subs = this.subscriptions.get(workerId) ?? [];
    subs.push({ workerId, types, handler });
    this.subscriptions.set(workerId, subs);
    
    // Return unsubscribe function
    return () => {
      const subs = this.subscriptions.get(workerId) ?? [];
      const idx = subs.findIndex(s => s.handler === handler);
      if (idx >= 0) subs.splice(idx, 1);
    };
  }

  private notifySubscribers(signal: PheromoneSignal): void {
    for (const [workerId, subs] of this.subscriptions) {
      for (const sub of subs) {
        if (sub.types.includes(signal.type) || sub.types.includes('*' as PheromoneType)) {
          try {
            sub.handler(signal);
          } catch (e) {
            // Swallow subscription errors
          }
        }
      }
    }
  }

  /**
   * Get all active signals for a target
   */
  getSignals(targetId: string): PheromoneSignal[] {
    const trail = this.trails.get(targetId);
    if (!trail) return [];
    return trail.signals.filter(s => s.expiresAt > Date.now());
  }

  /**
   * Get strongest signal of a type for a target
   */
  getStrongestSignal(targetId: string, type: PheromoneType): PheromoneSignal | null {
    const signals = this.getSignals(targetId).filter(s => s.type === type);
    if (signals.length === 0) return null;
    return signals.reduce((a, b) => a.strength > b.strength ? a : b);
  }

  /**
   * Get all active pheromone trails (for dashboard/debugging)
   */
  getAllTrails(): PheromoneTrail[] {
    return Array.from(this.trails.values());
  }

  /**
   * Get pheromone strength for a target (sum of active signals)
   */
  getPheromoneStrength(targetId: string): number {
    const signals = this.getSignals(targetId);
    return signals.reduce((sum, s) => sum + s.strength, 0);
  }
}

// Singleton instance
let globalCoordinator: PheromoneCoordinator | null = null;

export function getPheromoneCoordinator(graphStore?: GraphStore): PheromoneCoordinator {
  if (!globalCoordinator) {
    globalCoordinator = new PheromoneCoordinator(graphStore);
  }
  return globalCoordinator;
}

export function resetPheromoneCoordinator(): void {
  if (globalCoordinator) {
    globalCoordinator.stop();
    globalCoordinator = null;
  }
}
