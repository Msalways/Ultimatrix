// src/report/html.ts
//
// Self-contained HTML report. No external CDN, no JS framework — just
// inline CSS + minimal JS. The report IS the dashboard: shows findings,
// per-finding proof, diff vs last hunt, and an action bar with
// "regenerate tests" and "share" buttons (the share button is JS-only;
// the user wires it to a backend or a zip export).

import type { AppModelFinding } from '../core/app-model';
import type { HuntDiff, HuntSnapshot } from './diff-store';
import { fingerprint } from './diff-store';

export interface HtmlReportOptions {
  target: string;
  startedAt: number;
  durationMs: number;
  cost: number;
  findings: AppModelFinding[];
  diff: HuntDiff | null;
  /** Inline screenshots as data URIs, keyed by finding ID. */
  screenshots?: Record<string, string[]>;
}

function escapeHtml(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function severityColor(severity: string): string {
  const s = (severity ?? '').toLowerCase();
  if (s === 'critical') return '#7c1d1d';
  if (s === 'high') return '#b91c1c';
  if (s === 'medium') return '#b45309';
  if (s === 'low') return '#1d4ed8';
  if (s === 'info') return '#475569';
  return '#475569';
}

function summaryCounts(findings: AppModelFinding[]): Record<string, number> {
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    const s = (f.severity ?? 'info').toLowerCase();
    if (s in counts) counts[s] += 1;
  }
  return counts;
}

export function renderHtmlReport(opts: HtmlReportOptions): string {
  const counts = summaryCounts(opts.findings);
  const findingsHtml = opts.findings.map((f) => renderFinding(f, opts.screenshots?.[f.id ?? ''] ?? [])).join('\n');
  const diffHtml = opts.diff ? renderDiff(opts.diff) : '';
  const shareButton = `<button class="btn" onclick="alert('Share: export this report as a single HTML (file://.../share.html) or a zip.')">Share</button>`;
  const regenButton = `<button class="btn" onclick="alert('Regenerate: npx ultimatrix codegen ' + window.location.search)">Regenerate tests</button>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Ultimatrix — ${escapeHtml(opts.target)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background: #0f172a; color: #f8fafc; }
  header { padding: 24px 32px; background: #1e293b; border-bottom: 1px solid #334155; }
  header h1 { margin: 0 0 8px 0; font-size: 22px; }
  header .meta { color: #94a3b8; font-size: 13px; }
  .layout { display: grid; grid-template-columns: 1fr 320px; gap: 24px; padding: 24px 32px; }
  .main { min-width: 0; }
  .sidebar { }
  .panel { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .panel h2 { margin: 0 0 12px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #cbd5e1; }
  .counts { display: flex; gap: 16px; }
  .counts .count { flex: 1; text-align: center; padding: 12px 0; border-radius: 6px; font-weight: 600; }
  .count .n { display: block; font-size: 28px; }
  .count .label { font-size: 11px; text-transform: uppercase; }
  .finding { padding: 16px; border-left: 4px solid; border-radius: 6px; margin-bottom: 12px; background: #0f172a; }
  .finding .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .finding .type { font-weight: 600; font-size: 15px; }
  .finding .sev { font-size: 11px; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; color: #f8fafc; }
  .finding .endpoint { font-family: ui-monospace, monospace; color: #94a3b8; font-size: 13px; }
  .finding .payload { background: #1e293b; padding: 8px; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 12px; overflow-x: auto; margin: 8px 0; }
  .finding .evidence { color: #cbd5e1; font-size: 13px; }
  .finding .desc { color: #94a3b8; font-size: 13px; margin-top: 8px; }
  .finding .shots img { max-width: 100%; border: 1px solid #334155; border-radius: 4px; margin-top: 8px; }
  .diff-row { display: flex; justify-content: space-between; padding: 4px 0; }
  .diff-row .add { color: #f87171; }
  .diff-row .fix { color: #4ade80; }
  .diff-row .regr { color: #fb923c; }
  .btn { display: inline-block; padding: 8px 16px; border-radius: 4px; border: 1px solid #475569; background: #334155; color: #f8fafc; cursor: pointer; margin-right: 8px; }
  .btn:hover { background: #475569; }
  .empty { color: #64748b; font-style: italic; }
  .diff-toggle { margin-bottom: 12px; }
  .diff-toggle input { margin-right: 6px; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(opts.target)}</h1>
  <div class="meta">
    Hunt completed ${new Date(opts.startedAt).toISOString()} ·
    Duration ${(opts.durationMs / 1000).toFixed(1)}s ·
    Cost $${opts.cost.toFixed(2)} ·
    ${opts.findings.length} finding${opts.findings.length === 1 ? '' : 's'}
  </div>
  <div style="margin-top: 12px;">${regenButton}${shareButton}</div>
</header>
<div class="layout">
  <div class="main">
    <div class="panel">
      <h2>Findings</h2>
      ${findingsHtml || '<div class="empty">No findings.</div>'}
    </div>
  </div>
  <div class="sidebar">
    <div class="panel">
      <h2>Severity Breakdown</h2>
      <div class="counts">
        <div class="count" style="background:${severityColor('critical')}"><span class="n">${counts.critical}</span><span class="label">Critical</span></div>
        <div class="count" style="background:${severityColor('high')}"><span class="n">${counts.high}</span><span class="label">High</span></div>
        <div class="count" style="background:${severityColor('medium')}"><span class="n">${counts.medium}</span><span class="label">Medium</span></div>
        <div class="count" style="background:${severityColor('low')}"><span class="n">${counts.low}</span><span class="label">Low</span></div>
        <div class="count" style="background:${severityColor('info')}"><span class="n">${counts.info}</span><span class="label">Info</span></div>
      </div>
    </div>
    <div class="panel">
      <h2>Diff vs Last Hunt</h2>
      <div class="diff-toggle"><input type="checkbox" id="showDiff" checked /> <label for="showDiff">Show changes</label></div>
      ${diffHtml}
    </div>
  </div>
</div>
</body>
</html>`;
}

