import { parentPort, workerData } from 'worker_threads';
import { randomUUID } from 'crypto';

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { providerRegistry } from '../providers/provider-registry';
import type { Hypothesis, Technique } from './attack-plan';

interface WorkerConfig {
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
  evidence: string[];
  analysis: string;
  timestamp: number;
}

interface WorkerResult {
  hypothesisId: string;
  vulnerable: boolean;
  technique: string;
  confidence: number;
  evidence: string[];
  payloads: string[];
  summary: string;
  error?: string;
  attempts: WorkerAttempt[];
}

const TIMEOUT_MS = 180_000;
const BUDGET = 6;

function msg(type: 'system' | 'human', content: string): { role: string; content: string } {
  return { role: type, content };
}

async function runWorker(): Promise<void> {
  const config = workerData as WorkerConfig;
  const hypothesis = config.hypothesis;
  const budget = config.budget ?? BUDGET;
  const timeoutMs = config.timeoutMs ?? TIMEOUT_MS;
  const oastUrl = config.oastBaseUrl;

  // ── Initialize Playwright API context from storage state ──
  let apiContext: import('playwright').APIRequestContext | null = null;
  try {
    const { request } = await import('playwright');
    if (config.storageStatePath) {
      apiContext = await request.newContext({ storageState: config.storageStatePath });
    }
  } catch {
    process.stderr.write('[worker] Playwright import failed (falling back to raw fetch)\n');
  }

  async function cleanup(): Promise<void> {
    if (apiContext) try { await apiContext.dispose(); } catch {}
  }

  const timer = setTimeout(() => {
    cleanup();
    sendResult({
      hypothesisId: hypothesis.id,
      vulnerable: false,
      technique: hypothesis.technique,
      confidence: 0,
      evidence: [],
      payloads: [],
      summary: `Worker timed out after ${timeoutMs}ms`,
      error: 'timeout',
      attempts: [],
    });
    process.exit(1);
  }, timeoutMs);

  try {
    const model = await createModel(config.llmConfig);
    const attempts: WorkerAttempt[] = [];

    const ep = hypothesis.type === 'form' ? hypothesis.action : hypothesis.endpoint;
    const param = hypothesis.type === 'form' ? hypothesis.fields[0] : hypothesis.param || '';
    const method = hypothesis.type === 'form' ? 'POST' : hypothesis.method;
    const domain = new URL(ep).hostname;

    // ── Tier 3: Baseline timing ──
    let baselineTimingMs = 0;
    try {
      const basePayload = param ? `baseline_${Date.now()}` : '';
      const baseline = await sendHttpRequest(ep, param, method, basePayload, {}, 'form', apiContext);
      if (baseline) baselineTimingMs = baseline.timingMs;
    } catch { /* baseline is optional */ }

    // ── Tier 1: OAST setup ──
    const oastTechniques = new Set(['ssrf', 'xxe', 'open-redirect']);
    const oastUuid = oastUrl && oastTechniques.has(hypothesis.technique)
      ? randomUUID().replace(/-/g, '').slice(0, 12)
      : null;
    const oastCallbackUrl = oastUuid ? `${oastUrl}/${oastUuid}` : null;

    // ── Stored XSS tracking ──
    let storedUrl: string | null = null;
    let storedPayload: string | null = null;

    let lastResponseText = 'No previous attempt.';
    let lastStatus = 0;
    let lastBodyExcerpt = '';
    let lastHeaders: Record<string, string> = {};

    // ── Auto re-login handler ──
    let sessionExpired = false;
    async function ensureSession(): Promise<boolean> {
      if (!sessionExpired || !config.loginEndpoint || !apiContext) return true;
      try {
        process.stderr.write('[worker] Session expired — re-logging in...\n');
        let loginBody: string | undefined;
        if (config.loginFields?.length) {
          const creds: Record<string, string> = {};
          for (const f of config.loginFields) {
            creds[f] = 'test_auto_login';
          }
          loginBody = JSON.stringify(creds);
        }
        const loginRes = await apiContext!.fetch(config.loginEndpoint, {
          method: config.loginMethod || 'POST',
          data: loginBody,
          timeout: 30000,
        });
        if (loginRes.ok()) {
          sessionExpired = false;
          process.stderr.write('[worker] Re-login successful\n');
          return true;
        }
        process.stderr.write(`[worker] Re-login failed: ${loginRes.status()}\n`);
        return false;
      } catch (e) {
        process.stderr.write(`[worker] Re-login error: ${e}\n`);
        return false;
      }
    }

    for (let i = 0; i < budget; i++) {
      process.stderr.write(`[worker] attempt ${i + 1}/${budget} starting...\n`);

      const payloadResult = await generatePayload(
        model, hypothesis.technique, ep, param, method, lastResponseText, budget, i,
        oastCallbackUrl, domain, lastHeaders,
        (hypothesis as any).bodyFormat,
      );
      if (!payloadResult) { process.stderr.write(`[worker] attempt ${i + 1}: generatePayload failed\n`); continue; }

      const contentType = payloadResult.bodyType === 'xml' ? 'xml' : 'form';

      // Send request (may trigger re-auth if session expired)
      let response = await sendHttpRequest(ep, param, method, payloadResult.payload, payloadResult.headers, contentType, apiContext);
      if (!response) continue;

      // If 401 and we have auth, mark session expired and retry after re-login
      if (response.status === 401 && (apiContext || config.loginEndpoint)) {
        sessionExpired = true;
        const reAuthed = await ensureSession();
        if (reAuthed) {
          response = await sendHttpRequest(ep, param, method, payloadResult.payload, payloadResult.headers, contentType, apiContext);
        }
      }
      if (!response) continue;

      lastStatus = response.status;
      lastBodyExcerpt = response.body.slice(0, 8000);
      lastHeaders = response.headers;
      lastResponseText = `Attempt ${i + 1}: payload="${payloadResult.payload.slice(0, 100)}" → ${response.status} (${response.body.length} bytes, ${response.timingMs}ms)`;

      // ── Tier 3: Timing-based detection ──
      let timingEvidence: string[] = [];
      if (baselineTimingMs > 0 && response.timingMs > baselineTimingMs * 3 && response.timingMs > 3000) {
        timingEvidence = [`Response delayed: ${response.timingMs}ms vs baseline ${baselineTimingMs}ms (potential time-based injection)`];
      }

      // ── Tier 1: Full response analysis ──
      const analysis = await analyzeResponse(
        model, hypothesis.technique, payloadResult.payload,
        response.status, lastBodyExcerpt, response.headers,
      );

      const allEvidence = [...(timingEvidence || []), ...(analysis?.evidence || [])];

      // ── Tier 1: Stored XSS detection ──
      let storedAnalysis: { vulnerable: boolean; confidence: number; evidence: string[]; analysis: string } | null = null;
      if (method === 'POST' && hypothesis.technique === 'xss') {
        const followUpUrl = response.headers['location'] || ep;
        if (followUpUrl !== ep) {
          storedUrl = followUpUrl;
          storedPayload = payloadResult.payload;
          const storedRes = await sendHttpRequest(followUpUrl, '', 'GET', '', {}, 'form', apiContext);
          if (storedRes) {
            storedAnalysis = await analyzeResponse(
              model, hypothesis.technique, payloadResult.payload,
              storedRes.status, storedRes.body.slice(0, 8000), storedRes.headers,
            );
            if (storedAnalysis?.vulnerable) {
              allEvidence.push(...storedAnalysis.evidence.map((e) => `[stored] ${e}`));
            }
          }
        }
      }

      const isVulnerable = (analysis?.vulnerable || storedAnalysis?.vulnerable || timingEvidence.length > 0) || false;
      const maxConf = Math.max(
        analysis?.confidence || 0,
        storedAnalysis?.confidence || 0,
        timingEvidence.length > 0 ? 0.5 : 0,
      );

      const attempt: WorkerAttempt = {
        hypothesisId: hypothesis.id,
        technique: hypothesis.technique,
        attempt: i + 1,
        url: ep,
        method,
        headers: payloadResult.headers || {},
        body: undefined,
        payload: payloadResult.payload,
        status: response.status,
        responseBodySnippet: lastBodyExcerpt,
        timingMs: response.timingMs,
        vulnerable: isVulnerable,
        evidence: allEvidence,
        analysis: [analysis?.analysis || '', storedAnalysis?.analysis || ''].filter(Boolean).join(' | '),
        timestamp: Date.now(),
      };
      attempts.push(attempt);

      if (isVulnerable && maxConf >= 0.3) {
        clearTimeout(timer);
        const payloads = attempts.map((a) => a.payload);
        const allEv = attempts.flatMap((a) => a.evidence);
        const target = hypothesis.type === 'form'
          ? `${hypothesis.action} [fields: ${hypothesis.fields.join(', ')}]`
          : `${hypothesis.endpoint}${hypothesis.param ? '?' + hypothesis.param : ''}`;

        await cleanup();
        sendResult({
          hypothesisId: hypothesis.id,
          vulnerable: true,
          technique: hypothesis.technique,
          confidence: maxConf,
          evidence: allEv,
          payloads,
          summary: `${hypothesis.technique.toUpperCase()} on ${target}: VULNERABLE (confidence: ${maxConf})`,
          attempts,
        });
        process.exit(0);
      }
    }

    // ── Tier 1: OAST callback check (after all attempts) ──
    let oastEvidence: string[] = [];
    if (oastUuid && oastUrl) {
      try {
        await new Promise((r) => setTimeout(r, 3000));
        const checkRes = await fetch(`${oastUrl}/api/check?uuid=${oastUuid}`);
        if (checkRes.ok) {
          const records = await checkRes.json() as Array<unknown>;
          if (records.length > 0) {
            oastEvidence = [`OAST callback received: ${records.length} callback(s) for uuid ${oastUuid}`];
            const target = hypothesis.type === 'form'
              ? `${hypothesis.action} [fields: ${hypothesis.fields.join(', ')}]`
              : `${hypothesis.endpoint}${hypothesis.param ? '?' + hypothesis.param : ''}`;

            clearTimeout(timer);
            await cleanup();
            sendResult({
              hypothesisId: hypothesis.id,
              vulnerable: true,
              technique: hypothesis.technique,
              confidence: 0.8,
              evidence: oastEvidence,
              payloads: attempts.map((a) => a.payload),
              summary: `${hypothesis.technique.toUpperCase()} on ${target}: OAST callback confirmed (${records.length} callback(s))`,
              attempts,
            });
            process.exit(0);
          }
        }
      } catch { /* OAST check failed */ }
    }

    clearTimeout(timer);
    await cleanup();
    const payloads = attempts.map((a) => a.payload);
    const target = hypothesis.type === 'form'
      ? `${hypothesis.action} [fields: ${hypothesis.fields.join(', ')}]`
      : `${hypothesis.endpoint}${hypothesis.param ? '?' + hypothesis.param : ''}`;

    sendResult({
      hypothesisId: hypothesis.id,
      vulnerable: false,
      technique: hypothesis.technique,
      confidence: 0,
      evidence: [],
      payloads,
      summary: `${hypothesis.technique.toUpperCase()} on ${target}: no vulnerability detected after ${attempts.length} attempts`,
      attempts,
    });
    process.exit(0);
  } catch (err) {
    clearTimeout(timer);
    await cleanup();
    sendResult({
      hypothesisId: hypothesis.id,
      vulnerable: false,
      technique: hypothesis.technique,
      confidence: 0,
      evidence: [],
      payloads: [],
      summary: `Worker error: ${err instanceof Error ? err.message : String(err)}`,
      error: err instanceof Error ? err.message : String(err),
      attempts: [],
    });
    process.exit(1);
  }
}

