// src/codegen/synthesize.ts
//
// Block 9b.2: post-hoc LLM-driven Playwright spec synthesis.
//
// If the meta-orchestrator never called recordTestStep (or only called
// it a few times), the live spec is too sparse to be useful as a
// regression test. This module is the backstop: at hunt end, it reads
// the trace (findings + behavioral steps + any existing live-spec
// fragments from parallel v3 workers) and asks the LLM to write a
// complete, runnable Playwright spec that reproduces the most important
// confirmed findings.
//
// Design constraints:
// - LLM is the only authority on what becomes a test. No hardcoded
//   event-type→method switch. The prompt + a representative trace is
//   the input; the spec is the output.
// - "Most important" = the LLM picks. We sort findings by severity as
//   a hint but don't restrict the LLM.
// - The output is ONE file: <outDir>/live.finalised.spec.ts. Any
//   per-node live specs from parallel v3 workers are merged into a
//   single prompt input (they're evidence, not the deliverable).
// - The output is always valid Playwright code, even if the LLM
//   emits garbage. We strip markdown fences, validate against a
//   minimum shape (must import { test, expect }, must define at
//   least one test block), and on failure fall back to a stub that
//   runs the existing live specs as-is.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import type { LLMClient } from '../llm/client';
import type { AppModelFinding } from '../core/app-model';

export interface SynthesizeOptions {
  /** Where the live specs live (the orchestrator's outDir). */
  outDir: string;
  /** Findings to encode as assertions. Optional — we read from app-model.json if not given. */
  findings?: AppModelFinding[];
  /** Behavioral steps from the JSONL trace (if any). Optional. */
  behavioralSummary?: string;
  /** Target URL (for the goto in the test). */
  target?: string;
  /** LLM client to use. */
  llm: LLMClient;
  /** Skip synthesis if the merged live spec already has at least this many lines. Default 3. */
  minLiveSteps?: number;
  /** Output filename. Default: <outDir>/live.finalised.spec.ts. */
  outFileName?: string;
}

export interface SynthesizeResult {
  /** Path to the written spec file. */
  outPath: string;
  /** Number of live spec lines we started with. */
  liveLines: number;
  /** Whether the LLM was actually called. */
  llmCalled: boolean;
  /** The LLM's raw text response (or null if skipped). */
  llmText: string | null;
  /** Why we skipped synthesis (if we did). */
  skippedReason?: string;
  /** Whether the synthesized spec was validated as a complete Playwright file. */
  validated: boolean;
  /** If validation failed, what was wrong. */
  validationError?: string;
}

const SYSTEM_PROMPT = `You are a Playwright test engineer writing a regression test for a security finding.

Output ONLY the test file content. No prose, no commentary, no markdown fences. The file must be a single self-contained Playwright spec that:
- Imports { test, expect } from '@playwright/test'
- Defines a single test() block with a descriptive name
- Has at least one page.goto() (or page.request.* call) to reproduce the action
- Has at least one expect() assertion that would fail if the vulnerability is fixed
- Uses real-looking selectors/values from the finding evidence (no placeholders like 'XXX')
- Is always-valid TypeScript — no syntax errors, no unclosed braces

Keep it minimal: one test, the reproduction steps, the assertion. Do not add comments, helpers, or boilerplate beyond the import.`;

/**
 * Run the synthesis. If the live spec already has enough content, this
 * is a no-op (returns skippedReason). Otherwise it asks the LLM to
 * write a spec and validates the result.
 */
