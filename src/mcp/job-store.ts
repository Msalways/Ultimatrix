// src/mcp/job-store.ts
//
// In-memory job registry for MCP-launched hunts. Each job has a
// target, outputDir, status, and the live app-model + findings as the
// hunt progresses. The MCP server exposes CRUD over this store; the
// CLI also reads from the same on-disk layout the standard `hunt`
// command writes.
//
// This is intentionally a tiny class — no persistence, no concurrency
// primitives. The hunt orchestrator is the only writer (one job per
// process), and MCP clients are typically serial.

import type { AppModelFinding } from '../core/app-model';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface HuntJob {
  id: string;
  target: string;
  outputDir: string;
  status: JobStatus;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  /** Live findings — appended as the hunt produces them. */
  findings: AppModelFinding[];
  /** The full app-model snapshot (or partial if not yet built). */
  appModelPath: string;
  /** Free-form progress (0-1). */
  progress: number;
  /** Optional log tail (last N events). */
  log: string[];
}

export class JobStore {
  private jobs = new Map<string, HuntJob>();
  private listeners: Array<(job: HuntJob) => void> = [];

  create(input: { id?: string; target: string; outputDir: string; appModelPath: string }): HuntJob {
    const id = input.id ?? `job-${Date.now()}-${Math.floor(Math.random() * 10000).toString(36)}`;
    const job: HuntJob = {
      id,
      target: input.target,
      outputDir: input.outputDir,
      appModelPath: input.appModelPath,
      status: 'queued',
      startedAt: Date.now(),
      finishedAt: null,
      error: null,
      findings: [],
      progress: 0,
      log: [],
    };
    this.jobs.set(id, job);
    this.emit(job);
    return job;
  }

  get(id: string): HuntJob | undefined {
    return this.jobs.get(id);
  }

  list(): HuntJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  update(id: string, patch: Partial<HuntJob>): HuntJob | undefined {
    const cur = this.jobs.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    this.jobs.set(id, next);
    this.emit(next);
    return next;
  }

  appendFinding(id: string, finding: AppModelFinding): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.findings.push(finding);
    this.emit(job);
  }

  appendLog(id: string, line: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.log.push(line);
    // Keep log trimmed to last 200 lines
    if (job.log.length > 200) job.log = job.log.slice(-200);
    this.emit(job);
  }

  onChange(fn: (job: HuntJob) => void): void {
    this.listeners.push(fn);
  }

  private emit(job: HuntJob): void {
    for (const fn of this.listeners) {
      try { fn(job); } catch { /* ignore */ }
    }
  }
}

/** Global singleton — the MCP server and the hunt orchestrator share this. */
let _store: JobStore | null = null;
export function getJobStore(): JobStore {
  if (!_store) _store = new JobStore();
  return _store;
}