async function createModel(config: { provider: string; apiKey: string; model: string }): Promise<BaseChatModel> {
  return providerRegistry.create(config.provider as any, {
    apiKey: config.apiKey,
    modelId: config.model,
  });
}

async function generatePayload(
  model: BaseChatModel,
  technique: string,
  endpoint: string,
  param: string,
  method: string,
  lastResponse: string,
  budget: number,
  attempt: number,
  oastCallbackUrl: string | null,
  domain: string,
  lastHeaders: Record<string, string>,
  bodyFormatHint?: string,
): Promise<{ payload: string; headers: Record<string, string>; bodyType?: 'form' | 'xml' } | null> {
  const TECH_DESC: Record<string, string> = {
    sqli: 'SQL injection — use SQL special characters like quotes, UNION, OR to trigger database errors or modify queries',
    xss: 'Cross-site scripting — use HTML/JavaScript syntax like <script>, onerror, onload to execute scripts',
    ssrf: 'Server-side request forgery — provide a URL target for the server to fetch; use OAST callback URL if provided',
    xxe: 'XML external entity — use XML DOCTYPE with SYSTEM entities to read files or trigger OAST callbacks',
    cmd: 'Command injection — use shell metacharacters like |, ;, `, $() to execute OS commands',
    path: 'Path traversal — use ../ sequences to read files outside the web root',
    ssti: 'Server-side template injection — use template syntax like {{7*7}} to compute expressions',
    'open-redirect': 'Open redirect — provide a URL parameter that redirects the browser to an attacker-controlled site',
    idor: 'Insecure direct object reference — manipulate numeric IDs, UUIDs, or object references to access unauthorized data',
    race: 'Race condition — send concurrent requests to exploit timing windows in state changes',
  };

  const hasOast = oastCallbackUrl && (technique === 'ssrf' || technique === 'xxe' || technique === 'open-redirect');
  const oastHint = hasOast ? `\nOAST callback URL available (for blind detection): ${oastCallbackUrl}` : '';
  const jwtHint = technique === 'sqli' && endpoint.includes('login') ? '\nIf this is a JWT login endpoint, try setting alg to "none" or "None".' : '';
  const formatHint = bodyFormatHint ? `\nTarget expects ${bodyFormatHint} format. Output bodyType as "${bodyFormatHint}".` : '';

  const messages = [
    msg('system', 'You are a web security tester. Output ONLY valid JSON, no other text. Generate creative, varied payloads specific to the target context.'),
    msg('human', `Vulnerability type: ${technique} (${TECH_DESC[technique] || 'special characters'})
Endpoint: ${endpoint}
Parameter: ${param}
Method: ${method}
Domain: ${domain}
Last attempt info: ${lastResponse.slice(0, 1500)}
Attempt ${attempt + 1}/${budget}
 ${oastHint}
${jwtHint}
${formatHint}

Generate a test string that might trigger a ${technique} vulnerability.
For techniques: ssrf, xxe, open-redirect — embed the OAST callback URL in the payload if provided.

Output ONLY valid JSON:
{"input": "the test string", "headers": {}, "bodyType": "form"}`),
  ];

  // For XXE, hint about XML body
  if (technique === 'xxe') {
    messages.push(msg('human', `For XXE, set bodyType to "xml" and include a full XML document with SYSTEM entity in the input field.`));
  }

  try {
    const response = await model.invoke(messages);
    const content = typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content.map((c) => typeof c === 'string' ? c : (c as any).text || '').join('')
        : '';
    const jsonMatch = content.match(/\{[\s\S]*"input"[\s\S]*\}/i);
    const cleaned = jsonMatch ? jsonMatch[0] : content;
    const trimmed = cleaned.replace(/^```(?:json)?\n?/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(trimmed);
    return {
      payload: parsed.input || parsed.payload || trimmed,
      headers: parsed.headers || {},
      bodyType: parsed.bodyType || 'form',
    };
  } catch (err) {
    process.stderr.write(`[worker] generatePayload error: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}

async function analyzeResponse(
  model: BaseChatModel,
  technique: string,
  payload: string,
  status: number,
  bodyExcerpt: string,
  headers: Record<string, string>,
): Promise<{ vulnerable: boolean; confidence: number; evidence: string[]; analysis: string } | null> {
  const location = headers['location'] || '';
  const locationHint = location ? `\nResponse Location header: ${location}` : '';

  const messages = [
    msg('system', `You are a web security vulnerability detector. Analyze the HTTP response for ANY evidence of successful exploitation — not just reflection. Look for SQL errors, stack traces, file contents, command output, template rendering, and status anomalies.`),
    msg('human', `Technique tested: ${technique}
Payload sent: ${payload.slice(0, 500)}
Response status: ${status}
Response headers excerpt: Content-Type: ${headers['content-type'] || '-'} | Content-Length: ${headers['content-length'] || '-'}${locationHint}

Response body (first 8000 chars):
${bodyExcerpt}

Analyze this response for ALL signs of successful exploitation:

1. REFLECTION: Does any part of the payload appear verbatim in the response body? Quote exact matches.
2. SQL ERRORS: Messages like "SQL syntax", "mysql_fetch", "ORA-", "unclosed quotation mark", "near '", "You have an error in your SQL"
3. STACK TRACES: Error output with file paths, line numbers, stack frames, "at " patterns
4. FILE CONTENTS: System file content leaked (e.g., /etc/passwd, database config, source code)
5. COMMAND OUTPUT: Results of system commands visible (e.g., directory listings, whoami output)
6. TEMPLATE OUTPUT: Computed expression results (e.g., 49 from {{7*7}}, or other injected expression output)
7. STATUS ANOMALIES: 500 error suggesting server crash, or unexpected 200 on routes that normally return 4xx
8. REDIRECTS: Unusual Location header pointing to an external domain (for open redirect)

For EACH sign found, quote the exact text from the response body as evidence.

Output ONLY valid JSON:
{"vulnerable": true, "confidence": 0.85, "evidence": ["exact quoted evidence from response"], "analysis": "brief explanation of what was found"}`),
  ];

  try {
    const response = await model.invoke(messages);
    const content = typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content.map((c) => typeof c === 'string' ? c : (c as any).text || '').join('')
        : '';
    process.stderr.write(`[worker] raw analysis response (first 300): ${content.slice(0, 300).replace(/\n/g, '\\n')}\n`);
    const jsonMatch = content.match(/\{[\s\S]*"vulnerable"[\s\S]*\}/i);
    let cleaned = jsonMatch ? jsonMatch[0] : content;
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    process.stderr.write(`[worker] analysis result: vulnerable=${parsed.vulnerable}, confidence=${parsed.confidence}, evidence=${(parsed.evidence || []).length}\n`);
    return parsed;
  } catch (err) {
    process.stderr.write(`[worker] analyzeResponse error: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}

async function sendHttpRequest(
  endpoint: string,
  param: string,
  method: string,
  payload: string,
  additionalHeaders: Record<string, string>,
  bodyType: 'form' | 'xml',
  apiContext?: import('playwright').APIRequestContext | null,
): Promise<{ status: number; headers: Record<string, string>; body: string; timingMs: number } | null> {
  try {
    const testUrl = method === 'GET' && param
      ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}${encodeURIComponent(param)}=${encodeURIComponent(payload)}`
      : endpoint;

    const headers: Record<string, string> = { ...additionalHeaders };
    let body: string | undefined;

    if (method === 'POST') {
      if (bodyType === 'xml') {
        headers['Content-Type'] = headers['Content-Type'] || 'application/xml';
        body = payload;
      } else {
        headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
        body = param ? `${encodeURIComponent(param)}=${encodeURIComponent(payload)}` : payload;
      }
    }

    const start = Date.now();

    if (apiContext) {
      const res = await apiContext.fetch(testUrl, {
        method,
        headers,
        data: body,
        timeout: 30000,
      });
      const timingMs = Date.now() - start;
      const resBody = await res.text();
      const resHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers())) {
        resHeaders[k.toLowerCase()] = v;
      }
      return { status: res.status(), headers: resHeaders, body: resBody, timingMs };
    }

    // Fallback: raw fetch (no auth context)
    const res = await fetch(testUrl, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(30000),
    });
    const timingMs = Date.now() - start;
    const resBody = await res.text();
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { resHeaders[k.toLowerCase()] = v; });
    return { status: res.status, headers: resHeaders, body: resBody, timingMs };
  } catch (err) {
    process.stderr.write(`[worker] HTTP error: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}

function sendResult(result: WorkerResult): void {
  if (parentPort) {
    parentPort.postMessage(result);
  }
}

runWorker();
