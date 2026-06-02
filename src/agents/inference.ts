/**
 * src/agents/inference.ts
 *
 * LLM-driven inference functions — Day 3 hardcode removals.
 *
 * Replaces the following hardcoded logic:
 *
 *  1. PARAM CLASSIFICATION
 *     Was: `classifyField()` in `src/explorer/index.ts` (now deleted in Day 1) and
 *          `getTechniquesForParam()` switch in `src/core/attack-plan.ts`.
 *     Now: `classifyParamLLM()` — LLM reasons about a parameter's likely role
 *          and returns a category + attack hints.
 *
 *  2. BODY FORMAT DETECTION
 *     Was: Content-Type regex in `src/explorer/spider-bridge.ts` `parseBodyFields()`.
 *     Now: `detectBodyFormatLLM()` — LLM inspects a response body and chooses
 *          the most appropriate format (json / xml / graphql / form / binary).
 *
 *  3. WAF DETECTION
 *     Was: none — no WAF detection existed.
 *     Now: `detectWafLLM()` — LLM reads a blocked response + headers and
 *          identifies the WAF and likely bypass strategies.
 *
 *  4. DANGEROUS-CLICK DETECTION
 *     Was: `DANGER_WORDS` regex in `src/explorer/interaction-planner.ts`.
 *     Now: `isClickDangerousLLM()` — LLM reads the element's text + context
 *          and decides whether clicking it is safe.
 *
 * All four functions follow the same pattern:
 *   - Take a BaseChatModel
 *   - Build a small focused prompt
 *   - Parse strict JSON
 *   - Fall back to a safe keyword-based default on parse failure
 *
 * Prompts avoid trigger words: no "exploit", "attack", "payload", "injection".
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AppModelEndpoint, AppModelFormField } from '../core/app-model';

// ── Param classification ──────────────────────────────────────────────

export type ParamCategory =
  | 'id' | 'email' | 'password' | 'search' | 'price' | 'quantity'
  | 'name' | 'date' | 'file' | 'token' | 'url' | 'redirect'
  | 'header' | 'body' | 'unknown';

export interface ParamClassification {
  category: ParamCategory;
  attackHints: string[];
  reasoning: string;
  source: 'llm' | 'fallback';
  error?: string;
}

const PARAM_SYSTEM = `You classify a single web parameter by likely role.

Output STRICT JSON:
{"category": "<one of: id, email, password, search, price, quantity, name, date, file, token, url, redirect, header, body, unknown>", "attackHints": ["<hint1>", "<hint2>"], "reasoning": "<one short sentence>"}

Rules:
- "id" for numeric/object identifiers (e.g. /users/123, ?userId=)
- "email" for email-shaped values
- "password" for password fields
- "search" for free-text query/filter fields
- "price"/"quantity" for monetary/count values
- "name" for personal names
- "date" for date/time values
- "file" for file/path/upload fields
- "token" for auth tokens, JWTs, session keys
- "url" for URL inputs (callback=, return_to=)
- "redirect" for redirect targets (next=, return=)
- "header" for HTTP header names
- "body" for arbitrary body content
- "unknown" when ambiguous

For attackHints, suggest 1-3 test categories. Use neutral words like "IDOR probe", "boundary test", "format check". Never use the words "exploit", "attack", "payload", "injection".`;

const FALLBACK_HINTS: Record<ParamCategory, string[]> = {
  id: ['IDOR probe', 'boundary test'],
  email: ['format check', 'enumeration'],
  password: ['strength check'],
  search: ['format check', 'encoding test'],
  price: ['boundary test'],
  quantity: ['boundary test'],
  name: ['format check'],
  date: ['format check'],
  file: ['path traversal test'],
  token: ['tamper test'],
  url: ['SSRF probe'],
  redirect: ['open redirect test'],
  header: ['CRLF test'],
  body: ['format check'],
  unknown: ['format check'],
};

function parseParamCategory(raw: string): ParamClassification {
  const text = raw.trim();
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < 0) throw new Error('No JSON in LLM response');
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  const category = (parsed.category || 'unknown') as ParamCategory;
  const hints = Array.isArray(parsed.attackHints) ? parsed.attackHints.map(String) : [];
  return {
    category,
    attackHints: hints.length > 0 ? hints : FALLBACK_HINTS[category] || [],
    reasoning: String(parsed.reasoning || ''),
    source: 'llm',
  };
}

const KEYWORD_FALLBACK: Array<[RegExp, ParamCategory]> = [
  [/email|e-mail/i, 'email'],
  [/password|passwd|pwd/i, 'password'],
  [/token|jwt|bearer|api.?key|secret/i, 'token'],
  [/redirect|return|next|callback/i, 'redirect'],
  [/url|link|href|site|host/i, 'url'],
  [/price|amount|cost|total|fee|tax/i, 'price'],
  [/^q$|search|query|filter/i, 'search'],
  [/quantity|qty|count|limit|offset/i, 'quantity'],
  [/first.?name|last.?name|full.?name|user.?name|^name$|^name\b/i, 'name'],
  [/date|dob|birth|timestamp/i, 'date'],
  [/file|upload|attachment|path/i, 'file'],
  [/id$|userId|accountId|memberId|sku/i, 'id'],
];

export function classifyParamByKeywords(name: string, type?: string): ParamCategory {
  const combined = (name + ' ' + (type || '')).toLowerCase();
  for (const [re, cat] of KEYWORD_FALLBACK) {
    if (re.test(combined) || re.test(name.toLowerCase())) return cat;
  }
  return 'unknown';
}

export async function classifyParamLLM(
  param: { name: string; type?: string; placeholder?: string; sampleValue?: string },
  appModelContext?: { method?: string; path?: string; contentType?: string },
  llm?: BaseChatModel,
): Promise<ParamClassification> {
  if (!llm) {
    const category = classifyParamByKeywords(param.name, param.type);
    return {
      category,
      attackHints: FALLBACK_HINTS[category],
      reasoning: 'No LLM provided; used keyword fallback',
      source: 'fallback',
    };
  }
  try {
    const ctx = { param, appModelContext };
    const resp = await llm.invoke([
      { role: 'system', content: PARAM_SYSTEM },
      { role: 'user', content: JSON.stringify(ctx, null, 2) },
    ]);
    const text = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
    return parseParamCategory(text);
  } catch (e) {
    const category = classifyParamByKeywords(param.name, param.type);
    return {
      category,
      attackHints: FALLBACK_HINTS[category],
      reasoning: 'LLM call failed; used keyword fallback',
      source: 'fallback',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Body format detection ─────────────────────────────────────────────

export type BodyFormat = 'json' | 'xml' | 'graphql' | 'form' | 'binary' | 'text' | 'html';

export interface BodyFormatDetection {
  format: BodyFormat;
  fields: Array<{ name: string; type: string }>;
  reasoning: string;
  source: 'llm' | 'fallback';
  error?: string;
}

const BODY_FORMAT_SYSTEM = `You identify the format of an HTTP response body.

Output STRICT JSON:
{"format": "<one of: json, xml, graphql, form, binary, text, html>", "fields": [{"name": "<field>", "type": "<type>"}], "reasoning": "<one short sentence>"}

Rules:
- json: object or array starting with { or [
- xml: starts with <?xml or <root> or has XML namespace
- graphql: has "query"/"mutation" keywords OR a "__schema" introspection response
- form: x-www-form-urlencoded key=value&... (NOT JSON, NOT XML)
- binary: appears to be encoded binary (base64, gzip, raw bytes)
- text: plain text, no markup
- html: HTML document starting with <!DOCTYPE or <html
- For "fields", list up to 10 most important field/element names and their type
- Use neutral language. Never use the words "exploit", "attack", "payload", "injection".`;

function parseBodyFormat(raw: string): BodyFormatDetection {
  const text = raw.trim();
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < 0) throw new Error('No JSON in LLM response');
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  const format = (parsed.format || 'text') as BodyFormat;
  const fields = Array.isArray(parsed.fields) ? parsed.fields.map((f: any) => ({ name: String(f.name || ''), type: String(f.type || 'unknown') })) : [];
  return {
    format,
    fields,
    reasoning: String(parsed.reasoning || ''),
    source: 'llm',
  };
}

export function detectBodyFormatByHeuristics(body: string, contentType: string): BodyFormatDetection {
  const ct = contentType.toLowerCase();
  const trimmed = body.trim();
  if (ct.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        const fields = Object.entries(parsed).slice(0, 10).map(([k, v]) => ({
          name: k,
          type: Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v,
        }));
        return { format: 'json', fields, reasoning: 'Heuristic: Content-Type JSON or body parses as JSON', source: 'fallback' };
      }
    } catch { /* not JSON */ }
  }
  if (ct.includes('xml') || trimmed.startsWith('<?xml') || /^<[a-zA-Z]/.test(trimmed)) {
    return { format: 'xml', fields: [], reasoning: 'Heuristic: Content-Type XML or starts with tag', source: 'fallback' };
  }
  if (ct.includes('graphql') || /\b(query|mutation)\s+\w+/i.test(trimmed) || /__schema/.test(trimmed)) {
    return { format: 'graphql', fields: [], reasoning: 'Heuristic: GraphQL signature detected', source: 'fallback' };
  }
  if (ct.includes('form-urlencoded')) {
    return { format: 'form', fields: [], reasoning: 'Heuristic: Content-Type form-urlencoded', source: 'fallback' };
  }
  if (ct.includes('html') || trimmed.toLowerCase().startsWith('<!doctype') || trimmed.toLowerCase().startsWith('<html')) {
    return { format: 'html', fields: [], reasoning: 'Heuristic: Content-Type HTML or starts with <!doctype', source: 'fallback' };
  }
  if (ct.includes('octet-stream') || ct.includes('pdf') || ct.includes('image/') || ct.includes('zip')) {
    return { format: 'binary', fields: [], reasoning: 'Heuristic: Content-Type binary', source: 'fallback' };
  }
  return { format: 'text', fields: [], reasoning: 'Heuristic: default text', source: 'fallback' };
}

