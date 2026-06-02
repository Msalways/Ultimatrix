/**
 * src/agents/specialist-builder.ts
 *
 * LLM-driven selection of attack techniques for a given target.
 * This is **Hardcode Removal #1** — replaces the keyword-based
 * `getDefaultTechniques()` and `getTechniquesForParam()` from
 * `src/core/attack-plan.ts` with LLM reasoning.
 *
 * The LLM sees:
 *   - The endpoint (method, path, parameters, content type, auth)
 *   - The form (action, method, fields, types)
 *   - The target's tech stack
 *   - Any auth boundaries or special context
 *
 * And returns a JSON list of techniques to try, plus brief reasoning.
 *
 * Fallback strategy: if the LLM call fails, we return a small safe set
 * (xss, sqli) and surface the error to the caller for logging.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AppModel, AppModelEndpoint, AppModelForm } from '../core/app-model';
import type { Technique } from '../core/attack-plan';

const ALL_TECHNIQUES: Technique[] = [
  'sqli', 'xss', 'ssrf', 'xxe', 'cmd', 'path', 'ssti', 'open-redirect', 'idor', 'race',
];

const SAFE_FALLBACK: Technique[] = ['xss', 'sqli'];

export interface TechniqueSelection {
  techniques: Technique[];
  reasoning: string;
  source: 'llm' | 'fallback';
  error?: string;
}

const SYSTEM_PROMPT = `You are a security strategist selecting which attack techniques to test against a single endpoint or form.

Output STRICT JSON in this exact shape:
{"techniques": ["<tech1>", "<tech2>", ...], "reasoning": "<one short sentence>"}

Rules:
- Only use these technique names: sqli, xss, ssrf, xxe, cmd, path, ssti, open-redirect, idor, race
- Pick the MINIMAL set of techniques that are actually relevant to this target
- Do NOT pick techniques just because they exist; reason about the target's surface
- For ID-numeric parameters (e.g. /users/123), idor and sqli are strong candidates
- For search-like free-text parameters, xss and ssti are strong candidates
- For URL/host-like parameters (redirect=, url=, callback=), ssrf and open-redirect are strong candidates
- For file/path parameters (file=, path=, attachment=), path is a strong candidate
- For XML-accepting endpoints, xxe is relevant
- For state-changing endpoints (POST/PUT/DELETE), race is sometimes worth checking
- If the endpoint only takes structured data with no clear injection point, an empty array is fine
- NEVER use the words "exploit", "attack", "payload", "injection". Use "test", "probe", "check".`;

function buildEndpointContext(endpoint: AppModelEndpoint, appModel: AppModel): string {
  const ctx: Record<string, unknown> = {
    method: endpoint.method,
    path: endpoint.path,
    requiresAuth: endpoint.requiresAuth,
    contentType: endpoint.contentType,
    responseStatus: endpoint.responseStatus,
    bodyFormat: endpoint.bodyFormat,
    bodyFields: endpoint.bodyFields,
    authHeaders: endpoint.authHeaders,
    params: endpoint.params,
    bodyPreview: (endpoint.bodyPreview || '').slice(0, 400),
  };
  if (appModel.techStack?.length) ctx.techStack = appModel.techStack;
  if (appModel.auth?.type) ctx.authType = appModel.auth.type;
  return JSON.stringify(ctx, null, 2);
}

function buildFormContext(form: AppModelForm, appModel: AppModel): string {
  const ctx: Record<string, unknown> = {
    pageUrl: form.pageUrl,
    action: form.action,
    method: form.method,
    fields: form.fields,
  };
  if (appModel.techStack?.length) ctx.techStack = appModel.techStack;
  if (appModel.auth?.type) ctx.authType = appModel.auth.type;
  return JSON.stringify(ctx, null, 2);
}

function parseSelection(raw: string): TechniqueSelection {
  const text = raw.trim();
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < 0) {
    throw new Error(`No JSON object in LLM response: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  if (!Array.isArray(parsed.techniques)) {
    throw new Error('Missing techniques array in LLM response');
  }
  const techniques: Technique[] = [];
  for (const t of parsed.techniques) {
    if (typeof t === 'string' && (ALL_TECHNIQUES as string[]).includes(t)) {
      techniques.push(t as Technique);
    }
  }
  if (techniques.length === 0) {
    return { techniques: [], reasoning: String(parsed.reasoning || 'LLM returned no valid techniques'), source: 'llm' };
  }
  return {
    techniques: Array.from(new Set(techniques)),
    reasoning: String(parsed.reasoning || ''),
    source: 'llm',
  };
}

export async function selectTechniquesForEndpoint(
  endpoint: AppModelEndpoint,
  appModel: AppModel,
  llm: BaseChatModel,
): Promise<TechniqueSelection> {
  const context = buildEndpointContext(endpoint, appModel);
  const userPrompt = `Target endpoint:\n${context}\n\nPick the techniques to test against this endpoint. Return strict JSON.`;
  try {
    const response = await llm.invoke([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]);
    const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    return parseSelection(text);
  } catch (e) {
    return {
      techniques: SAFE_FALLBACK,
      reasoning: `LLM call failed; using safe fallback (xss, sqli)`,
      source: 'fallback',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function selectTechniquesForForm(
  form: AppModelForm,
  appModel: AppModel,
  llm: BaseChatModel,
): Promise<TechniqueSelection> {
  const context = buildFormContext(form, appModel);
  const userPrompt = `Target form:\n${context}\n\nPick the techniques to test against this form. Return strict JSON.`;
  try {
    const response = await llm.invoke([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]);
    const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    return parseSelection(text);
  } catch (e) {
    return {
      techniques: SAFE_FALLBACK,
      reasoning: `LLM call failed; using safe fallback (xss, sqli)`,
      source: 'fallback',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function listAllTechniques(): Technique[] {
  return [...ALL_TECHNIQUES];
}
