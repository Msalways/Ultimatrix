// src/report/diff-store.ts
//
// Local diff store. Each completed hunt writes a snapshot to
// output/history/<target>/<timestamp>.json. The diff between a new
// hunt and the previous one is computed by diffHunts() and surfaces
// as: added (new findings), removed (gone), regressed (was fixed, now
// back), fixed (was in old, not in new). All diffs are local — no
// cloud, no telemetry.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AppModelFinding } from '../core/app-model';

export interface HuntSnapshot {
  target: string;
  timestamp: number;
  durationMs: number;
  findings: Array<{
    type: string;
    endpoint: string;
    param?: string;
    method?: string;
    severity: string;
    confidence: string;
    confirmed: boolean;
    fingerprint: string;
  }>;
}

export interface HuntDiff {
  previousHuntAt: number;
  added: AppModelFinding[];
  fixed: AppModelFinding[];
  regressed: AppModelFinding[];
  unchanged: AppModelFinding[];
  removedFingerprints: string[];
}

/** Stable fingerprint for a finding (used to track it across hunts). */
export function fingerprint(f: AppModelFinding): string {
  return `${(f.type ?? '').toLowerCase()}|${f.endpoint ?? ''}|${f.param ?? ''}|${f.method ?? 'GET'}`;
}

/** Save a snapshot to the history dir. */
export function saveSnapshot(historyDir: string, snapshot: HuntSnapshot): string {
  const targetDir = join(historyDir, encodeURIComponent(snapshot.target));
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  const path = join(targetDir, `${snapshot.timestamp}.json`);
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
  return path;
}

/** Load the most recent snapshot for a target. Returns null if none. */
export function loadLatestSnapshot(historyDir: string, target: string): HuntSnapshot | null {
  const targetDir = join(historyDir, encodeURIComponent(target));
  if (!existsSync(targetDir)) return null;
  const files = readdirSync(targetDir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) return null;
  const latest = files[files.length - 1];
  return JSON.parse(readFileSync(join(targetDir, latest), 'utf8')) as HuntSnapshot;
}

/** List all snapshots for a target, oldest first. */
export function listSnapshots(historyDir: string, target: string): HuntSnapshot[] {
  const targetDir = join(historyDir, encodeURIComponent(target));
  if (!existsSync(targetDir)) return [];
  const files = readdirSync(targetDir).filter((f) => f.endsWith('.json')).sort();
  return files.map((f) => JSON.parse(readFileSync(join(targetDir, f), 'utf8')) as HuntSnapshot);
}

/** Compute the diff between a new hunt's findings and the previous snapshot. */
export function diffHunts(previous: HuntSnapshot | null, current: { findings: AppModelFinding[]; timestamp: number; target: string }): HuntDiff {
  if (!previous) {
    return { previousHuntAt: 0, added: current.findings, fixed: [], regressed: [], unchanged: [], removedFingerprints: [] };
  }
  const prevByFp = new Map<string, AppModelFinding>();
  for (const f of previous.findings) {
    prevByFp.set(f.fingerprint, {
      id: '', type: f.type, endpoint: f.endpoint, param: f.param ?? '', method: f.method ?? 'GET',
      severity: f.severity, confidence: f.confidence, confirmed: f.confirmed,
    } as unknown as AppModelFinding);
  }
  const currByFp = new Map<string, AppModelFinding>();
  for (const f of current.findings) currByFp.set(fingerprint(f), f);

  const added: AppModelFinding[] = [];
  const unchanged: AppModelFinding[] = [];
  const regressed: AppModelFinding[] = [];
  for (const [fp, f] of currByFp) {
    if (!prevByFp.has(fp)) {
      added.push(f);
    } else {
      const prev = prevByFp.get(fp)!;
      const wasLower = rankOf(prev.severity) < rankOf(f.severity);
      if (wasLower) regressed.push(f);
      else unchanged.push(f);
    }
  }
  const fixed: AppModelFinding[] = [];
  const removedFingerprints: string[] = [];
  for (const [fp, f] of prevByFp) {
    if (!currByFp.has(fp)) {
      fixed.push(f);
      removedFingerprints.push(fp);
    }
  }
  return { previousHuntAt: previous.timestamp, added, fixed, regressed, unchanged, removedFingerprints };
}

function rankOf(severity: string): number {
  const s = (severity ?? '').toLowerCase();
  if (s === 'critical') return 5;
  if (s === 'high') return 4;
  if (s === 'medium' || s === 'moderate') return 3;
  if (s === 'low') return 2;
  if (s === 'info') return 1;
  return 0;
}

/** Build a snapshot from a HuntCore's final state. */
export function snapshotFromCore(core: import('../hunt/core').HuntCore): HuntSnapshot {
  const state = core.getState();
  return {
    target: state.target,
    timestamp: state.endedAt ?? Date.now(),
    durationMs: (state.endedAt ?? Date.now()) - state.startedAt,
    findings: state.findings.map((f) => ({
      type: f.type,
      endpoint: f.endpoint,
      param: f.param,
      method: f.method,
      severity: f.severity,
      confidence: String(f.confidence),
      confirmed: !!f.confirmed,
      fingerprint: fingerprint(f),
    })),
  };
}
