// src/agents/composer.ts
//
// The Composer is the LLM-driven core of the hunt. It reads a target
// endpoint, proposes an attack plan, picks primitives from the catalog,
// executes them, observes results, and recursively spawns specialist
// composers when the primitives alone can't handle the situation.
//
// Key design:
// - The LLM is the planner, not the executor. It picks primitives.
// - Each primitive is small, well-tested, deterministic.
// - Recursion is depth-capped (default 2).
// - All evidence is collected in ctx.evidenceLog and emitted via writeFinding.

import type { LLMClient, LLMCallResult } from '../llm/client';
import type { AppModelEndpoint, AppModelFinding, FindingEvidence } from '../core/app-model';
import {
  PRIMITIVE_CATALOG,
  type PrimitiveContext,
  type PrimitiveName,
  type PrimitiveRequest,
  type PrimitiveResponse,
  type PrimitiveResult,
  type InjectionLocation,
  type PayloadType,
} from '../primitives';

export interface AttackPlan {
  id: number;
  technique: string;
  rationale: string;
  confidence: number;
  /** Primitives the LLM wants to call, in order */
  primitives: Array<{
    name: PrimitiveName;
    args: Record<string, unknown>;
  }>;
  /** Expected outcome — used by the test framework to verify */
  expectedOutcome?: 'vulnerable' | 'clean' | 'inconclusive' | 'blocked';
}

export interface ComposerOptions {
  llm: LLMClient;
  /** Recursion depth limit (default 2 — top-level + 1 specialist) */
  maxDepth?: number;
  /** Per-plan timeout in ms (default 30s) */
  planTimeoutMs?: number;
  /** Per-run budget in ms (default 15 min) */
  budgetMs?: number;
  /** Callback fired when a finding is emitted */
  onFinding?: (finding: AppModelFinding) => void;
  /** Callback fired when a sub-composer is spawned */
  onSubtask?: (specialist: string, reason: string) => void;
  /** Callback fired on each primitive invocation (for UI / logs) */
  onPrimitive?: (name: PrimitiveName, args: unknown, result: PrimitiveResult) => void;
}

export interface ComposerRunResult {
  findings: AppModelFinding[];
  plans: AttackPlan[];
  /** Total duration */
  durationMs: number;
  /** Whether the LLM was real (not mock) */
  llmWasReal: boolean;
  /** Spawned sub-composers and their outcomes */
  subtasks: Array<{ specialist: string; result: 'done' | 'failed'; findings: number }>;
}

const SYSTEM_PROMPT_PLANNER = `You are the planning module of Ultimatrix, an AI security researcher. Given a target endpoint, propose 1-3 attack plans as a JSON array.

Each plan must include:
- "id": sequential number
- "technique": one of "idor", "xss", "sqli", "ssti", "ssrf", "csrf", "redirect", "xxe", "headers", "fileupload", "path", "cmd"
- "rationale": 1-2 sentence justification
- "confidence": 0-1 score
- "primitives": array of {name, args} — primitive names from the catalog and their arguments
- "expectedOutcome": "vulnerable", "clean", "inconclusive", or "blocked"

Available primitive catalog (use exact names):
- httpRequest(method, url, headers, body, cookies, timeoutMs)
- multipartUpload(url, filename, contentType, content, headers)
- followRedirects(initial, maxHops)
- craftPayload(type, context, engine?, count?)
- craftBypass(payload, wafType)
- craftXmlEntity(target, path?, host?)
- craftMultipart(filename, content, contentType, fieldName?)
- injectInContext(payload, location, base, paramName?)
- omitHeader(headers, name)
- parseResponse — no args, takes the previous response
- evaluateRendered(url, payload, matchMode?)
- measureTiming(url, baseline, payload, iterations, paramName, method)
- compareResponses(baseline, target, ignoreKeys?)
- checkWaf(response)
- findEndpointsInResponse(html, baseUrl)
- extractSessionCookie(response)
- extractCsrfToken(html)
- useSession(role, cookies?, bearerToken?)
- spawnSubtask(specialist, reason, payload)
- recordEvidence(type, data, label) — type: "text" | "screenshot" | "har_entry" | "raw_request" | "raw_response"
- writeFinding(type, endpoint, param, method?, payload?, description?, severity, confidence)

Injection locations: "query" | "body" | "header" | "cookie" | "path" | "filename" | "xml-entity"
Payload types: "sqli" | "xss" | "ssti" | "path" | "cmd" | "xxe" | "ssrf" | "csrf" | "redirect"

Respond with ONLY a JSON object: {"plans": [...]}`;

