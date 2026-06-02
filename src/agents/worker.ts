/**
 * src/agents/worker.ts
 *
 * Deepagents-based reasoning worker (replaces src/core/worker-agent.ts).
 *
 * Design decisions
 * ────────────────
 * 1. Runs IN-PROCESS (not in a worker_thread) — deepagents manages the
 *    inner LLM/tool loop via LangGraph, so we get streaming, checkpointing,
 *    and sub-agent delegation for free.
 *
 * 2. Three-level nesting:
 *      Strategist (autonomous-v2)
 *        └─ Worker (this file)        ← CompiledSubAgent
 *             └─ Specialist sub-agents (14 + general-purpose)
 *
 *    The strategist passes the worker as a CompiledSubAgent. The worker
 *    exposes its 14 specialists as SubAgent specs so deepagents wires the
 *    `task()` delegation tool.
 *
 * 3. FilesystemBackend is rooted at the per-worker scratch dir under
 *    `<appModelPath>/.workers/<hypothesisId>/` so multiple workers can
 *    reason in parallel without colliding on the scratchpad file.
 *
 * 4. SqliteSaver is not installed in package.json — we use MemorySaver
 *    here for the skeleton. Swap to SqliteSaver (from
 *    `@langchain/langgraph-checkpoint-sqlite`) in production:
 *
 *      import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
 *      const checkpointer = SqliteSaver.fromConnString(checkpointPath);
 *
 * 5. Returned WorkerResult is structurally compatible with the existing
 *    `spawn_agent` tool contract in src/tools/tool-registry.ts.
 */

import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import {
  modelCallLimitMiddleware,
  toolCallLimitMiddleware,
  createMiddleware,
  type InterruptOnConfig,
} from 'langchain';
import {
  createDeepAgent,
  type SubAgent,
  type CompiledSubAgent,
  type DeepAgent,
  FilesystemBackend,
  StateBackend,
  CompositeBackend,
  type AnyBackendProtocol,
} from 'deepagents';

import { providerRegistry } from '../providers/provider-registry';
import { setAppModelPath } from '../core/app-model-path';
import { readAppModel, updateAppModelSection, type AppModelFinding, type FindingEvidence } from '../core/app-model';
import type { Hypothesis, Technique } from '../core/attack-plan';
import { fixWriteTodosMiddleware } from '../core/fix-todos';
import type { SessionPool } from '../core/session-pool';
import { buildSessionTools } from '../tools/pool-tools';

// ── Public types — re-exported for spawn_agent compatibility ──────────

export interface WorkerConfig {
  hypothesis: Hypothesis;
  llmConfig: { provider: string; apiKey: string; model: string };
  appModelPath: string;
  oastBaseUrl?: string;
  budget?: number;
  timeoutMs?: number;
  storageStatePath?: string;
  loginEndpoint?: string;
  loginMethod?: string;
  loginFields?: string[];
  abortSignal?: AbortSignal;
  threadId?: string;
  resumeFromCheckpoint?: boolean;
  sessionPool?: SessionPool;
  activeSessionId?: string;
}

export interface WorkerAttempt {
  hypothesisId: string;
  technique: string;
  attempt: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  payload: string;
  status: number;
  responseBodySnippet: string;
  timingMs: number;
  vulnerable: boolean;
  evidence: FindingEvidence[];
  analysis: string;
  timestamp: number;
}

export interface WorkerResult {
  hypothesisId: string;
  vulnerable: boolean;
  technique: string;
  confidence: number;
  evidence: FindingEvidence[];
  payloads: string[];
  summary: string;
  error?: string;
  attempts: WorkerAttempt[];
  threadId: string;
}

// ── Tunables ──────────────────────────────────────────────────────────

const DEFAULT_TURNS = 10;
const DEFAULT_TIMEOUT_MS = 180_000;
const MODEL_CALL_LIMIT_PER_TURN = 4;
const TOOL_CALL_LIMIT_TOTAL = 20;

