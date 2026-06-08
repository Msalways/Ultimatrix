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
  type PrimitiveContext,
  type PrimitiveName,
  type PrimitiveRequest,
  type PrimitiveResponse,
  type PrimitiveResult,
  type InjectionLocation,
  type PayloadType,
} from '../primitives';
import { getGlobalRegistry } from '../plugins/registry';
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

/**
 * Structured event emitted by the Composer at every meaningful lifecycle
 * boundary. The web UI consumes these via `onLog` to render the live agent
 * tree, plan stream, primitive timeline, and finding list.
 */
export type ComposerLogEvent =
  | { type: 'plan-proposed'; technique: string; rationale: string; confidence: number; planId: number }
  | { type: 'plan-start'; planId: number; technique: string; url: string; method: string; primitives: string[] }
  | { type: 'plan-end'; planId: number; technique: string; findings: number; durationMs: number }
  | { type: 'primitive'; planId: number; name: PrimitiveName; outcome: string; durationMs: number; args?: unknown }
  | { type: 'triage'; planId: number; name: PrimitiveName; vulnerable: boolean; confidence: number; severity: string; reasoning?: string }
  | { type: 'specialist-spawn'; specialist: string; reason: string; payload?: unknown }
  | { type: 'specialist-done'; specialist: string; findings: number }
  | { type: 'finding'; id: string; findingType: string; endpoint: string; severity: string; confidence: number; param?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  // New agent-loop events (free-form strings — LLM is the system)
  | { type: 'agent-turn'; turn: number; thought: string; tool: string; ok: boolean; durationMs: number; observations?: string[] }
  | { type: 'sub-agent-spawn'; task: string; tools: string[]; maxAttempts: number; strategy?: string }
  | { type: 'sub-agent-result'; task: string; outcome: string; findings: number; durationMs: number }
  | { type: 'agent-trace'; turns: number; subAgents: number; findings: number; outcome: string; durationMs: number };

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
  /**
   * Optional sink for structured lifecycle events. The web UI consumes
   * these to render plan/primitive/finding/chain panels in real time.
   * Safe to set together with onPrimitive — the two callbacks serve
   * different consumers (UI vs. low-level instrumentation).
   */
  onLog?: (event: ComposerLogEvent) => void;
  /**
   * Optional sink for LLM token streaming. When set AND ULTIMATRIX_LLM_STREAM=1,
   * the Composer will call this for every token (label, chunk). The web UI
   * uses this to forward tokens to the browser over WebSocket.
   */
  onLLMToken?: (label: string, chunk: string) => void;
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

/**
 * Call the LLM. Streams tokens when ULTIMATRIX_LLM_STREAM=1 OR when a
 * token sink is passed in. Label is shown at the start of a streaming
 * session so the user can tell calls apart. With both env and sink set,
 * the sink also receives tokens (env keeps the terminal in sync).
 */
async function llmInvoke(
  llm: LLMClient,
  params: Parameters<LLMClient['call']>[0] & { label?: string },
  tokenSink?: (label: string, chunk: string) => void,
): Promise<LLMCallResult> {
  const { label, ...rest } = params;
  const callWithLabel = { ...rest, label: label ?? '' };
  const envStream = process.env.ULTIMATRIX_LLM_STREAM === '1';
  if (envStream || tokenSink) {
    return llm.stream(callWithLabel, (chunk) => {
      if (envStream) {
        // dimmed gray text so it doesn't drown out the main progress bar
        process.stderr.write(`\x1b[2m${chunk.replace(/\n/g, ' ')}\x1b[0m`);
      }
      tokenSink?.(label ?? '', chunk);
    });
  }
  return llm.call(callWithLabel);
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.pathname.length > 1 ? url.pathname : url.hostname;
  } catch {
    return u.length > 40 ? u.slice(0, 37) + '…' : u;
  }
}

export class Composer {
  private opts: Required<Omit<ComposerOptions, 'onFinding' | 'onSubtask' | 'onPrimitive' | 'onLog' | 'onLLMToken'>> & ComposerOptions;
  private recentFindings: AppModelFinding[] = [];

  constructor(opts: ComposerOptions) {
    this.opts = {
      maxDepth: 2,
      planTimeoutMs: 30_000,
      budgetMs: 15 * 60 * 1000,
      ...opts,
    };
  }

  private emit(event: ComposerLogEvent): void {
    try {
      this.opts.onLog?.(event);
    } catch { /* never let a UI sink break the hunt */ }
  }