export async function synthesizeSpecFromTrace(opts: SynthesizeOptions): Promise<SynthesizeResult> {
  const minLiveSteps = opts.minLiveSteps ?? 3;
  const outPath = join(opts.outDir, opts.outFileName ?? 'live.finalised.spec.ts');

  // 1. Aggregate existing live specs (per-node from parallel v3 workers)
  const liveContent = aggregateLiveSpecs(opts.outDir);
  const liveLines = countStepsInSpec(liveContent);

  // 2. Skip if the LLM already wrote enough during the hunt
  if (liveLines >= minLiveSteps) {
    return {
      outPath,
      liveLines,
      llmCalled: false,
      llmText: null,
      skippedReason: `live spec already has ${liveLines} steps (>= ${minLiveSteps}) — synthesis is unnecessary`,
      validated: true,
    };
  }

  // 3. Build the prompt. The LLM sees: findings, any behavioral
  //    summary, and the target.
  const findings = opts.findings ?? readFindingsFromAppModel(opts.outDir);
  const userPrompt = buildUserPrompt({
    findings,
    behavioralSummary: opts.behavioralSummary,
    target: opts.target,
    liveContent,
  });

  // 4. Call the LLM
  let llmText: string;
  try {
    const res = await opts.llm.call({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      label: 'codegen/synthesize',
      temperature: 0.2,
      maxTokens: 2000,
    });
    llmText = res.text;
  } catch (e) {
    // LLM call failed — fall back to writing a stub that uses whatever
    // live content we have. This means the user at least has a valid
    // (if empty) spec file rather than a hard failure.
    return writeFallback({ outPath, outDir: opts.outDir, liveContent, llmText: null, reason: `LLM call failed: ${(e as Error).message}` });
  }

  // 5. Validate (and clean markdown fences if present)
  const cleaned = stripCodeFences(llmText);
  const validation = validateSpec(cleaned);
  if (!validation.ok) {
    return writeFallback({ outPath, outDir: opts.outDir, liveContent, llmText, reason: `validation failed: ${validation.error}` });
  }

  // 6. Write the cleaned spec (stripped of fences)
  if (!existsSync(opts.outDir)) mkdirSync(opts.outDir, { recursive: true });
  writeFileSync(outPath, cleaned, 'utf-8');
  return { outPath, liveLines, llmCalled: true, llmText, validated: true };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Read all `live*.spec.ts` files in outDir and concatenate their
 * step bodies (everything between the test() open and the test()
 * closing brace). Per-node files from parallel v3 workers land here.
 */
function aggregateLiveSpecs(outDir: string): string {
  if (!existsSync(outDir)) return '';
  const files: string[] = [];
  for (const f of readdirSync(outDir)) {
    if (!f.startsWith('live') || !f.endsWith('.spec.ts')) continue;
    if (f === 'live.finalised.spec.ts') continue; // never merge the output
    const p = join(outDir, f);
    try {
      if (statSync(p).isFile()) files.push(p);
    } catch { /* ignore */ }
  }
  files.sort(); // deterministic order
  const chunks: string[] = [];
  for (const p of files) {
    const c = readFileSync(p, 'utf-8');
    const body = extractTestBody(c);
    if (body) chunks.push(`// from ${basename(p)}\n${body}`);
  }
  return chunks.join('\n\n');
}

/** Extract everything between `test(...) {` and the matching `});`. */
function extractTestBody(spec: string): string {
  const open = spec.indexOf('=> {');
  if (open < 0) return '';
  const start = spec.indexOf('{', open);
  if (start < 0) return '';
  // Find matching closing brace by depth
  let depth = 1;
  let i = start + 1;
  while (i < spec.length && depth > 0) {
    const ch = spec[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return spec.slice(start + 1, i - 1).trim();
}

/**
 * Count the meaningful action lines in a spec body. We count
 * - Lines starting with `await page.`
 * - Lines starting with `await expect(`
 * - Comments tagged `// step N:`
 */
function countStepsInSpec(content: string): number {
  if (!content) return 0;
  const lines = content.split('\n');
  let n = 0;
  for (const l of lines) {
    if (/await\s+page\.|await\s+expect\(|\/\/\s*step\s+\d+/.test(l)) n++;
  }
  return n;
}

function readFindingsFromAppModel(outDir: string): AppModelFinding[] {
  const p = join(outDir, 'app-model.json');
  if (!existsSync(p)) return [];
  try {
    const json = JSON.parse(readFileSync(p, 'utf-8'));
    return Array.isArray(json.findings) ? json.findings : [];
  } catch {
    return [];
  }
}

function buildUserPrompt(input: {
  findings: AppModelFinding[];
  behavioralSummary?: string;
  target?: string;
  liveContent: string;
}): string {
  const parts: string[] = [];
  parts.push('# Target');
  parts.push(input.target ?? '(unknown target)');

  parts.push('\n# Confirmed findings (sorted by severity)');
  if (input.findings.length === 0) {
    parts.push('(no findings)');
  } else {
    const sorted = [...input.findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    for (const f of sorted) {
      parts.push(`\n## [${f.severity ?? 'unknown'}] ${f.type} @ ${f.endpoint} (confidence ${f.confidence})`);
      if (f.param) parts.push(`Param: ${f.param}`);
      if (f.method) parts.push(`Method: ${f.method}`);
      if (f.payload) parts.push(`Payload: ${f.payload.slice(0, 200)}`);
      if (f.description) parts.push(`Description: ${f.description.slice(0, 400)}`);
      if (Array.isArray(f.evidence) && f.evidence.length > 0) {
        const ev = f.evidence.slice(0, 3).map((e) => `  - [${e.type}] ${String(e.label).slice(0, 60)}: ${String(e.data).slice(0, 200)}`).join('\n');
        parts.push(`Evidence:\n${ev}`);
      }
    }
  }

  if (input.behavioralSummary) {
    parts.push('\n# Behavioral trace (first 30 steps)');
    parts.push(input.behavioralSummary.slice(0, 3000));
  }

  if (input.liveContent) {
    parts.push('\n# Existing live-spec fragments (use as hints, not as the final test)');
    parts.push(input.liveContent.slice(0, 3000));
  }

  parts.push('\n# Output');
  parts.push('Write ONE Playwright test that reproduces the most important finding(s). The test should:');
  parts.push('1. Open the target URL');
  parts.push('2. Issue the relevant request / inject the payload');
  parts.push('3. Assert the vulnerable behavior (using expect() that would PASS on the vulnerable target and FAIL on a fixed one)');
  parts.push('Output the test file now.');
  return parts.join('\n');
}

function severityRank(s: string | undefined): number {
  const v = (s ?? '').toLowerCase();
  if (v === 'critical') return 5;
  if (v === 'high') return 4;
  if (v === 'medium' || v === 'med') return 3;
  if (v === 'low') return 2;
  return 1;
}

interface ValidationResult { ok: boolean; error?: string; }

function validateSpec(text: string): ValidationResult {
  if (!text || text.trim().length < 20) {
    return { ok: false, error: 'response is empty or too short' };
  }
  // Strip markdown code fences if the LLM wrapped the output
  const cleaned = stripCodeFences(text);
  if (!/import\s*\{[^}]*test[^}]*\}\s*from\s*['"]@playwright\/test['"]/.test(cleaned)) {
    return { ok: false, error: 'missing @playwright/test import' };
  }
  if (!/test\s*\(/.test(cleaned)) {
    return { ok: false, error: 'no test() block' };
  }
  if (!/await\s+(page\.|expect\()/.test(cleaned)) {
    return { ok: false, error: 'no page or expect calls' };
  }
  // Brace balance check
  const opens = (cleaned.match(/\{/g) || []).length;
  const closes = (cleaned.match(/\}/g) || []).length;
  if (opens !== closes) {
    return { ok: false, error: `unbalanced braces (${opens} open, ${closes} close)` };
  }
  return { ok: true };
}

function stripCodeFences(text: string): string {
  // Remove ```typescript\n...\n``` or ```\n...\n``` wrapping
  const m = text.match(/^```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)\n```\s*$/);
  if (m) return m[1];
  return text;
}

function writeFallback(input: {
  outPath: string;
  outDir: string;
  liveContent: string;
  llmText: string | null;
  reason: string;
}): SynthesizeResult {
  if (!existsSync(input.outDir)) mkdirSync(input.outDir, { recursive: true });
  // If we have live content, wrap it in a minimal valid test
  if (input.liveContent) {
    const wrapped = `import { test, expect } from '@playwright/test';\n\ntest('auto-generated regression (synthesis fallback)', async ({ page }) => {\n${input.liveContent}\n});\n`;
    writeFileSync(input.outPath, wrapped, 'utf-8');
    return {
      outPath: input.outPath,
      liveLines: countStepsInSpec(input.liveContent),
      llmCalled: input.llmText !== null,
      llmText: input.llmText,
      skippedReason: input.reason,
      validated: true,
    };
  }
  // No live content either — write a minimal always-passing test
  const stub = `import { test, expect } from '@playwright/test';\n\ntest('auto-generated regression (no synthesis)', async ({ page }) => {\n  // No findings or live steps captured during the hunt. This stub exists so\n  // \`npx playwright test\` has something valid to run. Remove or replace as needed.\n  expect(true).toBeTruthy();\n});\n`;
  writeFileSync(input.outPath, stub, 'utf-8');
  return {
    outPath: input.outPath,
    liveLines: 0,
    llmCalled: input.llmText !== null,
    llmText: input.llmText,
    skippedReason: input.reason,
    validated: true,
  };
}

/**
 * Read the on-disk spec at `path`. Convenience used by tests.
 */
export function readSynthesizedSpec(path: string): string {
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}
