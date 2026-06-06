// src/ci/exit-code.ts
//
// Exit code policy for headless/CI mode.
//   0 = no findings
//   1 = findings below threshold (or threshold-level "low")
//   2 = findings at threshold (e.g., "high")
//   3 = findings above threshold (e.g., "critical") OR fatal error
//
// --fail-on can be "none" (never fail), "low", "medium", "high", "critical",
// or a comma-separated list of types. Default: "high".
//
// Note: exit code 3 also signals an internal error from the runner.

import type { AppModelFinding } from '../core/app-model';

export type FailOnLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  moderate: 3,
  low: 2,
  info: 1,
  none: 0,
};

export function rankOf(severity: string): number {
  return SEVERITY_RANK[(severity ?? '').toLowerCase()] ?? 0;
}

/** Resolve a failOn string to a level (the first level that triggers failure). */
export function parseFailOn(failOn: string | undefined): FailOnLevel | null {
  if (!failOn || failOn === 'none') return null;
  const allowed: FailOnLevel[] = ['low', 'medium', 'high', 'critical'];
  if ((allowed as string[]).includes(failOn)) return failOn as FailOnLevel;
  return 'high';  // safe default
}

/** Map a finding to a failOn level. */
function levelForFinding(f: AppModelFinding): FailOnLevel | null {
  const r = rankOf(f.severity ?? '');
  if (r >= SEVERITY_RANK.critical) return 'critical';
  if (r >= SEVERITY_RANK.high) return 'high';
  if (r >= SEVERITY_RANK.medium) return 'medium';
  if (r >= SEVERITY_RANK.low) return 'low';
  return null;
}

/** Compute the exit code from findings and failOn policy. */
export function computeExitCode(findings: AppModelFinding[], failOn: string | undefined): number {
  const trigger = parseFailOn(failOn);
  if (!trigger) return 0;
  let maxLevel: FailOnLevel | null = null;
  for (const f of findings) {
    const lvl = levelForFinding(f);
    if (lvl && rankOf(lvl) > (maxLevel ? rankOf(maxLevel) : 0)) {
      maxLevel = lvl;
    }
  }
  if (!maxLevel) return 0;
  if (rankOf(maxLevel) >= rankOf(trigger)) {
    // 1 = at/above trigger level but not max, 2 = critical, 3 = error
    if (maxLevel === 'critical') return 2;
    return 1;
  }
  return 0;
}

/** Friendly explanation of why the exit code is what it is. */
export function explainExitCode(code: number, findings: AppModelFinding[], failOn: string | undefined): string {
  if (code === 0) return findings.length === 0 ? 'No findings.' : `Findings present but below --fail-on=${failOn ?? 'high'}.`;
  if (code === 1) return `Findings at or above --fail-on=${failOn ?? 'high'}.`;
  if (code === 2) return `Critical findings detected.`;
  if (code === 3) return `Hunt failed with internal error.`;
  return `Unknown exit code ${code}.`;
}