  /**
   * Run the composer against a target endpoint. Returns all findings.
   *
   * New behavior: dispatches to the agent loop. The LLM is the loop body,
   * picking one tool call per turn from the 23 available tools (21
   * primitives + spawnAgent + writeFinding). The LLM names findings freely
   * (type, severity, param are all free-form strings). The LLM can spawn
   * sub-agents in parallel with LLM-chosen tool subsets.
   *
   * The legacy plan-based API (`proposePlans`, `executePlan`) is preserved
   * for callers that still use it.
   */
  async run(target: AppModelEndpoint, ctx: PrimitiveContext): Promise<ComposerRunResult> {
    const startedAt = Date.now();
    const findings: AppModelFinding[] = [];
    const subtasks: ComposerRunResult['subtasks'] = [];
    ctx.subtaskSink = subtasks;
    this.recentFindings = findings;

    // Dispatch to the agent loop
    const { runAgentLoop } = await import('./agent-loop');
    const agentResult = await runAgentLoop({
      target: {
        url: target.path,
        method: target.method,
        params: (target.params ?? []).map((p: any) =>
          typeof p === 'string'
            ? { name: p, type: 'string', required: false }
            : { name: p.name ?? String(p), type: p.type ?? 'string', required: !!p.required }
        ),
        bodyPreview: target.bodyPreview ?? '',
        headers: target.authHeaders ?? {},
      },
      ctx,
      llm: this.opts.llm,
      // Block 21: forward the LLM token stream so the web UI / CLI can
      // see the agent's reasoning live. Without this, the LLM stream
      // panel stays empty in the web UI even during real attacks.
      onLLMToken: this.opts.onLLMToken,
      // Forward primitive calls into the v4 event stream. The agent
      // loop never knew about per-primitive visibility before Block 21.
      // The Composer takes a `PrimitiveName` for onPrimitive; the agent
      // loop takes a `string`. Cast so the call site accepts the wider
      // string and the inner callback is still strongly typed.
      onPrimitive: this.opts.onPrimitive as
        | ((name: string, args: unknown, result: { ok: boolean; error?: string; durationMs: number }) => void)
        | undefined,
      onFinding: (f) => {
        findings.push(f);
        this.opts.onFinding?.(f);
        this.emit({
          type: 'finding',
          id: f.id ?? '',
          findingType: f.type,
          endpoint: f.endpoint,
          severity: f.severity,
          confidence: typeof f.confidence === 'number' ? f.confidence : parseFloat(String(f.confidence)) || 0,
          param: f.param,
        });
      },
      onTrace: (trace) => {
        // Emit per-turn and per-sub-agent events for the UI / trace formatter
        for (const t of trace.metaTurns) {
          this.emit({
            type: 'agent-turn',
            turn: t.turnIndex,
            thought: t.thought,
            tool: t.tool,
            ok: !!t.result?.ok,
            durationMs: t.durationMs,
            observations: t.observations,
          });
        }
        for (const s of trace.subAgents) {
          this.emit({
            type: 'sub-agent-spawn',
            task: s.task,
            tools: s.tools,
            maxAttempts: s.maxAttempts,
            strategy: s.strategy,
          });
          this.emit({
            type: 'sub-agent-result',
            task: s.task,
            outcome: s.outcome,
            findings: s.findings.length,
            durationMs: s.durationMs,
          });
          subtasks.push({ specialist: s.task.slice(0, 40), result: s.outcome === 'vulnerable' ? 'done' : 'failed', findings: s.findings.length });
        }
        this.emit({
          type: 'agent-trace',
          turns: trace.metaTurns.length,
          subAgents: trace.subAgents.length,
          findings: trace.findings.length,
          outcome: trace.outcome,
          durationMs: trace.durationMs,
        });
      },
    });

    // Synthesize an empty `plans` array for backward compat. The agent loop
    // doesn't pre-compose plans; the LLM is the system. Tests/code that
    // read plans should migrate to reading the trace.
    const plans: AttackPlan[] = [];

    return {
      findings: agentResult.findings.length > 0 ? agentResult.findings : findings,
      plans,
      durationMs: Date.now() - startedAt,
      llmWasReal: this.opts.llm.isReal(),
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
    const planResult = await llmInvoke(this.opts.llm, {
      system: SYSTEM_PROMPT_PLANNER,
      user: this.formatTargetForPlanner(target) + `\n\nPropose exactly ${count} plans.`,
      temperature: 0.2,
      label: `propose-plans/${shortUrl(target.path)}`,
    }, this.opts.onLLMToken);
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
    const planStart = Date.now();

    this.emit({
      type: 'plan-start',
      planId: plan.id,
      technique: plan.technique,
      url: target.path,
      method: target.method,
      primitives: plan.primitives.map((p) => p.name),
    });

    for (const step of plan.primitives) {
      if (Date.now() - ctx.budget.startedAt > ctx.budget.maxMs) break;

      // Resolve $prev / $target placeholders
      const resolvedArgs = this.resolveArgs(step.args, prev, target);
      const prim = getGlobalRegistry().getPrimitive(step.name);
      if (!prim) continue;

      const stepStart = Date.now();
      let result: PrimitiveResult;
      let stepError: string | undefined;
      try {
        result = await Promise.resolve(prim.execute(resolvedArgs, ctx));
      } catch (e) {
        // A single primitive throwing must not abort the whole plan
        result = { ok: false, value: { error: (e as Error).message }, evidence: [], durationMs: 0 };
        stepError = (e as Error).message;
      }
      const stepDuration = Date.now() - stepStart;
      this.opts.onPrimitive?.(step.name, resolvedArgs, result);
      this.emit({
        type: 'primitive',
        planId: plan.id,
        name: step.name,
        outcome: stepError ? `error: ${stepError}` : (result.ok ? 'ok' : 'failed'),
        durationMs: stepDuration,
        args: resolvedArgs,
      });

      // If the primitive signaled a spawn, handle it by calling the specialist composer
      if (result.spawn) {
        this.opts.onSubtask?.(result.spawn.specialist, result.spawn.reason);
        this.emit({
          type: 'specialist-spawn',
          specialist: result.spawn.specialist,
          reason: result.spawn.reason,
          payload: result.spawn.payload,
        });
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
              this.emit({
                type: 'finding',
                id: f.id ?? '',
                findingType: f.type,
                endpoint: f.endpoint,
                severity: f.severity,
                confidence: typeof f.confidence === 'number' ? f.confidence : parseFloat(String(f.confidence)) || 0,
                param: f.param,
              });
              ctx.subtaskSink.push({ specialist: result.spawn.specialist, result: 'done', findings: 1 });
            }
            if (subtaskFindings.length === 0) {
              ctx.subtaskSink.push({ specialist: result.spawn.specialist, result: 'done', findings: 0 });
            }
            this.emit({
              type: 'specialist-done',
              specialist: result.spawn.specialist,
              findings: subtaskFindings.length,
            });
          } catch (err) {
            this.emit({
              type: 'specialist-done',
              specialist: result.spawn.specialist,
              findings: -1,
            });
            ctx.subtaskSink.push({ specialist: result.spawn.specialist, result: 'failed', findings: 0 });
          }
        }
      }

