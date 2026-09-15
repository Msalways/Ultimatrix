# F5: Stigmergic Coordination Layer

**Phase**: F5 - Stigmergic Coordination Layer
**Status**: 🔄 IN PROGRESS
**Priority**: HIGH
**Effort**: Medium (2-3 weeks)

---

## Overview

The Stigmergic Coordination Layer adds a pheromone-based coordination layer that enables emergent swarm behavior without central planning. Workers emit pheromones on discoveries; other workers follow the strongest trails, creating emergent attack chains.

---

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PheromoneCoordination Layer                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  PheromoneCoordinator (singleton)                                           │
│  ├─ emit(signal)           → emit pheromone on target                      │
│  ├─ subscribe(worker, types, handler)  → subscribe to signal types         │
│  ├─ getSignals(targetId)  → get active signals on target                   │
│  ├─ decay()                → exponential decay + TTL sweep                 │
│  └─ getPheromoneStrength(targetId)  → aggregate strength                   │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     PheromoneScheduler (replaces maxParallel)              │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Pheromone-weighted priority queue                                        │
│  ├─ enqueue(task, basePheromone) → score = base + pheromoneBoost           │
    │  where pheromoneBoost = Σ(signal.strength * relevance)                 │
│  ├─ dequeue() → highest pheromone task (respects maxConcurrency)          │
│  └─ decay background job (exponential decay per signal type)               │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Worker Pool Integration                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  WorkerPoolExecutor                                                         │
│  ├─ emitWorkerPheromones()  → emit on completion                          │
│  ├─ getActiveBrowserContext() → unified context access                     │
│  └─ getActivePage() → works for both Stagehand & Camoufox                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Signal Types & Half-Lives

| Signal Type | Half-Life | Description |
|-------------|-----------|-------------|
| `ENDPOINT_DISCOVERED` | 4 hours | New endpoint found |
| `VULN_FOUND` | 24h | Confirmed vulnerability |
| `CREDENTIAL_FOUND` | 12h | Valid credentials discovered |
| `SESSION_ESTABLISHED` | 8h | Valid session established |
| `TECHNIQUE_SUCCESSFUL` | 6h | Technique worked |
| `TECHNIQUE_FAILED` | 30min | Technique failed |
| `ENDPOINT_ERROR` | 15min | Error on endpoint |
| `AUTH_BYPASS` | 24h | Auth bypass found |
| `PRIVILEGE_ESCALATION` | 24h | Privilege escalation path found |
| `DATA_EXFILTRATION` | 24h | Data exfiltration path found |

---

## Signal Structure

```typescript
interface PheromoneSignal {
  type: PheromoneType;
  strength: number;           // 0.0 - 1.0
  halfLifeMs: number;         // decay half-life in ms
  sourceWorkerId: string;
  targetWorkerIds?: string[]; // undefined = broadcast
  payload: Record<string, any>;
  createdAt: number;
  expiresAt: number;
}
```

---

## PheromoneScheduler (replaces maxParallel)

```typescript
class PheromoneScheduler {
  private queue: QueuedTask[] = [];
  private maxConcurrency: number;
  private running = new Set<string>();

  enqueue(task: TaskWithPheromone): void {
    // base pheromone + pheromone boost from relevant signals
    const boost = this.calculatePheromoneBoost(task);
    this.queue.push({ task, pheromone: base + boost, enqueuedAt: Date.now() });
    this.queue.sort((a, b) => b.pheromone - a.pheromone);
  }

  async dequeue(): Promise<TaskWithPheromone | null> {
    // respects maxConcurrency, picks highest pheromone
  }

  complete(taskId: string): void { /* release slot */ }
}
```

---

## Worker Integration

### Worker Pheromone Emission (in worker-pool-executor.ts)

```typescript
// After task completion, emit pheromones based on result
const pheromonesEmitted: string[] = [];

// ENDPOINT_DISCOVERED - on successful HTTP request
if (toolCall.name === 'httpRequest' && result.status === 200) {
  emit({
    type: 'ENDPOINT_DISCOVERED',
    strength: 0.7,
    halfLifeMs: 4 * 60 * 60 * 1000, // 4 hours
    sourceWorkerId: execution.workerId,
    payload: { url, method, status }
  });
}

// VULN_FOUND - on confirmed finding
if (toolName === 'writeFinding' && result.confirmed) {
  emit({ type: 'VULN_FOUND', strength: 0.9, halfLifeMs: 24h, ... });
}

// CREDENTIAL_FOUND
if (tool === 'credential-reuse' && result.validated) { ... }

// SESSION_ESTABLISHED
if (tool === 'session-established' && result.valid) { ... }
```

### Pheromone Decay Background Job

```typescript
// Runs every minute
private decay(): void {
  const now = Date.now();
  for (const [target, trail] of this.trails) {
    trail.signals = trail.signals.filter(s => s.expiresAt > Date.now());
    if (trail.signals.length === 0) this.trails.delete(target);
  }
}
```

---

## Integration Points

### 1. Worker Pool Executor (`src/runtime/worker-pool-executor.ts`)
- After task completion, emit pheromones based on result
- Emit `ENDPOINT_DISCOVERED` on successful HTTP
- Emit `VULN_FOUND` on confirmed finding
- Emit `CREDENTIAL_FOUND` on credential validation
- Emit `SESSION_ESTABLISHED` on session establishment

### F5.3 - Pheromone Scheduler Integration

Replace `maxParallel` with `PheromoneScheduler`:

```typescript
// In LazySolverServices / Solver
const scheduler = getPheromoneScheduler(maxConcurrency);

// Instead of maxParallel, use pheromone-weighted queue
const task = await scheduler.dequeue();
```

### F5.4 - Swarm Chaining via ResultRefs

```typescript
// In spawn-swarm.ts
// Before: 200-char JSON slices
// After: pass resultRef pointers

const priorFindings = priorResults
  .filter(r => r.status === 'completed' && r.resultRef)
  .map(r => `Worker ${r.skillId}: [full output: ${r.resultRef} via get-tool-result]`)
  .join('\n');
```

---

## Acceptance Criteria

- [ ] `PheromoneCoordinator` emits/decays signals correctly
- [ ] `PheromoneScheduler` replaces `maxParallel` with pheromone-weighted queue
- [ ] Workers emit pheromones on completion (endpoint, vuln, cred, session)
- [ ] Swarm chaining uses `resultRef` instead of 200-char truncation
- [ ] Pheromone decay background job runs and cleans expired signals
- [ ] Dashboard shows pheromone heatmap on targets
- [ ] All existing tests pass + new contract tests for stigmergic layer