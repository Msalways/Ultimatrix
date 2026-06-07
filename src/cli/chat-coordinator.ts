// src/cli/chat-coordinator.ts
//
// The chat-first interface for the interactive hunt session. Free-form
// text typed by the user is sent to the LLM with the current hunt
// context. The LLM returns:
//
//   { text: "<natural language reply>", plan: [<ChatAction>, ...] }
//
// The session EXECUTES the plan in order. For each action, the session
// runs the underlying browser/coordinator call. If the action returns
// observations (e.g. the list of interactive elements, attack
// findings), the session sends those observations BACK to the LLM in a
// follow-up turn so the LLM can summarise the results in a final,
// user-friendly reply.
//
// Two LLM turns per chat message, max:
//   turn 1: "what should I do?" — LLM returns {text, plan}
//   execute: session runs the plan
//   turn 2: "here are the results: {observations}" — LLM returns final {text}
//   display: only the final text is shown to the user
//
// This prevents the LLM from narrating "I'll do X" without actually
// doing it. The user always sees the actual results, not a promise.

import type { LLMClient } from '../llm/client';
import type { AppModel, AppModelEndpoint, AppModelFinding } from '../core/app-model';
import type { MacroStep } from '../core/browser-session';

/** A form field extracted from the current page. */
export interface ChatFormField {
  name: string;
  type: string;
  placeholder?: string;
  required?: boolean;
  value?: string;
}

/** A form detected on the current page. */
export interface ChatForm {
  index: number;
  action: string;
  method: string;
  fields: ChatFormField[];
}

/** Interactive element on the current page (button, link, input, etc.). */
export interface ChatInteractiveElement {
  kind: 'button' | 'link' | 'input' | 'clickable';
  selector: string;
  text?: string;
  href?: string;
  type?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  role?: string;
}

/** A single observation produced by executing an action. */
export interface ChatObservation {
  /** Which action produced this observation. */
  action: 'attack' | 'go' | 'click' | 'type' | 'fillForm' | 'scanInteractive' | 'scanForms' | 'extractLinks' | 'extractText' | 'screenshot' | 'findings' | 'status' | 'noop';
  /** Human-readable description of what happened. */
  summary: string;
  /** Optional structured data (truncated to keep context small). */
  data?: unknown;
}

/**
 * Condensed spider/recon snapshot the chat LLM can see. Built from
 * `app-model.json` by `summarizeSpider()` so the chat agent knows what
 * the spider has already discovered (endpoints, forms, auth, tech stack)
 * and can pick targets intelligently. The summary is intentionally
 * small (~30 lines of text) to avoid blowing the context window.
 */
export interface ChatSpiderSummary {
  /** Total endpoints discovered (full count, not capped). */
  endpointCount: number;
  /** Total forms discovered. */
  formCount: number;
  /** Total <script> tags observed. */
  scriptCount: number;
  /** Number of OOB callbacks captured during the hunt. */
  oastCallbackCount: number;
  /** Auth type detected by the recon phase. */
  authType: string;
  /** Login endpoint path (if any). */
  loginEndpoint: string;
  /** Detected tech stack (e.g. ["react", "express", "jwt"]). */
  techStack: string[];
  /** Capped list of endpoints the LLM can pick from, sorted by param count desc. */
  endpoints: Array<{ method: string; path: string; paramCount: number; requiresAuth: boolean; bodyFormat?: string }>;
  /** Total count of endpoints (might exceed endpoints.length if capped). */
  totalEndpointCount: number;
  /** Capped list of recently visited URLs. */
  visitedUrls: string[];
  /** Up to 5 next-step hints from the recon phase. */
  nextSteps: string[];
}

/** Build a ChatSpiderSummary from an AppModel. Pure / testable. */
export function summarizeSpider(appModel: AppModel, opts: { endpointCap?: number; visitedCap?: number; nextStepsCap?: number } = {}): ChatSpiderSummary {
  const endpointCap = opts.endpointCap ?? 20;
  const visitedCap = opts.visitedCap ?? 10;
  const nextStepsCap = opts.nextStepsCap ?? 5;

  // Sort endpoints by param count desc so the LLM sees the most
  // interesting attack surfaces first.
  const sortedEndpoints = appModel.endpoints.slice().sort((a, b) => b.params.length - a.params.length);
  const endpoints = sortedEndpoints.slice(0, endpointCap).map((e: AppModelEndpoint) => ({
    method: e.method,
    path: e.path,
    paramCount: e.params.length,
    requiresAuth: e.requiresAuth,
    bodyFormat: e.bodyFormat,
  }));

  return {
    endpointCount: appModel.endpoints.length,
    formCount: appModel.forms.length,
    scriptCount: appModel.scripts.length,
    oastCallbackCount: appModel.oastCallbacks.length,
    authType: appModel.auth?.type ?? 'unknown',
    loginEndpoint: appModel.auth?.loginEndpoint ?? '',
    techStack: appModel.techStack.slice(0, 10),
    endpoints,
    totalEndpointCount: appModel.endpoints.length,
    visitedUrls: appModel.visitedUrls.slice(-visitedCap),
    nextSteps: (appModel.nextSteps ?? []).slice(0, nextStepsCap),
  };
}