      // Triage the result
      const triage = await this.triage(plan, step, result, target);
      this.emit({
        type: 'triage',
        planId: plan.id,
        name: step.name,
        vulnerable: triage.vulnerable,
        confidence: triage.confidence,
        severity: triage.severity,
      });
      if (triage.vulnerable && triage.confidence > 0.5) {
        // Build a finding from the accumulated evidence
        const finding = this.buildFinding(plan, step, result, triage, target, ctx);
        if (finding) {
          planFindings.push(finding);
          this.emit({
            type: 'finding',
            id: finding.id ?? '',
            findingType: finding.type,
            endpoint: finding.endpoint,
            severity: finding.severity,
            confidence: typeof finding.confidence === 'number' ? finding.confidence : parseFloat(String(finding.confidence)) || 0,
            param: finding.param,
          });
          // Clear evidence log so the next finding starts fresh
          ctx.evidenceLog.length = 0;
        }
      }

      prev = result;
    }

    this.emit({
      type: 'plan-end',
      planId: plan.id,
      technique: plan.technique,
      findings: planFindings.length,
      durationMs: Date.now() - planStart,
    });

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
      const t = await llmInvoke(this.opts.llm, {
        system: SYSTEM_PROMPT_TRIAGE,
        user: `Plan: ${plan.technique} (${plan.rationale})\nStep: ${step.name}\nResult: ${JSON.stringify(result.value ?? null).slice(0, 1000)}\n\nTriage this.`,
        temperature: 0.1,
        label: `triage/${plan.technique}`,
      }, this.opts.onLLMToken);
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