/** Normalize a Hypothesis (param or form variant) into the fields the worker uses. */
function hypFields(h: Hypothesis): { url: string; param: string; method: string } {
  if (h.type === 'form') return { url: h.action, param: h.fields[0] || '', method: h.method };
  return { url: h.endpoint, param: h.param || '', method: h.method };
}

// ── System prompt ─────────────────────────────────────────────────────

const WORKER_SYSTEM_PROMPT = `You are a security reasoning worker. Your job is to test a single vulnerability hypothesis against a single endpoint parameter.

=== Available tools ===
- http_request: send an HTTP request with method/url/headers/body
- observe_response: structured view of the last response (status, headers, body excerpt)
- scratchpad_write / scratchpad_read: persist your reasoning across turns
- conclude: emit a final structured WorkerResult JSON
- task(name="<specialist>"): delegate to a specialist sub-agent for focused analysis
- list_sessions: enumerate available browser/auth sessions
- switch_session: make a named session the active one for subsequent requests
- login_session: authenticate a session by POSTing creds to a login endpoint
- diff_sessions: send the same request as two different sessions and compare responses (for IDOR / RBAC testing)
- screenshot_session: capture a screenshot of the current page in a session
- get_page_text: read the rendered DOM text of the current page (for on-screen hints the agent must read)

=== Loop ===
1. Read the hypothesis (given in the first human message)
2. Send an initial baseline request with observe_response to learn normal behavior
3. For each turn, craft ONE test input based on previous evidence
4. After each request, analyze the response carefully — quote exact evidence
5. Use specialists when needed (e.g. payload-crafter for tricky encodings)
6. For RBAC-sensitive techniques (idor, broken function-level auth): use diff_sessions to compare the same URL as different users
7. For SPA / dynamic apps: use get_page_text to read on-screen hints, then use screenshot_session to capture rendered DOM
8. Call conclude() when:
   (a) you have HIGH-CONFIDENCE evidence of a vulnerability, OR
   (b) you have exhausted meaningful variations, OR
   (c) 4+ responses show no behavioral change vs. baseline

=== Style rules ===
- Never use the words "exploit", "attack", "payload", "injection", or "malicious". Use "test input", "test string", "security test".
- Quote response body text verbatim as evidence — never paraphrase.
- For session-attributed evidence, name the session (e.g. "user-a sees: ...; user-b sees: ...").
- Be honest. If evidence is weak, set vulnerable=false. False positives waste triage time.`;

const WORKER_INITIAL_HUMAN = (h: Hypothesis) => `Test this hypothesis:

${JSON.stringify(h, null, 2)}

${h.technique === 'ssrf' || h.technique === 'xxe' || h.technique === 'open-redirect'
  ? `An OAST callback URL is available. Use http_request with a payload that embeds the OAST URL, then call oast_check to verify.`
  : ''}

Start with a baseline http_request, then reason about the response.`;

// ── Worker tools (payload-in, response-out) ───────────────────────────

const httpRequestTool = tool(
  async (input) => {
    const { url, method, headers, body, bodyType } = input;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 30_000);
    try {
      const reqHeaders: Record<string, string> = { ...(headers || {}) };
      let reqBody: string | undefined = body;
      if (method !== 'GET' && method !== 'HEAD' && body) {
        if (bodyType === 'xml') reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/xml';
        else if (bodyType === 'json') reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
        else reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/x-www-form-urlencoded';
      } else if (method !== 'GET' && method !== 'HEAD') {
        reqBody = undefined;
      }
      const start = Date.now();
      const resp = await fetch(url, { method, headers: reqHeaders, body: reqBody, signal: controller.signal });
      const text = await resp.text();
      const respHeaders: Record<string, string> = {};
      resp.headers.forEach((v: string, k: string) => { respHeaders[k] = v; });
      return JSON.stringify({
        status: resp.status,
        headers: respHeaders,
        body: text.slice(0, 8000),
        bodyLength: text.length,
        timingMs: Date.now() - start,
        requestUrl: url,
        requestMethod: method,
      });
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      clearTimeout(t);
    }
  },
  {
    name: 'http_request',
    description: 'Send an HTTP request. Returns status, headers, body excerpt, and timing.',
    schema: z.object({
      url: z.string().describe('Full URL (param must be in the URL or in the body)'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']).default('GET'),
      headers: z.record(z.string()).optional(),
      body: z.string().optional(),
      bodyType: z.enum(['form', 'json', 'xml']).optional(),
    }),
  },
);