const SYSTEM_PROMPT_TRIAGE = `You are the triage module. Given evidence from a primitive execution, decide:
1. Is there a confirmed vulnerability? (confidence 0-1)
2. What severity? (critical|high|medium|low|info)
3. Should a specialist be spawned? (waf-bypass | second-order | chain-reasoning)

Return JSON: {"vulnerable": bool, "confidence": 0-1, "severity": "...", "specialist": "..." | null, "specialistReason": "..."}`;

export class Composer {
  private opts: Required<Omit<ComposerOptions, 'onFinding' | 'onSubtask' | 'onPrimitive'>> & ComposerOptions;

  constructor(opts: ComposerOptions) {
    this.opts = {
      maxDepth: 2,
      planTimeoutMs: 30_000,
      budgetMs: 15 * 60 * 1000,
      ...opts,
    };
  }

  /**
   * Run the composer against a target endpoint. Returns all findings.
   * The composer:
   *  1. Asks the LLM to propose 1-3 attack plans
   *  2. For each plan: executes the primitives in order
   *  3. For each primitive result: asks the LLM to triage
   *  4. If the LLM signals a specialist is needed, spawns a sub-composer (depth-capped)
   *  5. Emits findings via onFinding callback
   */
  async run(target: AppModelEndpoint, ctx: PrimitiveContext): Promise<ComposerRunResult> {
    const startedAt = Date.now();
    const findings: AppModelFinding[] = [];
    const plans: AttackPlan[] = [];
    const subtasks: ComposerRunResult['subtasks'] = [];

    const planResult = await this.opts.llm.call({
      system: SYSTEM_PROMPT_PLANNER,
      user: this.formatTargetForPlanner(target),
      temperature: 0.2,
    });
    const llmWasReal = planResult.provider !== 'mock';

    const proposedPlans = this.parsePlans(planResult);
    plans.push(...proposedPlans);

    for (const plan of proposedPlans) {
      if (Date.now() - startedAt > this.opts.budgetMs) break;
      if (ctx.depth >= (this.opts.maxDepth ?? 2)) break;

      const planFindings = await this.executePlan(plan, target, ctx);
      findings.push(...planFindings);
      for (const f of planFindings) {
        this.opts.onFinding?.(f);
      }
    }

    return {
      findings,
      plans,
      durationMs: Date.now() - startedAt,
      llmWasReal,
      subtasks,
    };
  }

  /**
   * Propose 1..count attack plans for a target without executing them.
   * Used by the /plan slash command so the operator can review before /attack.
   */
  async proposePlans(
    target: AppModelEndpoint,
    _ctx: PrimitiveContext,
    count = 3,
  ): Promise<AttackPlan[]> {
    const planResult = await this.opts.llm.call({
      system: SYSTEM_PROMPT_PLANNER,
      user: this.formatTargetForPlanner(target) + `\n\nPropose exactly ${count} plans.`,
      temperature: 0.2,
    });
    return this.parsePlans(planResult).slice(0, count);
  }

  private formatTargetForPlanner(target: AppModelEndpoint): string {
    return `Target endpoint:
- path: ${target.path}
- method: ${target.method}
- params: ${JSON.stringify(target.params ?? [])}
- requiresAuth: ${target.requiresAuth}
- responseStatus: ${target.responseStatus}
- contentType: ${target.contentType}
- bodyPreview: ${(target.bodyPreview ?? '').slice(0, 500)}
${target.bodyFields ? `- bodyFields: ${JSON.stringify(target.bodyFields)}` : ''}
${target.authHeaders ? `- authHeaders: ${JSON.stringify(target.authHeaders)}` : ''}

Propose 1-3 attack plans for this endpoint. Each plan must use primitives from the catalog.`;
  }

