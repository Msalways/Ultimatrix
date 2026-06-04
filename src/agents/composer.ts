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
import { runWafBypass } from './specialists-composers/waf-bypass';
import { runSecondOrder } from './specialists-composers/second-order';
import { runChainReasoning } from './specialists-composers/chain-reasoning';

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

CRITICAL: Match the ATTACK TECHNIQUE to the parameter that actually accepts it. The system will reject mismatches.
- "query" / "body" / "header" / "cookie" params containing free text, "q", "name", "comment", "message", "title", "text", "search" → use "xss" with injectInContext in that location
- Numeric / id params ("id", "userId", "page", "uid", "pid", "limit", "offset") → use "sqli" or "idor"
- URL-like params ("url", "next", "redirect", "callback", "return", "dest", "image") → use "ssrf" or "redirect"
- Template params ("name" rendered into a template, "view", "template") → use "ssti"
- File path params ("file", "path", "name", "page" with extension) → use "path"
- "headers" is a static check — use it as a fallback when no params exist

CRITICAL: The endpoint path AND the parameter name must be in your plan's primitives. Example:
If the endpoint is /level1/frame and the param is "query", then your injectInContext call must use location="query" and paramName="query", targeting the full URL "/level1/frame".

CRITICAL: Look at the body preview to identify actual sinks. If the body contains "function() {" near a search input, the param is XSS-sink. If the body contains "mysql_query" or "SELECT", the param is SQLi-sink.

CRITICAL: For "headers" technique, use parseResponse + writeFinding without any network request — the response is already available.

Each plan must include:
- "id": sequential number
- "technique": one of "idor", "xss", "sqli", "ssti", "ssrf", "csrf", "redirect", "xxe", "headers", "fileupload", "path", "cmd"
- "rationale": 1-2 sentence justification that names the SPECIFIC param + sink
- "confidence": 0-1 score based on how strongly the params match the attack
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
- injectInContext(payload, location, base, paramName?) — base.url MUST be the full target URL
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

Example good plan (XSS):
{"id":1,"technique":"xss","rationale":"Param 'query' on /level1/frame accepts free text; the body preview shows a search input echo — classic reflected XSS sink.","confidence":0.85,"primitives":[{"name":"craftPayload","args":{"type":"xss","context":"html"}},{"name":"injectInContext","args":{"payload":"$prev","location":"query","paramName":"query","base":{"method":"GET","url":"/level1/frame","headers":{}}}},{"name":"evaluateRendered","args":{"url":"/level1/frame","payload":"$prev","matchMode":"reflected"}},{"name":"writeFinding","args":{"type":"xss","endpoint":"/level1/frame","param":"query","payload":"$prev","description":"Reflected XSS in query param","severity":"high","confidence":0.85}}],"expectedOutcome":"vulnerable"}

Example good plan (headers):
{"id":1,"technique":"headers","rationale":"Static security-header check on a GET endpoint with no params.","confidence":0.5,"primitives":[{"name":"writeFinding","args":{"type":"headers","endpoint":"/api/info","param":"","description":"missing CSP / HSTS / X-Frame-Options","severity":"low","confidence":0.5}}],"expectedOutcome":"inconclusive"}

Respond with ONLY a JSON object: {"plans": [...]}`;

const SYSTEM_PROMPT_TRIAGE = `You are the triage module. Given evidence from a primitive execution, decide:
1. Is there a CONFIRMED vulnerability? A vulnerability is only confirmed if the EVIDENCE shows the attack succeeded — e.g. for XSS, the payload string appears UNESCAPED in the response body. For SQLi, a different response from baseline OR a SQL error message. For SSRF, the server fetched the attacker URL (OAST callback). For IDOR, the response contains data the original user shouldn't see. For open-redirect, the Location header points to attacker domain.
2. What severity? (critical|high|medium|low|info)
3. Should a specialist be spawned? (waf-bypass | second-order | chain-reasoning)

NEVER mark vulnerable=true unless the EVIDENCE actually shows the attack worked. If the response is identical to baseline, if the payload was sanitized, if the response is 404, if no callback fired — mark vulnerable=false. Confidence should be 0 unless the evidence is unambiguous.