const observeResponseTool = tool(
  async () => {
    return JSON.stringify({ note: 'Use scratchpad_read on /scratchpad/last_response.json to view the most recent response' });
  },
  {
    name: 'observe_response',
    description: 'Reminder that recent responses are stored in /scratchpad/last_response.json',
    schema: z.object({}),
  },
);

const scratchpadWriteTool = tool(
  async (input) => {
    const { path: p, content } = input;
    const fullPath = path.join(process.env.WORKER_SCRATCH_DIR || '.', p);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    return JSON.stringify({ wrote: p, bytes: content.length });
  },
  {
    name: 'scratchpad_write',
    description: 'Persist a note to the scratchpad (persists across turns via FilesystemBackend).',
    schema: z.object({
      path: z.string().describe('Virtual path, e.g. /notes/turn-1.md'),
      content: z.string(),
    }),
  },
);

const scratchpadReadTool = tool(
  async (input) => {
    const { path: p } = input;
    const fullPath = path.join(process.env.WORKER_SCRATCH_DIR || '.', p);
    if (!fs.existsSync(fullPath)) return JSON.stringify({ error: 'not found', path: p });
    return fs.readFileSync(fullPath, 'utf-8');
  },
  {
    name: 'scratchpad_read',
    description: 'Read a note from the scratchpad.',
    schema: z.object({ path: z.string() }),
  },
);

const concludeTool = tool(
  async (input) => {
    const fullPath = path.join(process.env.WORKER_SCRATCH_DIR || '.', 'conclusion.json');
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const enriched = {
      ...input,
      evidence: (input.evidence || []).map((e: any) =>
        typeof e === 'string'
          ? { type: 'text' as const, data: e, label: 'worker-evidence', timestamp: Date.now() }
          : { type: e.type || 'text', data: e.data || '', label: e.label || 'worker-evidence', timestamp: e.timestamp || Date.now() },
      ),
    };
    fs.writeFileSync(fullPath, JSON.stringify(enriched, null, 2));
    return JSON.stringify({ concluded: true, vulnerable: enriched.vulnerable, confidence: enriched.confidence });
  },
  {
    name: 'conclude',
    description: 'Emit the final structured result. Call this EXACTLY ONCE when done.',
    schema: z.object({
      vulnerable: z.boolean(),
      confidence: z.number().min(0).max(1),
      technique: z.string(),
      evidence: z.array(z.union([z.string(), z.object({
        type: z.enum(['text', 'screenshot', 'har_entry', 'raw_request', 'raw_response']),
        data: z.string(),
        label: z.string(),
        timestamp: z.number().optional(),
      })])).describe('Verbatim evidence — strings become text snippets; objects carry {type, data, label, timestamp} per FindingEvidence.'),
      payloads: z.array(z.string()).describe('All test strings used, in order'),
      summary: z.string().describe('One-paragraph summary of what was tested and what was found'),
    }),
  },
);

// ── Termination middleware ────────────────────────────────────────────

const workerTerminationMiddleware = createMiddleware({
  name: 'workerTermination',
  afterModel: (state: any) => {
    const messages = state.messages || [];
    const last = messages[messages.length - 1];
    if (last?.tool_calls?.some((tc: any) => tc.name === 'conclude')) {
      return { workerConcluded: true } as any;
    }
    return undefined;
  },
});

// ── 14 specialist sub-agents (stubs) ─────────────────────────────────