  private parsePlans(planResult: LLMCallResult): AttackPlan[] {
    if (!planResult.json || typeof planResult.json !== 'object') {
      // Mock fallback — produce 1 default parse-only plan (no network needed)
      return [
        {
          id: 1,
          technique: 'headers',
          rationale: 'mock plan — no real LLM configured; static security-header check',
          confidence: 0.5,
          primitives: [
            { name: 'parseResponse', args: { response: { status: 200, url: 'http://test.local', finalUrl: 'http://test.local', headers: {}, body: '', durationMs: 0, redirects: [], timing: { dns: 0, connect: 0, tls: 0, ttfb: 0, download: 0 } } } },
          ],
        },
      ];
    }
    const j = planResult.json as { plans?: unknown };
    if (!Array.isArray(j.plans)) return [];
    return j.plans.map((p: any, i: number) => ({
      id: p.id ?? i + 1,
      technique: String(p.technique ?? 'unknown'),
      rationale: String(p.rationale ?? ''),
      confidence: typeof p.confidence === 'number' ? p.confidence : 0.5,
      primitives: Array.isArray(p.primitives) ? p.primitives.map((pr: any) => ({
        name: String(pr.name) as PrimitiveName,
        args: pr.args ?? {},
      })) : [],
      expectedOutcome: p.expectedOutcome,
    }));
  }

  /**
   * Execute a single plan: run each primitive in order, thread state via $prev/$target.
   * Exposed publicly so the /attack <n> slash command can execute a chosen plan.
   */
  async executePlan(
    plan: AttackPlan,
    target: AppModelEndpoint,
    ctx: PrimitiveContext,
  ): Promise<AppModelFinding[]> {
    const planFindings: AppModelFinding[] = [];
    let prev: PrimitiveResult | undefined;

    for (const step of plan.primitives) {
      if (Date.now() - ctx.budget.startedAt > ctx.budget.maxMs) break;

      // Resolve $prev / $target placeholders
      const resolvedArgs = this.resolveArgs(step.args, prev, target);
      const prim = PRIMITIVE_CATALOG[step.name];
      if (!prim) continue;

      const stepStart = Date.now();
      const result = await Promise.resolve(prim.execute(resolvedArgs, ctx));
      const stepDuration = Date.now() - stepStart;
      this.opts.onPrimitive?.(step.name, resolvedArgs, result);

      // If the primitive signaled a spawn, handle it
      if (result.spawn) {
        this.opts.onSubtask?.(result.spawn.specialist, result.spawn.reason);
        // TODO: dispatch to specialist composer
      }

      // Triage the result
      const triage = await this.triage(plan, step, result, target);
      if (triage.vulnerable && triage.confidence > 0.5) {
        // Build a finding from the accumulated evidence
        const finding = this.buildFinding(plan, step, result, triage, target, ctx);
        if (finding) {
          planFindings.push(finding);
          // Clear evidence log so the next finding starts fresh
          ctx.evidenceLog.length = 0;
        }
      }

      prev = result;
    }

    return planFindings;
  }