/** Format a spider summary as a string section for the chat LLM prompt. */
export function formatSpiderSection(s: ChatSpiderSummary): string {
  const lines: string[] = [];
  lines.push(`\nSpider summary:`);
  const authBit = s.authType && s.authType !== 'unknown' ? s.authType : 'no auth detected';
  const loginBit = s.loginEndpoint ? ` (login: ${s.loginEndpoint})` : '';
  lines.push(`  target tech: ${s.techStack.length > 0 ? s.techStack.join(', ') : 'unknown'}; auth: ${authBit}${loginBit}`);
  lines.push(`  discovered: ${s.endpointCount} endpoint${s.endpointCount === 1 ? '' : 's'}, ${s.formCount} form${s.formCount === 1 ? '' : 's'}, ${s.scriptCount} script${s.scriptCount === 1 ? '' : 's'}, ${s.oastCallbackCount} OOB callback${s.oastCallbackCount === 1 ? '' : 's'}`);
  if (s.endpoints.length > 0) {
    lines.push(`  top endpoints (${s.endpoints.length} of ${s.totalEndpointCount}, sorted by param count):`);
    for (const e of s.endpoints) {
      const auth = e.requiresAuth ? ' [auth]' : '';
      const body = e.bodyFormat ? ` <${e.bodyFormat}>` : '';
      const params = e.paramCount > 0 ? ` (${e.paramCount} param${e.paramCount === 1 ? '' : 's'})` : '';
      lines.push(`    - ${e.method.padEnd(6)} ${e.path}${auth}${body}${params}`);
    }
  }
  if (s.visitedUrls.length > 0) {
    lines.push(`  recently visited (${s.visitedUrls.length}):`);
    for (const u of s.visitedUrls) lines.push(`    - ${u}`);
  }
  if (s.nextSteps.length > 0) {
    lines.push(`  recon's next-step suggestions:`);
    for (const step of s.nextSteps) lines.push(`    - ${step}`);
  }
  return lines.join('\n');
}

