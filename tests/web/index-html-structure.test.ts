// tests/web/index-html-structure.test.ts
//
// Block 16: Web UI v4 events migration. The index.html at
// src/web/static/index.html must:
//   - Have a Findings panel
//   - Have a v4-event handler in its onmessage
//   - Render all 15 v4 event types we want to show
//   - Use a 4-column grid (agent-tree | LLM stream | findings | log)
//   - Have the count badge in the Findings header
//   - Have a renderFindings() function that dedupes by
//     `${type}|${endpoint}|${param}`
//   - Clear findings on start()
//
// These are structural tests — the HTML/JS is hand-written and lives
// in src/web/static/index.html. We don't render it; we just inspect
// the source.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HTML_PATH = path.resolve(__dirname, '..', '..', 'src', 'web', 'static', 'index.html');

function readHtml(): string {
  return fs.readFileSync(HTML_PATH, 'utf-8');
}

describe('web UI: index.html structure (Block 16)', () => {
  it('declares a 5-column main grid (Block 19 added app-model + live-spec)', () => {
    const html = readHtml();
    expect(html).toMatch(/grid-template-columns:\s*1fr\s+1\.2fr\s+1fr\s+1fr\s+1fr/);
  });

  it('has a Findings panel with id=findings and a count badge id=findings-count', () => {
    const html = readHtml();
    expect(html).toMatch(/<section class="panel">\s*<h2>\s*<span>Findings<\/span>\s*<span class="count" id="findings-count">/);
    expect(html).toMatch(/<div class="findings" id="findings">/);
  });

  it('defines a renderFindings() function that sorts by severity rank', () => {
    const html = readHtml();
    expect(html).toMatch(/function renderFindings\(\)/);
    expect(html).toMatch(/const rank = \{ critical: 0, high: 1, medium: 2, low: 3, info: 4 \}/);
  });

  it('dedupes findings by ${type}|${endpoint}|${param}', () => {
    const html = readHtml();
    expect(html).toMatch(/\$\{f\.type\}\|\$\{f\.endpoint\}\|\$\{f\.param \|\| ''\}/);
  });

  it('has a v4-event handler in the ws.onmessage switch', () => {
    const html = readHtml();
    expect(html).toMatch(/else if \(ev\.type === 'v4-event'\)/);
  });

  it('handleV4Event covers finding + finding-deduped + primitive-call + oob-callback + screenshot + agent-spawn + chat-message + phase + done + log + diff + agent-action', () => {
    const html = readHtml();
    const fnMatch = html.match(/function handleV4Event\([\s\S]*?\n  \}/);
    expect(fnMatch).toBeTruthy();
    const fn = fnMatch![0];
    for (const t of [
      "'finding'",
      "'finding-deduped'",
      "'primitive-call'",
      "'oob-callback'",
      "'screenshot'",
      "'agent-spawn'",
      "'chat-message'",
      "'phase'",
      "'budget-update'",
      "'behavioral-step'",
      "'log'",
      "'diff'",
      "'done'",
      "'agent-action'",
    ]) {
      expect(fn, `handleV4Event should handle ${t}`).toContain(t);
    }
  });

  it('falls through to a generic "unknown v4 event" line so silent drops never happen', () => {
    const html = readHtml();
    expect(html).toMatch(/unknown v4 event/);
  });

  it('clears findings map and re-renders on start()', () => {
    const html = readHtml();
    const startMatch = html.match(/function start\(\)[\s\S]*?\n  \}/);
    expect(startMatch).toBeTruthy();
    const body = startMatch![0];
    expect(body).toMatch(/findings\.clear\(\)/);
    expect(body).toMatch(/renderFindings\(\)/);
  });

  it('still emits the v3 events the existing UI panels use (back-compat)', () => {
    const html = readHtml();
    // The frontend still renders started, done, error, llm-token,
    // plan, finding (v3 shape), chain, primitive. v3 still works
    // alongside v4 — neither side has to be ripped out.
    for (const t of ["'started'", "'done'", "'error'", "'llm-token'", "'plan'", "'finding'", "'chain'", "'primitive'"]) {
      expect(html, `v3 event ${t} should still be handled`).toContain(`ev.type === ${t}`);
    }
  });
});

describe('web UI: index.html structure (Block 19) — live spec + app-model + re-spider', () => {
  it('has a Re-spider checkbox in the controls bar', () => {
    const html = readHtml();
    expect(html).toMatch(/<label><input type="checkbox" id="re-spider"\s*\/> Re-spider<\/label>/);
  });

  it('has a max-runtime number input in the controls bar', () => {
    const html = readHtml();
    expect(html).toMatch(/<input type="number" id="max-runtime"/);
  });

  it('has an App model panel with id=app-model', () => {
    const html = readHtml();
    expect(html).toMatch(/<section class="panel">\s*<h2>\s*<span>App model<\/span>/);
    expect(html).toMatch(/<div class="app-model" id="app-model">/);
  });

  it('has a Live spec panel with id=live-spec and id=spec-count', () => {
    const html = readHtml();
    expect(html).toMatch(/<section class="panel">\s*<h2>\s*<span>Live spec<\/span>\s*<span class="count" id="spec-count">/);
    expect(html).toMatch(/<div class="live-spec" id="live-spec">/);
  });

  it('declares a 5-column main grid (added app-model + live-spec)', () => {
    const html = readHtml();
    expect(html).toMatch(/grid-template-columns:\s*1fr\s+1\.2fr\s+1fr\s+1fr\s+1fr/);
  });

  it('has a renderLiveSpec() function with a per-spec list', () => {
    const html = readHtml();
    expect(html).toMatch(/function renderLiveSpec\(\)/);
    expect(html).toMatch(/class="spec-list"/);
    expect(html).toMatch(/<pre>/);
  });

  it('has a pollSpecs() function that hits /api/live-specs', () => {
    const html = readHtml();
    expect(html).toMatch(/function pollSpecs\(\)/);
    expect(html).toMatch(/`\/api\/live-specs\?outDir=\$\{encodeURIComponent\(outDir\)\}`/);
    expect(html).toMatch(/`\/api\/live-spec\?outDir=\$\{encodeURIComponent\(outDir\)\}`/);
  });

  it('has a pollAppModel() function that hits /api/app-model', () => {
    const html = readHtml();
    expect(html).toMatch(/function pollAppModel\(\)/);
    expect(html).toMatch(/`\/api\/app-model\?outDir=\$\{encodeURIComponent\(outDir\)\}`/);
  });

  it('start() sends reSpider + maxRuntimeMs in the start message', () => {
    const html = readHtml();
    const startMatch = html.match(/function start\(\)[\s\S]*?\n  \}/);
    expect(startMatch).toBeTruthy();
    const body = startMatch![0];
    expect(body).toMatch(/reSpider:\s*\$reSpider\.checked/);
    expect(body).toMatch(/maxRuntimeMs:/);
  });

  it('start() calls startPolling() on ws.onopen', () => {
    const html = readHtml();
    expect(html).toMatch(/ws\.onopen[\s\S]*?startPolling\(\)/);
  });

  it('done event triggers a final poll to capture last spec writes', () => {
    const html = readHtml();
    const doneMatch = html.match(/if \(ev\.type === 'done'\)[\s\S]*?\n      \}/);
    expect(doneMatch).toBeTruthy();
    const body = doneMatch![0];
    expect(body).toMatch(/pollSpecs\(\)/);
    expect(body).toMatch(/pollAppModel\(\)/);
  });
});
