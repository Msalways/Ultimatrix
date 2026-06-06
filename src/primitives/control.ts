// src/primitives/control.ts
//
// Control-flow primitives: spawnSubtask, recordEvidence, writeFinding.
// These let the Composer recursively spawn sub-composers, persist evidence
// to the running context, and emit findings back to the model.

import type { FindingEvidence, AppModelFinding } from '../core/app-model';
import type { PrimitiveContext, PrimitiveDefinition, PrimitiveResult } from './types';

export interface SubtaskRequest {
  specialist: 'waf-bypass' | 'second-order' | 'chain-reasoning';
  reason: string;
  payload?: unknown;
}

export interface SubtaskHandle {
  id: string;
  specialist: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: unknown;
}

export const spawnSubtask: PrimitiveDefinition<SubtaskRequest, SubtaskHandle> = {
  name: 'spawnSubtask',
  description: 'Spawn a specialist sub-composer (waf-bypass, second-order, chain-reasoning). The sub-composer runs in its own LLM context, has access to a restricted primitive subset, and can recursively spawn further sub-composers (depth-capped).',
  requiresBrowser: false,
  deterministic: false, // Spawn is conditional on LLM reasoning
  execute(args, ctx): PrimitiveResult<SubtaskHandle> {
    const start = Date.now();
    const handle: SubtaskHandle = {
      id: `sub-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      specialist: args.specialist,
      status: 'pending',
    };
    // Defer execution: the Composer loop sees the spawn signal and dispatches
    // the specialist composer. This primitive just creates the handle and
    // signals that work is queued.
    return {
      ok: true,
      value: handle,
      durationMs: Date.now() - start,
      spawn: {
        specialist: args.specialist,
        reason: args.reason,
        payload: args.payload,
      },
    };
  },
};

export const recordEvidence: PrimitiveDefinition<FindingEvidence, void> = {
  name: 'recordEvidence',
  description: 'Append an evidence item to the composer context. Evidence is later copied into the AppModelFinding when writeFinding is called.',
  requiresBrowser: false,
  deterministic: true,
  execute(evidence, ctx): PrimitiveResult<void> {
    const start = Date.now();
    // Tag the evidence with the current session role so the report can show
    // which role produced the finding
    const tagged: FindingEvidence = { ...evidence };
    if (!tagged.session && ctx.sessionRole) tagged.session = ctx.sessionRole;
    ctx.evidenceLog.push(tagged);
    return {
      ok: true,
      value: undefined,
      durationMs: Date.now() - start,
    };
  },
};

export const writeFinding: PrimitiveDefinition<
  {
    type: string;
    endpoint: string;
    param: string;
    method?: string;
    payload?: string;
    description?: string;
    severity: string;
    confidence: number;
  },
  AppModelFinding
> = {
  name: 'writeFinding',
  description: 'Emit a finalized finding. Consumes the accumulated evidence in the composer context and produces an AppModelFinding with id, evidence, severity, and confidence.',
  requiresBrowser: false,
  deterministic: true,
  execute(args, ctx): PrimitiveResult<AppModelFinding> {
    const start = Date.now();
    const finding: AppModelFinding = {
      id: `f-${Date.now()}-${Math.floor(Math.random() * 10_000).toString(36)}`,
      type: args.type,
      endpoint: args.endpoint,
      param: args.param,
      method: args.method,
      payload: args.payload,
      description: args.description,
      severity: args.severity,
      confidence: args.confidence,
      confirmed: args.confidence >= 0.7,
      evidence: ctx.evidenceLog.slice(),
    };
    // Clear the context evidence log for the next finding
    ctx.evidenceLog.length = 0;
    return {
      ok: true,
      value: finding,
      durationMs: Date.now() - start,
    };
  },
};

export interface TestStepArgs {
  /** What this step is verifying (free-form). Goes into a // comment. */
  description: string;
  /**
   * The Playwright code to run. Usually `await page.goto(...)`,
   * `await page.locator(...).fill(...)`, `await page.request.get(...)`,
   * etc. Must be a single line — multi-line blocks aren't supported.
   */
  action: string;
  /**
   * Optional assertion to run after the action. Single line, typically
   * `await expect(...).toBe...` or `await expect(...).toContain(...)`.
   * When the action is expected to fail (e.g. status 500), use
   * `await expect(...).rejects.toThrow()` style.
   */
  assertion?: string;
}

export interface TestStepHandle {
  stepId: string;
  stepIndex: number;
  recorded: boolean;
}

/**
 * Record a Playwright test step into the live spec. The LLM decides what
 * to capture — the primitive just validates + appends.
 *
 * Returns ok: false (NOT an exception) if the context has no live spec
 * attached, so the LLM can learn to skip the tool in flows where it
 * isn't plumbed (e.g. legacy v2 hunt path).
 */
export const recordTestStep: PrimitiveDefinition<TestStepArgs, TestStepHandle> = {
  name: 'recordTestStep',
  description:
    'Append a step to the live Playwright spec on disk. Use this whenever you complete an action you want to be re-runnable as a regression test. Call after meaningful probes (a request, a fill, a navigation, an XSS check, etc.) — the spec stays always-valid Playwright code. No effect if no live spec is attached to this context (returns ok: false).',
  requiresBrowser: false,
  deterministic: true,
  execute(args, ctx): PrimitiveResult<TestStepHandle> {
    const start = Date.now();
    if (!ctx.liveSpec) {
      return {
        ok: false,
        error: 'no live spec attached to this context — recordTestStep has no effect in this flow',
        durationMs: Date.now() - start,
      };
    }
    const stepIndex = ctx.liveSpec.getStepCount() + 1;
    ctx.liveSpec.appendTestStep({
      description: args.description,
      action: args.action,
      assertion: args.assertion,
    });
    return {
      ok: true,
      value: {
        stepId: `step-${Date.now()}-${Math.floor(Math.random() * 1000).toString(36)}`,
        stepIndex,
        recorded: true,
      },
      durationMs: Date.now() - start,
    };
  },
};