/** Context the chat LLM has access to. */
export interface ChatContext {
  target: string;
  currentUrl: string;
  findings: AppModelFinding[];
  recording: MacroStep[];
  formsOnPage: ChatForm[];
  /** Sliding window of last N user/assistant message pairs. */
  history: ChatMessage[];
  /** Whether form auto-test is enabled. */
  autotest: boolean;
  /** If this chat turn is itself a form auto-test trigger, the form
   *  that triggered it (so the LLM knows what to act on). */
  triggerForm?: ChatForm;
  /** Observations from actions just executed (only present on the
   *  follow-up summary turn). */
  observations?: ChatObservation[];
  /** Optional spider/recon summary. When present, the chat prompt
   *  includes a "Spider summary:" section so the LLM knows what the
   *  spider has discovered. Populated by summarizeSpider(). */
  spider?: ChatSpiderSummary;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

/** A single action the session will execute. The session handles
 *  dispatching each kind to the right coordinator. */
export type ChatAction =
  | { kind: 'attack'; url: string; technique?: string; reason?: string }
  | { kind: 'go'; url: string; reason?: string }
  | { kind: 'click'; selector: string; reason?: string }
  | { kind: 'type'; selector: string; value: string; reason?: string }
  | { kind: 'fillForm'; formIndex: number; values: Record<string, string>; submit: boolean; reason?: string }
  | { kind: 'scanInteractive'; reason?: string }
  | { kind: 'scanForms'; reason?: string }
  | { kind: 'extractLinks'; reason?: string }
  | { kind: 'extractText'; reason?: string }
  | { kind: 'screenshot'; fullPage?: boolean; reason?: string }
  | { kind: 'findings'; reason?: string }
  | { kind: 'status'; reason?: string }
  | { kind: 'noop' };

export interface ChatResponse {
  text: string;
  plan: ChatAction[];
  observations?: ChatObservation[];
}

const HISTORY_LIMIT = 10;
const MAX_FINDINGS_IN_CONTEXT = 10;
const MAX_RECORDING_STEPS_IN_CONTEXT = 5;
const MAX_OBSERVATION_CHARS = 4000;
const MAX_LLM_TURNS_PER_CHAT = 2;
const SPIDER_ENDPOINT_CAP_DEFAULT = 20;

const CHAT_SYSTEM_PROMPT = `You are the chat interface of Ultimatrix, an AI security researcher. The user is running an interactive pentest in a headed Playwright browser.

## Output contract (READ FIRST)
You MUST reply with a single JSON object and nothing else — no prose, no markdown, no commentary outside the JSON.

{
  "text": "<1-3 sentence reply to the user>",
  "plan": [<action>, ...]   // array, possibly empty
}

Both fields are required. "plan" is always an array, never null/missing.

## The rule that decides what "plan" is
- IF the user asked a question (status, explanation, "what did you find", "what's here")  → "plan": []
- ELSE IF the user asked you to do anything on the page or the target  → "plan": [<the action(s) that fulfil the request>]
- ELSE (ambiguous)  → pick the most direct action and put it in "plan"

If you describe an action in "text" but the same action is missing from "plan", nothing happens. The user sees the text, but the browser does not move. This is the most common failure mode — do not produce it.

Examples (text → plan):
- "go to /admin"        → plan: [{"kind":"go","url":"/admin"}]
- "navigate to /admin"  → plan: [{"kind":"go","url":"/admin"}]
- "open /admin"         → plan: [{"kind":"go","url":"/admin"}]
- "screenshot"          → plan: [{"kind":"screenshot"}]
- "show me the page"    → plan: [{"kind":"screenshot"}]
- "what's on the page"  → plan: [{"kind":"scanInteractive"}]
- "check the page"      → plan: [{"kind":"scanInteractive"}]
- "scan"                → plan: [{"kind":"scanInteractive"}]
- "what forms"          → plan: [{"kind":"scanForms"}]
- "show me the forms"   → plan: [{"kind":"scanForms"}]
- "list findings"       → plan: [{"kind":"findings"}]
- "what did you find"   → plan: [{"kind":"findings"}]
- "attack /level1 with xss"  → plan: [{"kind":"attack","url":"/level1","technique":"xss"}]
- "test /login for sqli"     → plan: [{"kind":"attack","url":"/login","technique":"sqli"}]
- "click the search button"  → plan: [{"kind":"click","selector":"button[type=submit]"}]
- "fill the form"            → plan: [{"kind":"scanForms"}]  (scan first, then fill on next turn)

A plan with [] means "I am answering in text only" — only valid for questions.

## Loop
1. You return {text, plan}.
2. The session executes the plan; you receive observations in your next turn.
3. If the previous turn was a plan, your next "text" should summarise the actual observations, not the plan.

## Context you receive each turn
- target, currentUrl
- findings (vulnerabilities already discovered)
- forms on page
- recent recording (last 5 user actions)
- chat history (last 10 turns)
- trigger form (when this turn is a form auto-test)
- spider summary (endpoints, forms, tech stack, OOB count)

When picking a URL for "attack", prefer an endpoint from the spider summary — it has been classified and is reachable.

## Action kinds
- {"kind":"scanInteractive"}           — extract every button/link/input on the current page
- {"kind":"scanForms"}                 — extract every form with its fields
- {"kind":"extractLinks"}              — extract every <a href=...> link
- {"kind":"extractText"}               — extract the visible text
- {"kind":"screenshot","fullPage":false} — take a screenshot (saved to output dir)
- {"kind":"go","url":"..."}            — navigate the browser
- {"kind":"click","selector":"..."}    — click an element
- {"kind":"type","selector":"...","value":"..."} — fill an input
- {"kind":"fillForm","formIndex":0,"values":{...},"submit":true} — fill and submit a form
- {"kind":"attack","url":"...","technique":"xss|sqli|idor|ssrf|ssti|..."} — run an LLM attack
- {"kind":"findings"}                  — list current findings
- {"kind":"status"}                    — show session counters
- {"kind":"noop"}                      — do nothing (use only for text-only replies)

## Style
- Keep "text" to 1-3 sentences. Direct, conversational, professional.
- Say "test", "probe", "check" — not "exploit", "payload", "attack".
- Never invent findings. Only reference findings present in the context.
- Do not narrate an action unless it is in "plan".

## Final reminder
- Both "text" and "plan" are required.
- An empty "plan" is allowed ONLY for question-style prompts.
- For any action request, the action MUST be in "plan" or the user will see a reply and the page will not change. This is the #1 thing to avoid.`;

/** Build the user message sent to the chat LLM (turn 1 — what should I do?). */
export function buildChatUserMessage(message: string, context: ChatContext): string {
  const lines: string[] = [];
  lines.push(`Target: ${context.target}`);
  lines.push(`Current URL: ${context.currentUrl || '(browser not yet navigated)'}`);
  lines.push(`Auto-test forms: ${context.autotest ? 'on' : 'off'}`);

  if (context.findings.length > 0) {
    const recent = context.findings.slice(0, MAX_FINDINGS_IN_CONTEXT);
    lines.push(`\nFindings (${context.findings.length} total, showing ${recent.length}):`);
    for (const f of recent) {
      lines.push(`  [${String(f.severity ?? 'info').toUpperCase()}] ${f.type} @ ${f.endpoint} (conf=${f.confidence})`);
    }
  } else {
    lines.push(`\nFindings: none yet.`);
  }

  if (context.formsOnPage.length > 0) {
    lines.push(`\nForms on current page (${context.formsOnPage.length}):`);
    for (const form of context.formsOnPage) {
      lines.push(`  [form #${form.index}] action="${form.action}" method=${form.method}`);
      for (const field of form.fields) {
        const req = field.required ? ' (required)' : '';
        const placeholder = field.placeholder ? ` placeholder="${field.placeholder}"` : '';
        lines.push(`    - ${field.name || '(unnamed)'}: ${field.type}${placeholder}${req}`);
      }
    }
  } else {
    lines.push(`\nForms on current page: none.`);
  }

  if (context.recording.length > 0) {
    const recent = context.recording.slice(-MAX_RECORDING_STEPS_IN_CONTEXT);
    lines.push(`\nRecent user actions (${recent.length} of last ${MAX_RECORDING_STEPS_IN_CONTEXT}):`);
    for (const step of recent) {
      if (step.type === 'navigate') lines.push(`  → ${step.url}`);
      else if (step.type === 'click') lines.push(`  click ${step.selector}`);
      else if (step.type === 'fill') lines.push(`  fill ${step.selector} = ${JSON.stringify(step.value)}`);
    }
  }

  if (context.triggerForm) {
    lines.push(`\n[Form auto-test trigger]`);
    lines.push(`A new form just appeared:`);
    lines.push(`  [form #${context.triggerForm.index}] action="${context.triggerForm.action}" method=${context.triggerForm.method}`);
    for (const field of context.triggerForm.fields) {
      const req = field.required ? ' (required)' : '';
      lines.push(`    - ${field.name || '(unnamed)'}: ${field.type}${req}`);
    }
    lines.push(`Pick a testing technique based on the field names/types and return a plan that starts with an "attack" action.`);
  }

  if (context.history.length > 0) {
    lines.push(`\nChat history (last ${context.history.length} messages):`);
    for (const msg of context.history) {
      const who = msg.role === 'user' ? 'user' : 'agent';
      lines.push(`  ${who}: ${msg.text}`);
    }
  }

  if (context.spider) {
    lines.push(formatSpiderSection(context.spider));
  }

  lines.push(`\nUser: ${message}`);
  lines.push(`\nRespond with JSON only.`);
  return lines.join('\n');
}

/** Build the user message for the follow-up turn (turn 2 — here's what happened). */
export function buildSummaryUserMessage(observations: ChatObservation[]): string {
  const lines: string[] = [];
  lines.push(`Here are the results of the actions I just executed. Summarise the actual outcomes for the user in 1-3 sentences. Be specific — quote numbers, findings, and selectors. If something failed, say so.`);
  lines.push(``);
  for (const obs of observations) {
    lines.push(`[${obs.action}] ${obs.summary}`);
    if (obs.data !== undefined) {
      const dataStr = typeof obs.data === 'string' ? obs.data : JSON.stringify(obs.data);
      const truncated = dataStr.length > MAX_OBSERVATION_CHARS
        ? dataStr.slice(0, MAX_OBSERVATION_CHARS) + `\n... (truncated ${dataStr.length - MAX_OBSERVATION_CHARS} chars)`
        : dataStr;
      lines.push(truncated);
    }
    lines.push(``);
  }
  lines.push(`Respond with JSON only: { "text": "<your summary>" }`);
  return lines.join('\n');
}

const SUMMARY_SYSTEM_PROMPT = `You are summarising the actual results of executed actions for a user running an interactive security test. Be specific, concise, and use plain English. Don't use words like "exploit", "payload", "attack" — say "test", "probe", "check". Quote real numbers, selectors, and findings. Respond with JSON only: { "text": "..." }`;

/** Validate and coerce the LLM's response into a ChatResponse. */
export function parseChatResponse(raw: unknown, fallbackText: string): ChatResponse {
  const obj = (raw ?? {}) as { text?: unknown; plan?: unknown };
  const text = typeof obj.text === 'string' ? obj.text : fallbackText;
  const planRaw = Array.isArray(obj.plan) ? obj.plan : [];
  const plan: ChatAction[] = [];
  for (const item of planRaw) {
    const action = parseAction(item);
    if (action) plan.push(action);
  }
  return { text, plan };
}

function parseAction(raw: unknown): ChatAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  switch (kind) {
    case 'attack': {
      const url = String(r.url ?? '').trim();
      if (!url) return null;
      return {
        kind: 'attack',
        url,
        technique: typeof r.technique === 'string' ? r.technique : undefined,
        reason: typeof r.reason === 'string' ? r.reason : undefined,
      };
    }
    case 'go': {
      const url = String(r.url ?? '').trim();
      if (!url) return null;
      return {
        kind: 'go',
        url,
        reason: typeof r.reason === 'string' ? r.reason : undefined,
      };
    }
    case 'click': {
      const selector = String(r.selector ?? '').trim();
      if (!selector) return null;
      return {
        kind: 'click',
        selector,
        reason: typeof r.reason === 'string' ? r.reason : undefined,
      };
    }
    case 'type': {
      const selector = String(r.selector ?? '').trim();
      const value = String(r.value ?? '');
      if (!selector) return null;
      return {
        kind: 'type',
        selector,
        value,
        reason: typeof r.reason === 'string' ? r.reason : undefined,
      };
    }
    case 'fillForm': {
      const formIndex = typeof r.formIndex === 'number' ? r.formIndex : parseInt(String(r.formIndex ?? '0'), 10);
      const values = (r.values && typeof r.values === 'object' ? r.values : {}) as Record<string, string>;
      const submit = r.submit === true;
      return {
        kind: 'fillForm',
        formIndex: isNaN(formIndex) ? 0 : formIndex,
        values,
        submit,
        reason: typeof r.reason === 'string' ? r.reason : undefined,
      };
    }
    case 'scanInteractive':
      return { kind: 'scanInteractive', reason: typeof r.reason === 'string' ? r.reason : undefined };
    case 'scanForms':
      return { kind: 'scanForms', reason: typeof r.reason === 'string' ? r.reason : undefined };
    case 'extractLinks':
      return { kind: 'extractLinks', reason: typeof r.reason === 'string' ? r.reason : undefined };
    case 'extractText':
      return { kind: 'extractText', reason: typeof r.reason === 'string' ? r.reason : undefined };
    case 'screenshot':
      return {
        kind: 'screenshot',
        fullPage: r.fullPage === true,
        reason: typeof r.reason === 'string' ? r.reason : undefined,
      };
    case 'findings':
      return { kind: 'findings', reason: typeof r.reason === 'string' ? r.reason : undefined };
    case 'status':
      return { kind: 'status', reason: typeof r.reason === 'string' ? r.reason : undefined };
    case 'noop':
      return { kind: 'noop' };
    default:
      return null;
  }
}