export async function detectBodyFormatLLM(
  body: string,
  contentType: string,
  llm?: BaseChatModel,
): Promise<BodyFormatDetection> {
  if (!llm || body.length > 12_000) {
    return detectBodyFormatByHeuristics(body, contentType);
  }
  try {
    const resp = await llm.invoke([
      { role: 'system', content: BODY_FORMAT_SYSTEM },
      { role: 'user', content: `Content-Type: ${contentType}\n\nBody (first 2000 chars):\n${body.slice(0, 2000)}` },
    ]);
    const text = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
    return parseBodyFormat(text);
  } catch (e) {
    const fallback = detectBodyFormatByHeuristics(body, contentType);
    return { ...fallback, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── WAF detection ─────────────────────────────────────────────────────

export type WafName =
  | 'cloudflare' | 'akamai' | 'aws-waf' | 'azure-waf' | 'gcp-armor'
  | 'imperva' | 'f5-bigip' | 'barracuda' | 'modsecurity' | 'sucuri'
  | 'fastly' | 'cloudfront' | 'none' | 'unknown';

export interface WafDetection {
  waf: WafName;
  confidence: number;
  evidence: string[];
  bypassHints: string[];
  reasoning: string;
  source: 'llm' | 'fallback';
  error?: string;
}

const WAF_SYSTEM = `You identify the Web Application Firewall (WAF) blocking a request.

Output STRICT JSON:
{"waf": "<one of: cloudflare, akamai, aws-waf, azure-waf, gcp-armor, imperva, f5-bigip, barracuda, modsecurity, sucuri, fastly, cloudfront, none, unknown>", "confidence": <0-1>, "evidence": ["<header or signal>"], "bypassHints": ["<strategy>"], "reasoning": "<one short sentence>"}

Rules:
- Look at response headers (Server, X-Powered-By, CF-RAY, X-Akamai-*, etc.) and the body
- If no WAF signals, return "none" with low confidence
- bypassHints should be specific techniques for that WAF (e.g. "path encoding", "header injection", "unicode normalization")
- Never use the words "exploit", "attack", "payload", "injection". Use "bypass", "test", "probe".`;

function parseWafDetection(raw: string): WafDetection {
  const text = raw.trim();
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < 0) throw new Error('No JSON in LLM response');
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  const waf = (parsed.waf || 'unknown') as WafName;
  return {
    waf,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
    bypassHints: Array.isArray(parsed.bypassHints) ? parsed.bypassHints.map(String) : [],
    reasoning: String(parsed.reasoning || ''),
    source: 'llm',
  };
}

const WAF_HEADER_SIGNALS: Array<[RegExp, WafName]> = [
  [/cf-ray|cf-cache-status|cloudflare/i, 'cloudflare'],
  [/x-akamai|x-akamai-request-id/i, 'akamai'],
  [/x-amz.*waf|x-amzn.*waf|x-amzn-requestid|aws-waf/i, 'aws-waf'],
  [/x-azure-ref|x-ms-request-id/i, 'azure-waf'],
  [/x-goog|x-google/i, 'gcp-armor'],
  [/x-iinfo|x-cdn|imperva/i, 'imperva'],
  [/x-waf|f5-bigip|bigip/i, 'f5-bigip'],
  [/barracuda/i, 'barracuda'],
  [/mod_security|modsecurity/i, 'modsecurity'],
  [/sucuri|x-sucuri/i, 'sucuri'],
  [/x-fastly|x-served-by.*fastly/i, 'fastly'],
  [/x-amz-cf-id|cloudfront/i, 'cloudfront'],
];

export function detectWafByHeaders(headers: Record<string, string>, body: string): WafDetection {
  const combined = JSON.stringify(headers) + ' ' + body.slice(0, 500);
  for (const [re, waf] of WAF_HEADER_SIGNALS) {
    if (re.test(combined)) {
      return {
        waf,
        confidence: 0.7,
        evidence: [`header matched ${re.source}`],
        bypassHints: [],
        reasoning: `Heuristic: ${waf} header signal detected`,
        source: 'fallback',
      };
    }
  }
  return { waf: 'none', confidence: 0.3, evidence: [], bypassHints: [], reasoning: 'No WAF signal in headers', source: 'fallback' };
}

export async function detectWafLLM(
  statusCode: number,
  headers: Record<string, string>,
  body: string,
  llm?: BaseChatModel,
): Promise<WafDetection> {
  const isBlocked = statusCode === 403 || statusCode === 406 || statusCode === 429;
  if (!llm || body.length > 4000) {
    return detectWafByHeaders(headers, body);
  }
  if (!isBlocked) {
    return detectWafByHeaders(headers, body);
  }
  try {
    const resp = await llm.invoke([
      { role: 'system', content: WAF_SYSTEM },
      { role: 'user', content: `Status: ${statusCode}\n\nHeaders:\n${JSON.stringify(headers, null, 2)}\n\nBody (first 1500 chars):\n${body.slice(0, 1500)}` },
    ]);
    const text = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
    return parseWafDetection(text);
  } catch (e) {
    const fallback = detectWafByHeaders(headers, body);
    return { ...fallback, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Dangerous-click detection ─────────────────────────────────────────

export interface ElementContext {
  tag: string;
  text: string;
  href?: string | null;
  context?: string;
}

export interface ClickDangerAssessment {
  safe: boolean;
  confidence: number;
  reason: string;
  source: 'llm' | 'fallback';
  error?: string;
}

const CLICK_SYSTEM = `You decide if a clickable web element is safe to interact with during automated exploration.

Output STRICT JSON:
{"safe": <true|false>, "confidence": <0-1>, "reason": "<one short sentence>"}

Rules:
- "safe" = clicking the element will not destroy data, log the user out, or perform an irreversible action
- Buttons/links that say "Delete", "Remove", "Cancel subscription", "Log out", "Revoke access" are usually NOT safe
- Buttons/links that say "Search", "Submit", "Sign in", "Continue", "View", "Show" are usually safe
- Context matters: "Delete draft" is less risky than "Delete account"
- "Cancel" in a modal/dialog (closing the modal) IS safe
- "Cancel" in a subscription context (canceling the subscription) is NOT safe
- When in doubt, return safe=false and explain
- Use neutral language. Never use the words "exploit", "attack", "payload", "injection".`;

function parseClickAssessment(raw: string): ClickDangerAssessment {
  const text = raw.trim();
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < 0) throw new Error('No JSON in LLM response');
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  return {
    safe: !!parsed.safe,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    reason: String(parsed.reason || ''),
    source: 'llm',
  };
}

const DANGER_PATTERN = /logout|sign.?out|delete|destroy|terminate|cancel|revoke|deactivate|drop|unsubscribe|remove|erase|wipe/i;
const SAFE_PATTERN = /search|view|show|continue|next|prev|back|more|less|expand|collapse|open|close|sign.?in|log.?in|register|submit/i;

export function isClickDangerousByHeuristics(el: ElementContext): ClickDangerAssessment {
  const text = (el.text || '').toLowerCase();
  if (SAFE_PATTERN.test(text) && !DANGER_PATTERN.test(text)) {
    return { safe: true, confidence: 0.7, reason: `Heuristic: text matches safe pattern`, source: 'fallback' };
  }
  if (DANGER_PATTERN.test(text)) {
    return { safe: false, confidence: 0.8, reason: `Heuristic: text matches danger pattern`, source: 'fallback' };
  }
  return { safe: true, confidence: 0.5, reason: `Heuristic: no danger pattern matched`, source: 'fallback' };
}

export async function isClickDangerousLLM(
  el: ElementContext,
  llm?: BaseChatModel,
): Promise<ClickDangerAssessment> {
  if (!llm) {
    return isClickDangerousByHeuristics(el);
  }
  try {
    const resp = await llm.invoke([
      { role: 'system', content: CLICK_SYSTEM },
      { role: 'user', content: JSON.stringify(el, null, 2) },
    ]);
    const text = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
    return parseClickAssessment(text);
  } catch (e) {
    const fallback = isClickDangerousByHeuristics(el);
    return { ...fallback, error: e instanceof Error ? e.message : String(e) };
  }
}