const SPECIALIST_DEFS: Array<Pick<SubAgent, 'name' | 'description' | 'systemPrompt'>> = [
  { name: 'sqli-specialist', description: 'Deep SQL injection technique: UNION, blind, time-based, error-based, OOB.', systemPrompt: 'You are a SQL injection specialist. Analyze parameters and craft test strings that probe for SQL parsing errors, UNION-based extraction, and time-based blind injection. Output concrete test inputs with the exact SQL fragment to use.' },
  { name: 'xss-specialist', description: 'XSS in HTML, attribute, JS, URL, and DOM contexts. Stored vs reflected.', systemPrompt: 'You are an XSS specialist. Identify context (HTML body, attribute, JS string, URL) and craft context-appropriate test strings. Distinguish stored (re-fetched) from reflected.' },
  { name: 'ssrf-specialist', description: 'Server-side request forgery: internal IPs, cloud metadata, OAST callbacks.', systemPrompt: 'You are a SSRF specialist. Identify parameters that take URLs/IPs/hostnames. Test with internal addresses (127.0.0.1, 169.254.169.254, [::1]), and OAST URLs for blind cases.' },
  { name: 'xxe-specialist', description: 'XML external entity injection: file read, SSRF-via-XXE, OOB via DTD.', systemPrompt: 'You are an XXE specialist. Craft XML bodies with SYSTEM entities pointing to local files or OAST URLs. Include the full XML document.' },
  { name: 'cmdi-specialist', description: 'OS command injection: shell metacharacters, separators, blind via timing.', systemPrompt: 'You are a command injection specialist. Probe for shell evaluation with | ; ` $() and timing-based blind techniques.' },
  { name: 'path-specialist', description: 'Path traversal: ../ sequences, encoded variants, null-byte truncation.', systemPrompt: 'You are a path traversal specialist. Test for file inclusion via ../, %2e%2e%2f, and absolute paths.' },
  { name: 'ssti-specialist', description: 'Server-side template injection: Jinja, Twig, Freemarker, Smarty.', systemPrompt: 'You are a SSTI specialist. Test with engine-specific markers: {{7*7}}, ${7*7}, <%= 7*7 %> and observe computed output.' },
  { name: 'open-redirect-specialist', description: 'Open redirect via Location header manipulation.', systemPrompt: 'You are an open redirect specialist. Test with absolute external URLs, protocol-relative //, and backslash variants. Verify via Location response header.' },
  { name: 'idor-specialist', description: 'Insecure direct object reference: cross-user ID enumeration via session diff.', systemPrompt: `You are an IDOR specialist. Your job is to determine if a web endpoint enforces authorization on object access by comparing the same resource fetched as different users.

## How to use session tools
1. ALWAYS start with list_sessions to see what sessions are available (user-a, user-b, admin, etc.)
2. If only one session exists, use login_session to create a second authenticated session
3. Use diff_sessions to fetch the same URL as two different sessions — it returns a leakDetected boolean
4. Use screenshot_session to capture rendered DOM if the response is HTML

## Approach
- diff_sessions is the primary tool. If diff returns leakDetected=true with status match and body diff, IDOR is likely.
- Enumerate neighbor IDs (e.g. /api/v1/vehicles/1, /2, /3) and diff each — same status with different bodies means endpoint is leaking.
- For path-style IDs (/users/123, /orders/456), change only the ID in the URL.
- For query-style IDs (?id=1, ?userId=2), include them in the request body or query string.
- A 200 response with structured body containing another user's data is stronger evidence than just a status code.

## Output (call conclude when done)
- leakDetected: true/false
- confidence: 0-1
- evidence: list of verbatim response fragments from each session, labeled with session name
- summary: one paragraph explaining what was found` },
  { name: 'race-specialist', description: 'Race conditions in state-changing endpoints.', systemPrompt: 'You are a race condition specialist. Identify state-changing endpoints and design concurrent request patterns to exploit TOCTOU windows.' },
  { name: 'auth-bypass-specialist', description: 'Broken authentication: JWT alg=none, role escalation, missing signature validation.', systemPrompt: `You are an auth-bypass specialist. Test JWT alg=none, missing signature validation, role escalation in tokens, and session fixation.

## How to use session tools
1. list_sessions to see what authenticated sessions are available
2. switch_session to change which session is making the request
3. diff_sessions to compare what different roles see
4. login_session to capture a fresh JWT or cookie as a different user
5. screenshot_session to capture DOM if the response is HTML

## Approach
- Capture a JWT or session token from one user via login_session
- Decode the payload (base64). Look for "role", "admin", "user_id", "sub", "exp" claims.
- Modify role to "admin" / "superuser", re-sign or use alg=none
- Replay as the same session — if the endpoint trusts the modified claim, the bypass works
- Compare with diff_sessions between the original user and admin: a 200 vs 403 with admin seeing admin-only data is the auth-bypass pattern.

## Output (call conclude when done)
- vulnerability: alg-none|alg-confusion|weak-secret|role-escalation|missing-sig|expiry-bypass|none
- confidence: 0-1
- evidence: verbatim token fragments, response status/body
- summary: one paragraph` },
  { name: 'deserialization-specialist', description: 'Insecure deserialization: PHP, Java, Python pickle, Node.js.', systemPrompt: 'You are a deserialization specialist. Test with platform-appropriate gadget chains and base64-encoded payloads.' },
  { name: 'cors-specialist', description: 'CORS misconfiguration: origin reflection, null origin, credentials.', systemPrompt: 'You are a CORS specialist. Test with various Origin headers and verify Access-Control-Allow-* response headers.' },
  { name: 'header-injection-specialist', description: 'CRLF injection, header smuggling, response splitting.', systemPrompt: 'You are a header injection specialist. Test for CRLF sequences in reflected headers and request smuggling via conflicting Content-Length / Transfer-Encoding.' },
];