  private resolveArgs(
    args: Record<string, unknown>,
    prev: PrimitiveResult | undefined,
    target: AppModelEndpoint,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (v === '$prev') {
        resolved[k] = prev?.value;
      } else if (v === '$target') {
        resolved[k] = { method: target.method, url: target.path, headers: {}, cookies: ctx_cookies_stub() };
      } else if (typeof v === 'string') {
        // Resolve any "<placeholder>" strings to target fields
        resolved[k] = v
          .replace(/<target>/g, target.path)
          .replace(/<url>/g, target.path)
          .replace(/<method>/g, target.method);
      } else {
        resolved[k] = v;
      }
    }
    return resolved;
  }

  private async triage(
    plan: AttackPlan,
    step: { name: PrimitiveName; args: Record<string, unknown> },
    result: PrimitiveResult,
    target: AppModelEndpoint,
  ): Promise<{ vulnerable: boolean; confidence: number; severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; specialist: string | null; specialistReason: string | null }> {
    // Fast heuristic triage for known signal-bearing primitives
    if (step.name === 'compareResponses' && result.value) {
      const v = result.value as { divergence: number; vulnerable: boolean };
      if (v.vulnerable) {
        return { vulnerable: true, confidence: 0.85, severity: 'critical', specialist: null, specialistReason: null };
      }
    }
    if (step.name === 'evaluateRendered' && result.value) {
      const v = result.value as { matchType: string };
      if (v.matchType === 'event-fires' || v.matchType === 'unescaped') {
        return { vulnerable: true, confidence: 0.9, severity: 'high', specialist: null, specialistReason: null };
      }
    }
    if (step.name === 'checkWaf' && result.value) {
      const v = result.value as { detected: boolean; vendor: string };
      if (v.detected) {
        return { vulnerable: false, confidence: 0, severity: 'info', specialist: 'waf-bypass', specialistReason: `WAF detected: ${v.vendor}` };
      }
    }
    if (step.name === 'measureTiming' && result.value) {
      const v = result.value as { vulnerable: boolean; timingDeltaMs: number };
      if (v.vulnerable) {
        return { vulnerable: true, confidence: 0.8, severity: 'high', specialist: null, specialistReason: null };
      }
    }
    if (step.name === 'parseResponse' && result.value) {
      const v = result.value as { status: number; body: string };
      if (v.status >= 500) {
        return { vulnerable: false, confidence: 0, severity: 'info', specialist: null, specialistReason: null };
      }
    }

    // Otherwise ask the LLM (if real)
    if (this.opts.llm.isReal()) {
      const t = await this.opts.llm.call({
        system: SYSTEM_PROMPT_TRIAGE,
        user: `Plan: ${plan.technique} (${plan.rationale})\nStep: ${step.name}\nResult: ${JSON.stringify(result.value ?? null).slice(0, 1000)}\n\nTriage this.`,
        temperature: 0.1,
      });
      const j = t.json as any;
      if (j && typeof j === 'object') {
        return {
          vulnerable: !!j.vulnerable,
          confidence: typeof j.confidence === 'number' ? j.confidence : 0.5,
          severity: (j.severity ?? 'info') as any,
          specialist: j.specialist ?? null,
          specialistReason: j.specialistReason ?? null,
        };
      }
    }
    return { vulnerable: false, confidence: 0, severity: 'info', specialist: null, specialistReason: null };
  }

  private buildFinding(
    plan: AttackPlan,
    step: { name: PrimitiveName; args: Record<string, unknown> },
    result: PrimitiveResult,
    triage: { vulnerable: boolean; confidence: number; severity: 'critical' | 'high' | 'medium' | 'low' | 'info' },
    target: AppModelEndpoint,
    ctx: PrimitiveContext,
  ): AppModelFinding | null {
    if (!triage.vulnerable) return null;
    const paramName = (step.args as any).paramName as string ?? '';
    const payload = (step.args as any).payload as string ?? '';
    // Record the primitive's own evidence
    if (result.evidence) {
      for (const e of result.evidence) {
        ctx.evidenceLog.push(e);
      }
    }
    // Always record the raw primitive result
    ctx.evidenceLog.push({
      type: 'text',
      data: JSON.stringify({ plan: plan.technique, step: step.name, result: result.value ?? null }).slice(0, 1500),
      label: `${plan.technique} via ${step.name}`,
      timestamp: Date.now(),
      session: ctx.sessionRole,
    });
    return {
      id: `f-${Date.now()}-${Math.floor(Math.random() * 10_000).toString(36)}`,
      type: plan.technique,
      endpoint: target.path,
      param: paramName,
      method: target.method,
      payload,
      description: plan.rationale || `${plan.technique} detected via ${step.name}`,
      severity: triage.severity,
      confidence: triage.confidence,
      confirmed: triage.confidence >= 0.7,
      evidence: ctx.evidenceLog.slice(),
    };
  }
}

function ctx_cookies_stub(): Record<string, string> { return {}; }