/** Make a chat LLM call. Returns a parsed ChatResponse.
 *  Pass an empty `observations` array on turn 1; pass the observations
 *  on the follow-up turn to get a summary. */
export async function callChat(
  llm: LLMClient,
  message: string,
  context: ChatContext,
): Promise<ChatResponse> {
  if (context.observations && context.observations.length > 0) {
    // Turn 2: summary
    const userMsg = buildSummaryUserMessage(context.observations);
    const res = await llm.call({
      system: SUMMARY_SYSTEM_PROMPT,
      user: userMsg,
      label: 'chat/summary',
      temperature: 0.2,
    });
    const parsed = parseChatResponse(res.json, res.text || '(no summary)');
    return { text: parsed.text, plan: [], observations: context.observations };
  }
  // Turn 1: what should I do?
  const userMsg = buildChatUserMessage(message, context);
  const res = await llm.call({
    system: CHAT_SYSTEM_PROMPT,
    user: userMsg,
    label: context.triggerForm ? 'chat/autotest' : 'chat',
    temperature: 0.3,
  });
  return parseChatResponse(res.json, res.text || '(no response)');
}

/** Trim a chat history to the last N messages. */
export function trimHistory(history: ChatMessage[], limit = HISTORY_LIMIT): ChatMessage[] {
  if (history.length <= limit) return history;
  return history.slice(-limit);
}

export { MAX_LLM_TURNS_PER_CHAT };