function buildSpecialists(sessionToolMap?: Record<string, any>): SubAgent[] {
  return SPECIALIST_DEFS.map((s) => {
    const sessionTools = sessionToolMap?.[s.name] ?? [];
    return {
      name: s.name,
      description: s.description,
      systemPrompt: s.systemPrompt,
      tools: sessionTools,
    };
  });
}

// ── Custom color-streaming middleware ─────────────────────────────────

const colorStreamMiddleware = createMiddleware({
  name: 'colorStream',
  wrapModelCall: async (request: any, handler: any) => {
    const msgs = request.messages?.length || 0;
    process.stderr.write(`\n  ⚙ worker LLM call (msgs=${msgs})\n`);
    return handler(request);
  },
});

// ── Build the deepagent worker ────────────────────────────────────────

export async function buildReasoningWorker(
  config: WorkerConfig,
): Promise<DeepAgent> {
  setAppModelPath(config.appModelPath);

  const model = await providerRegistry.create(config.llmConfig.provider as any, {
    apiKey: config.llmConfig.apiKey,
    modelId: config.llmConfig.model,
  });

  const scratchDir = path.join(path.dirname(config.appModelPath), '.workers', config.hypothesis.id);
  fs.mkdirSync(scratchDir, { recursive: true });
  process.env.WORKER_SCRATCH_DIR = scratchDir;

  // Composite backend: state for ephemeral conversation files, filesystem
  // for persistent scratchpad (deepagents requires StateBackend for
  // in-conversation files; FilesystemBackend gives cross-conversation
  // persistence on disk).
  const backend: AnyBackendProtocol = new CompositeBackend(
    new StateBackend(),
    {
      '/scratchpad': new FilesystemBackend({ rootDir: scratchDir }),
    },
  );

  // Checkpointer — swap to SqliteSaver.fromConnString(...) in production
  const checkpointer = new MemorySaver();

  // Per-worker interrupt config — auto-continue everything (the LLM is
  // the decision maker; no human-in-the-loop here).
  const interruptOn: Record<string, boolean | InterruptOnConfig> = {
    conclude: false,
  };

  return createDeepAgent({
    model,
    tools: (() => {
      const baseTools = [httpRequestTool, observeResponseTool, scratchpadWriteTool, scratchpadReadTool, concludeTool];
      if (config.sessionPool) {
        const activeId = config.activeSessionId ?? null;
        const sessionTools = buildSessionTools({
          pool: config.sessionPool,
          getActiveSessionId: () => activeId,
          setActiveSessionId: () => { /* tracked externally */ },
          getPage: async (id) => config.sessionPool!.getPage(id),
        });
        return [...baseTools, sessionTools.listSessions, sessionTools.switchSession, sessionTools.loginSession, sessionTools.diffSessions, sessionTools.screenshotSession, sessionTools.getPageText];
      }
      return baseTools;
    })(),
    systemPrompt: WORKER_SYSTEM_PROMPT,
    subagents: [...buildSpecialists((() => {
      if (!config.sessionPool) return undefined;
      const activeId = config.activeSessionId ?? null;
      const sessionTools = buildSessionTools({
        pool: config.sessionPool,
        getActiveSessionId: () => activeId,
        setActiveSessionId: () => { /* tracked externally */ },
        getPage: async (id) => config.sessionPool!.getPage(id),
      });
      const sessionToolSet = [sessionTools.listSessions, sessionTools.switchSession, sessionTools.loginSession, sessionTools.diffSessions, sessionTools.screenshotSession, sessionTools.getPageText, scratchpadWriteTool, scratchpadReadTool];
      return {
        'idor-specialist': sessionToolSet,
        'auth-bypass-specialist': sessionToolSet,
      };
    })())],
    backend,
    checkpointer,
    interruptOn,
    name: `worker-${config.hypothesis.id}`,
    middleware: [
      fixWriteTodosMiddleware,
      modelCallLimitMiddleware({
        threadLimit: MODEL_CALL_LIMIT_PER_TURN,
        runLimit: MODEL_CALL_LIMIT_PER_TURN,
        exitBehavior: 'end',
      }),
      toolCallLimitMiddleware({
        threadLimit: TOOL_CALL_LIMIT_TOTAL,
        runLimit: TOOL_CALL_LIMIT_TOTAL,
        exitBehavior: 'end',
      }),
      colorStreamMiddleware,
      workerTerminationMiddleware,
    ],
  });
}

