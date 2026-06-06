// src/cli/endpoint-diff.ts
//
// Version-control-style diff between two sets of AppModelEndpoint.
//
// The user's manual user-flow produces a fresh set of endpoints (URL + method
// + bodyPreview + params). The existing app-model.json has the previous run's
// endpoints. We match by (method, path) and classify each new endpoint as
//   - created   — path didn't exist before
//   - updated   — path exists but bodyPreview or params differ
//   - unchanged — same path, same body, same params
//
// The diff is what gets written back to app-model.json — and surfaced to the
// user as a "this session changed N endpoints (X new, Y updated)" summary.

import type { AppModelEndpoint } from '../core/app-model';

export type EndpointChange =
  | { kind: 'created'; endpoint: AppModelEndpoint }
  | { kind: 'updated'; endpoint: AppModelEndpoint; before: AppModelEndpoint; changedKeys: string[] }
  | { kind: 'unchanged'; endpoint: AppModelEndpoint };

export interface EndpointDiff {
  created: AppModelEndpoint[];
  updated: Array<{ after: AppModelEndpoint; before: AppModelEndpoint; changedKeys: string[] }>;
  unchanged: AppModelEndpoint[];
  /** Set of paths that existed before but are no longer in the new set */
  removed: string[];
}

function endpointKey(ep: Pick<AppModelEndpoint, 'method' | 'path'>): string {
  return `${(ep.method ?? 'GET').toUpperCase()} ${ep.path}`;
}

function endpointsAreEqual(a: AppModelEndpoint, b: AppModelEndpoint): { equal: boolean; changedKeys: string[] } {
  const changed: string[] = [];
  const aBody = (a.bodyPreview ?? '').trim();
  const bBody = (b.bodyPreview ?? '').trim();
  if (aBody !== bBody) changed.push('bodyPreview');
  const aParams = JSON.stringify(a.params ?? []);
  const bParams = JSON.stringify(b.params ?? []);
  if (aParams !== bParams) changed.push('params');
  if ((a.contentType ?? '') !== (b.contentType ?? '')) changed.push('contentType');
  if ((a.requiresAuth ?? false) !== (b.requiresAuth ?? false)) changed.push('requiresAuth');
  return { equal: changed.length === 0, changedKeys: changed };
}

/**
 * Compute the diff. `before` is the existing app-model.json endpoints.
 * `after` is what the user-flow + LLM discovered this session.
 */
export function diffEndpoints(
  before: AppModelEndpoint[],
  after: AppModelEndpoint[],
): EndpointDiff {
  const beforeMap = new Map<string, AppModelEndpoint>();
  for (const ep of before) beforeMap.set(endpointKey(ep), ep);

  const seen = new Set<string>();
  const created: AppModelEndpoint[] = [];
  const updated: EndpointDiff['updated'] = [];
  const unchanged: AppModelEndpoint[] = [];

  for (const next of after) {
    const k = endpointKey(next);
    seen.add(k);
    const prev = beforeMap.get(k);
    if (!prev) {
      created.push(next);
      continue;
    }
    const { equal, changedKeys } = endpointsAreEqual(prev, next);
    if (equal) {
      unchanged.push(next);
    } else {
      updated.push({ after: next, before: prev, changedKeys });
    }
  }

  const removed: string[] = [];
  for (const [k, ep] of beforeMap.entries()) {
    if (!seen.has(k)) removed.push(endpointKey(ep));
  }

  return { created, updated, unchanged, removed };
}

/**
 * Apply the diff to a model: add created endpoints, replace updated
 * endpoints (keeping their id if any), keep unchanged as-is, leave
 * removed ones in place (we don't auto-delete; the operator can
 * review the diff and decide).
 */
export function applyEndpointDiff(
  existing: AppModelEndpoint[],
  diff: EndpointDiff,
): { next: AppModelEndpoint[]; summary: string } {
  const map = new Map<string, AppModelEndpoint>();
  for (const ep of existing) map.set(endpointKey(ep), ep);

  for (const ep of diff.created) {
    map.set(endpointKey(ep), ep);
  }
  for (const u of diff.updated) {
    map.set(endpointKey(u.after), u.after);
  }

  const next = [...map.values()];
  const lines: string[] = [];
  lines.push(`  \x1b[32m+ created  \x1b[0m ${diff.created.length}`);
  for (const ep of diff.created) {
    lines.push(`      ${endpointKey(ep)}`);
  }
  lines.push(`  \x1b[33m~ updated  \x1b[0m ${diff.updated.length}`);
  for (const u of diff.updated) {
    lines.push(`      ${endpointKey(u.after)} (${u.changedKeys.join(', ')})`);
  }
  lines.push(`  = unchanged ${diff.unchanged.length}`);
  if (diff.removed.length > 0) {
    lines.push(`  \x1b[31m- removed  \x1b[0m ${diff.removed.length} (not auto-deleted; review manually)`);
    for (const r of diff.removed) lines.push(`      ${r}`);
  }
  return { next, summary: lines.join('\n') };
}