function renderFinding(f: AppModelFinding, shots: string[]): string {
  const sev = f.severity ?? 'info';
  const fp = fingerprint(f);
  const payload = f.payload ? `<div class="payload">${escapeHtml(f.payload)}</div>` : '';
  const evidence = f.evidence ? `<div class="evidence"><strong>Evidence:</strong> <code>${escapeHtml(JSON.stringify(f.evidence).slice(0, 500))}</code></div>` : '';
  const desc = f.description ? `<div class="desc">${escapeHtml(f.description)}</div>` : '';
  const shotsHtml = shots.length > 0 ? `<div class="shots">${shots.map((s) => `<img src="${s}" alt="screenshot" />`).join('')}</div>` : '';
  return `<div class="finding" style="border-left-color: ${severityColor(sev)}" data-fingerprint="${fp}">
  <div class="head">
    <div class="type">${escapeHtml(f.type ?? 'unknown')}</div>
    <div class="sev" style="background:${severityColor(sev)}">${escapeHtml(sev)}</div>
  </div>
  <div class="endpoint">${escapeHtml(f.method ?? 'GET')} ${escapeHtml(f.endpoint ?? '')}${f.param ? '?' + escapeHtml(f.param) : ''}</div>
  ${payload}
  ${evidence}
  ${desc}
  ${shotsHtml}
</div>`;
}

function renderDiff(diff: HuntDiff): string {
  if (diff.previousHuntAt === 0) {
    return `<div class="empty">First hunt on this target — no prior snapshot to diff against.</div>`;
  }
  const dt = new Date(diff.previousHuntAt).toISOString();
  return `
  <div class="diff-row"><span>Previous hunt</span><span>${escapeHtml(dt)}</span></div>
  <div class="diff-row"><span class="add">+ ${diff.added.length} new</span><span>${escapeHtml(diff.added.map((f) => f.type).join(', '))}</span></div>
  <div class="diff-row"><span class="fix">− ${diff.fixed.length} fixed</span><span>${escapeHtml(diff.fixed.map((f) => f.type).join(', '))}</span></div>
  <div class="diff-row"><span class="regr">! ${diff.regressed.length} regressed</span><span>${escapeHtml(diff.regressed.map((f) => f.type).join(', '))}</span></div>
  <div class="diff-row"><span>= ${diff.unchanged.length} unchanged</span></div>
  `;
}

/** Build a self-contained shareable HTML report. */
export function buildSelfContainedReport(opts: HtmlReportOptions): string {
  // The above renderHtmlReport is already self-contained (no external resources).
  return renderHtmlReport(opts);
}