Return JSON: {"vulnerable": bool, "confidence": 0-1, "severity": "...", "specialist": "..." | null, "specialistReason": "..."}`;

export class Composer {
  private opts: Required<Omit<ComposerOptions, 'onFinding' | 'onSubtask' | 'onPrimitive'>> & ComposerOptions;
  private recentFindings: AppModelFinding[] = [];

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
    ctx.subtaskSink = subtasks;
    this.recentFindings = findings;

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

      // If the primitive signaled a spawn, handle it by calling the specialist composer
      if (result.spawn) {
        this.opts.onSubtask?.(result.spawn.specialist, result.spawn.reason);
        // Track subtask in caller-visible state via closure (run() reads it)
        if (ctx.subtaskSink) {
          try {
            const subtaskFindings = await this.dispatchSpecialist(
              result.spawn.specialist,
              result.spawn.reason,
              result.spawn.payload,
              target,
              ctx,
            );
            for (const f of subtaskFindings) {
              planFindings.push(f);
              this.opts.onFinding?.(f);
              ctx.subtaskSink.push({ specialist: result.spawn.specialist, result: 'done', findings: 1 });
            }
            if (subtaskFindings.length === 0) {
              ctx.subtaskSink.push({ specialist: result.spawn.specialist, result: 'done', findings: 0 });
            }
          } catch (err) {
            ctx.subtaskSink.push({ specialist: result.spawn.specialist, result: 'failed', findings: 0 });
          }
        }
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

  /**
   * Dispatch a spawned specialist composer. Returns any findings it emits.
   * Each specialist has a narrower primitive subset and a focused system prompt.
   */
  private async dispatchSpecialist(
    specialist: 'waf-bypass' | 'second-order' | 'chain-reasoning',
    reason: string,
    payload: unknown,
    target: AppModelEndpoint,
    ctx: PrimitiveContext,
  ): Promise<AppModelFinding[]> {
    if (ctx.depth >= (this.opts.maxDepth ?? 2)) {
      return []; // hard stop on recursion
    }
    if (specialist === 'waf-bypass') {
      const r = await runWafBypass({
        payload: typeof payload === 'string' ? payload : String(payload ?? ''),
        wafVendor: this.inferWafVendor(target),
        originalRequest: { method: target.method, url: target.path, headers: {} },
        blockedResponse: { status: 403, body: 'blocked', headers: {} },
        target,
        depth: ctx.depth + 1,
        llm: this.opts.llm,
        onFinding: (f) => this.opts.onFinding?.(f),
      });
      return r.findings;
    }
    if (specialist === 'second-order') {
      const r = await runSecondOrder({
        storageEndpoint: target,
        reflectionEndpoint: target,
        originalPayload: typeof payload === 'string' ? payload : String(payload ?? ''),
        technique: 'xss',
        llm: this.opts.llm,
        depth: ctx.depth + 1,
        cookies: ctx.cookies,
        onFinding: (f) => this.opts.onFinding?.(f),
      });
      return r.findings;
    }
    if (specialist === 'chain-reasoning') {
      const r = await runChainReasoning({
        findings: this.recentFindings ?? [],
        target: target.path,
        llm: this.opts.llm,
      });
      // Chain-reasoning returns chains, not findings — convert to findings
      return (r.chains ?? []).map((c: any) => ({
        id: `chain-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: `chain-${c.name ?? 'unknown'}`,
        endpoint: target.path,
        param: '',
        method: target.method,
        payload: '',
        description: c.narrative ?? 'multi-step chain identified',
        severity: c.severity ?? 'medium',
        confidence: 0.7,
        confirmed: false,
        evidence: [],
      }));
    }
    return [];
  }

  private inferWafVendor(target: AppModelEndpoint): string {
    const ct = (target.contentType ?? '').toLowerCase();
    if (ct.includes('cloudflare')) return 'cloudflare';
    if (ct.includes('akamai')) return 'akamai';
    if (ct.includes('aws')) return 'aws-waf';
    if (ct.includes('azure')) return 'azure-waf';
    if (ct.includes('imperva')) return 'imperva';
    return 'unknown';
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
    // writeFinding is the LLM's "I'm done — record a finding" primitive.
    // Heuristic guard: only mark vulnerable if the prior step in the plan
    // was a signal-bearing primitive (evaluateRendered/compareResponses/
    // measureTiming/checkWaf/injectInContext+httpRequest that returned 200).
    if (step.name === 'writeFinding') {
      // If the LLM is calling writeFinding without a strong prior signal,
      // require at least one signal primitive in the same plan's history
      // to have produced a vulnerable=true result.
      const planSteps = plan.primitives;
      const writeIdx = planSteps.findIndex((p) => p.name === step.name);
      const priorSteps = planSteps.slice(0, writeIdx);
      const hasSignalPrior = priorSteps.some((p) =>
        p.name === 'evaluateRendered' || p.name === 'compareResponses' || p.name === 'measureTiming'
      );
      if (!hasSignalPrior) {
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