// ── Public entry point ────────────────────────────────────────────────

export async function runReasoningWorker(config: WorkerConfig): Promise<WorkerResult> {
  const threadId = config.threadId || `worker-${config.hypothesis.id}-${randomUUID()}`;
  const turns = DEFAULT_TURNS;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fields = hypFields(config.hypothesis);

  const result: WorkerResult = {
    hypothesisId: config.hypothesis.id,
    vulnerable: false,
    technique: config.hypothesis.technique,
    confidence: 0,
    evidence: [],
    payloads: [],
    summary: `Worker started for ${config.hypothesis.technique} on ${fields.url}`,
    attempts: [],
    threadId,
  };

  const abortController = new AbortController();
  if (config.abortSignal) {
    config.abortSignal.addEventListener('abort', () => abortController.abort(), { once: true });
  }
  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const agent = await buildReasoningWorker(config);

    const resumed = config.resumeFromCheckpoint ?? (await hasExistingCheckpoint(agent, threadId));

    if (!resumed) {
      await agent.invoke(
        { messages: [{ role: 'human', content: WORKER_INITIAL_HUMAN(config.hypothesis) }] },
        {
          configurable: { thread_id: threadId },
          signal: abortController.signal,
        },
      );
    }

    for (let turn = 0; turn < turns; turn++) {
      if (abortController.signal.aborted) {
        result.summary = `Worker aborted: ${abortController.signal.reason || 'timeout'}`;
        result.error = 'aborted';
        break;
      }
      if (await hasConcluded(agent, threadId)) break;

      try {
        await agent.invoke(
          { messages: [{ role: 'human', content: 'Continue.' }] },
          { configurable: { thread_id: threadId }, signal: abortController.signal },
        );
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
        result.summary = `Worker error: ${result.error}`;
        break;
      }

      persistTurnTrace(config.appModelPath, config.hypothesis.id, turn);
    }

    const conclusionPath = path.join(process.env.WORKER_SCRATCH_DIR || '', 'conclusion.json');
    if (fs.existsSync(conclusionPath)) {
      const c = JSON.parse(fs.readFileSync(conclusionPath, 'utf-8'));
      result.vulnerable = !!c.vulnerable;
      result.confidence = c.confidence || 0;
      result.evidence = c.evidence || [];
      result.payloads = c.payloads || [];
      result.summary = c.summary || result.summary;
    } else {
      result.summary = `Worker completed ${turns} turns without calling conclude()`;
    }

    const workerActions = result.payloads.map((payload, i) => ({
      hypothesisId: config.hypothesis.id,
      technique: config.hypothesis.technique,
      attempt: i + 1,
      url: fields.url,
      method: fields.method,
      headers: {},
      body: undefined,
      payload,
      status: 0,
      responseBodySnippet: '',
      timingMs: 0,
      vulnerable: result.vulnerable,
      evidence: result.evidence,
      analysis: result.summary,
      timestamp: Date.now(),
    }));
    if (workerActions.length > 0) {
      updateAppModelSection(config.appModelPath, 'workerActions', workerActions);
    }

    if (result.vulnerable && result.confidence >= 0.5) {
      const finding: AppModelFinding = {
        type: config.hypothesis.technique.toUpperCase(),
        endpoint: fields.url,
        param: fields.param,
        evidence: result.evidence,
        confidence: result.confidence >= 0.8 ? 'high' : result.confidence >= 0.5 ? 'medium' : 'low',
        confirmed: true,
        severity: result.confidence >= 0.8 ? 'high' : result.confidence >= 0.5 ? 'medium' : 'low',
      };
      updateAppModelSection(config.appModelPath, 'findings', [finding]);
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    result.summary = `Worker fatal: ${result.error}`;
  } finally {
    clearTimeout(timer);
    delete process.env.WORKER_SCRATCH_DIR;
  }

  return result;
}

// ── Checkpoint / conclusion helpers ───────────────────────────────────

async function hasExistingCheckpoint(agent: DeepAgent, threadId: string): Promise<boolean> {
  try {
    const state = await (agent as any).getState({ configurable: { thread_id: threadId } });
    return !!(state && state.values && (state.values as any).messages);
  } catch {
    return false;
  }
}

async function hasConcluded(agent: DeepAgent, threadId: string): Promise<boolean> {
  try {
    const state = await (agent as any).getState({ configurable: { thread_id: threadId } });
    const messages = (state?.values as any)?.messages || [];
    return messages.some((m: any) => m.tool_calls?.some((tc: any) => tc.name === 'conclude'));
  } catch {
    return false;
  }
}

function persistTurnTrace(appModelPath: string, hypothesisId: string, turn: number): void {
  try {
    const model = readAppModel(appModelPath);
    const trace = (model as any).workerTraces || [];
    trace.push({ hypothesisId, turn, timestamp: Date.now() });
    updateAppModelSection(appModelPath, 'nextSteps', [`worker-trace ${hypothesisId} turn ${turn}`]);
  } catch { /* best effort */ }
}

// ── Expose the worker as a CompiledSubAgent for the strategist ────────

export async function buildWorkerAsCompiledSubAgent(
  config: WorkerConfig,
): Promise<CompiledSubAgent> {
  const agent = await buildReasoningWorker(config);
  const fields = hypFields(config.hypothesis);
  return {
    name: `worker-${config.hypothesis.id}`,
    description: `Reasoning worker for ${config.hypothesis.technique} on ${fields.url}. Returns vulnerable/confidence/evidence.`,
    runnable: agent as any,
  };
}
