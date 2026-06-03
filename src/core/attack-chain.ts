// src/core/attack-chain.ts
//
// Attack-chain reasoning engine.
//
// Takes a list of findings and reasons about multi-step attack chains.
// A chain is a sequence of findings that, when combined, escalate the
// overall impact (e.g. SSRF + AWS creds + S3 takeover = full account
// takeover). The engine is the BIG differentiator — no scanner does this
// well.
//
// Two modes:
//   - heuristic (no LLM): uses pre-defined chain templates, fast, no API
//   - llm (default): asks the LLM to reason about chains, slower but smarter
//
// The heuristic mode covers the common chains (SSRF→cloud, XSS→session, etc.)
// so the engine is always useful even when the LLM is slow/unavailable.

import type { AppModel, AppModelFinding, AttackChain, ReconLogEntry } from './app-model';
import { updateAppModelSection } from './app-model';

export interface ChainEngineOptions {
  findings: AppModelFinding[];
  appModel: AppModel;
  appModelPath: string;
  llm?: LlmInvoker;
  mode?: 'heuristic' | 'llm' | 'hybrid';
  minSeverityForChain?: 'low' | 'medium' | 'high' | 'critical';
}

export interface LlmInvoker {
  systemPrompt: string;
  userPrompt: string;
  modelId: string;
  provider: 'openai' | 'anthropic' | 'mock' | string;
  apiKey: string;
  baseURL?: string;
  maxTokens?: number;
}

export interface ChainEngineResult {
  chains: AttackChain[];
  mode: 'heuristic' | 'llm' | 'hybrid';
  durationMs: number;
}

// ── heuristic chain templates ─────────────────────────────────────────────

interface ChainTemplate {
  name: string;
  description: string;
  severity: AttackChain['severity'];
  confidence: number;
  exploitability: AttackChain['exploitability'];
  // function that scores how well this template matches the given findings
  match: (findings: AppModelFinding[]) => { stepFindings: AppModelFinding[]; narrative: string } | null;
}

const CHAIN_TEMPLATES: ChainTemplate[] = [
  {
    name: 'SSRF → cloud-metadata → S3 takeover',
    description: 'SSRF reaches cloud metadata service, leaks IAM creds, enumerates S3 buckets',
    severity: 'critical',
    confidence: 0.9,
    exploitability: 'moderate',
    match: (findings) => {
      const ssrf = findings.find(f => /ssrf/i.test(f.type) || /ssrf/i.test(f.endpoint));
      const cloud = findings.find(f => /cloud|metadata|imds|aws|gcp|azure/i.test(f.type));
      if (ssrf && cloud) {
        return {
          stepFindings: [ssrf, cloud],
          narrative: `The SSRF on ${ssrf.endpoint} can be chained with the cloud-metadata leak to extract IAM credentials from the instance metadata service. With those creds, the attacker can enumerate and access S3 buckets, leading to full cloud account compromise.`,
        };
      }
      return null;
    },
  },
  {
    name: 'OAuth redirect-bypass → admin token',
    description: 'OAuth redirect_uri bypass allows attacker to steal authorization code, exchange for admin token',
    severity: 'critical',
    confidence: 0.85,
    exploitability: 'trivial',
    match: (findings) => {
      const oauth = findings.find(f => /oauth|redirect_uri/i.test(f.type) || /oauth/i.test(f.endpoint));
      const idor = findings.find(f => /idor|bola|access.?control/i.test(f.type));
      if (oauth && idor) {
        return {
          stepFindings: [oauth, idor],
          narrative: `The OAuth redirect_uri bypass on ${oauth.endpoint} allows an attacker to steal authorization codes. Combined with the ${idor.type} on ${idor.endpoint}, the attacker can escalate to an admin role and access admin-only data.`,
        };
      }
      return null;
    },
  },
  {
    name: 'JWT alg-none → broken function-level authz',
    description: 'Forged JWT (alg=none) used to access admin-only endpoint',
    severity: 'critical',
    confidence: 0.9,
    exploitability: 'trivial',
    match: (findings) => {
      const jwt = findings.find(f => /jwt|alg.?none|signature.?bypass/i.test(f.type));
      const admin = findings.find(f => /admin|bfla|broken.?function|authz|access.?control/i.test(f.type) && !/jwt/i.test(f.type));
      if (jwt && admin) {
        return {
          stepFindings: [jwt, admin],
          narrative: `The JWT signature bypass (${jwt.type}) allows an attacker to forge tokens with arbitrary claims. Combined with the missing authorization on ${admin.endpoint}, the attacker can forge an admin token and access admin-only functionality.`,
        };
      }
      return null;
    },
  },
  {
    name: 'Race condition → balance drain',
    description: 'Parallel requests bypass check-then-act, drain account balance or reuse coupons',
    severity: 'high',
    confidence: 0.85,
    exploitability: 'trivial',
    match: (findings) => {
      const race = findings.find(f => /race|toctou|balance|coupon|concurrent/i.test(f.type));
      if (race) {
        return {
          stepFindings: [race],
          narrative: `The race condition on ${race.endpoint} (${race.type}) allows an attacker to issue multiple concurrent requests that all pass the check-then-act validation. This can be exploited to drain balances, double-spend coupons, or bypass single-use restrictions.`,
        };
      }
      return null;
    },
  },
  {
    name: 'GraphQL introspection → field-level data dump',
    description: 'Introspection leaks schema, then un-authorized fields return sensitive data',
    severity: 'high',
    confidence: 0.8,
    exploitability: 'moderate',
    match: (findings) => {
      const intro = findings.find(f => /graphql|introspection/i.test(f.type));
      const fieldAuthz = findings.find(f => /graphql|field.?authz|missing.?authz/i.test(f.type));
      if (intro && fieldAuthz) {
        return {
          stepFindings: [intro, fieldAuthz],
          narrative: `The GraphQL introspection leak reveals the entire schema. Combined with the missing field-level authorization, an attacker can craft queries to extract sensitive data (passwords, balances, PII) without proper authentication.`,
        };
      }
      return null;
    },
  },
  {
    name: 'File upload → RCE via extension bypass',
    description: 'File upload accepts executable extensions under guise of safe content-type, leading to RCE',
    severity: 'critical',
    confidence: 0.85,
    exploitability: 'moderate',
    match: (findings) => {
      const upload = findings.find(f => /upload|file.?upload|content.?type/i.test(f.type));
      if (upload) {
        return {
          stepFindings: [upload],
          narrative: `The file upload on ${upload.endpoint} trusts the client-claimed Content-Type, allowing an attacker to upload executable files (e.g. PHP shell) disguised as images. The server stores the file with the attacker-controlled extension, leading to remote code execution.`,
        };
      }
      return null;
    },
  },
  {
    name: 'SSTI → RCE',
    description: 'Server-side template injection allows arbitrary code execution',
    severity: 'critical',
    confidence: 0.9,
    exploitability: 'moderate',
    match: (findings) => {
      const ssti = findings.find(f => /ssti|template.?injection/i.test(f.type));
      if (ssti) {
        return {
          stepFindings: [ssti],
          narrative: `The server-side template injection on ${ssti.endpoint} allows an attacker to execute arbitrary code in the server's runtime context. This leads to full remote code execution and complete server compromise.`,
        };
      }
      return null;
    },
  },
];

// ── heuristic engine ──────────────────────────────────────────────────────

export function runHeuristicChains(
  findings: AppModelFinding[],
  minSeverity: ChainEngineOptions['minSeverityForChain'] = 'low',
): AttackChain[] {
  const chains: AttackChain[] = [];
  for (const tpl of CHAIN_TEMPLATES) {
    const result = tpl.match(findings);
    if (!result) continue;
    // check minimum severity
    const severities: AttackChain['severity'][] = ['info', 'low', 'medium', 'high', 'critical'];
    if (severities.indexOf(tpl.severity) < severities.indexOf(minSeverity)) continue;
    const chain: AttackChain = {
      id: `chain-${tpl.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
      name: tpl.name,
      steps: result.stepFindings.map((f, i) => ({
        step: i + 1,
        findingType: f.type,
        endpoint: f.endpoint,
        evidenceRef: f.evidence[0]?.label || `finding-${i}`,
        description: f.evidence.map(e => e.data).join(' ').slice(0, 256),
      })),
      severity: tpl.severity,
      confidence: tpl.confidence,
      narrative: result.narrative,
      exploitability: tpl.exploitability,
      discoveredAt: Date.now(),
    };
    chains.push(chain);
  }
  return chains;
}

// ── LLM engine ───────────────────────────────────────────────────────────

export async function runLlmChains(
  findings: AppModelFinding[],
  llm: LlmInvoker,
  fetchImpl: typeof fetch = fetch,
): Promise<AttackChain[]> {
  if (findings.length === 0) return [];
  const systemPrompt = `You are a senior application security engineer. You are given a list of vulnerabilities found on a web application. Your job is to identify ATTACK CHAINS — sequences of 2+ findings that, when combined, escalate the overall impact beyond any single finding.

Output JSON only. Schema:
{
  "chains": [
    {
      "name": "Short descriptive name",
      "severity": "critical|high|medium|low|info",
      "confidence": <0-1>,
      "exploitability": "trivial|moderate|difficult",
      "narrative": "2-3 sentence explanation of the kill chain and its impact",
      "stepIndices": [<0-based indices into the input findings array, in order>]
    }
  ]
}

Rules:
- Only chain findings whose evidence is PRESENT in the input — never invent.
- If a single finding is severe enough, you may include it alone as a "single-link" chain, but prefer multi-step chains.
- Severity should reflect the COMBINED impact, not the max of individual findings.
- If no chains are possible, return an empty array.
- The output must be valid JSON. No commentary.`;

  const userPrompt = `## Findings\n\n${findings.map((f, i) => `### ${i}: ${f.type} @ ${f.endpoint}\n- severity: ${f.severity}\n- confidence: ${f.confidence}\n- evidence: ${f.evidence.map(e => e.data).join(' ').slice(0, 512)}\n`).join('\n')}\n\n## Your task\nIdentify the attack chains. Output JSON only.`;

  const requestBody = {
    model: llm.modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0,
    max_tokens: llm.maxTokens ?? 2000,
  };

  // Use OpenAI-compatible chat completions API
  const baseURL = llm.baseURL || 'https://api.openai.com/v1';
  const url = `${baseURL.replace(/\/$/, '')}/chat/completions`;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'authorization': `Bearer ${llm.apiKey}`,
  };
  if (llm.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://ultimatrix.dev';
    headers['X-Title'] = 'Ultimatrix';
  }

  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM call failed: ${response.status} ${errText.slice(0, 200)}`);
  }
  const j = await response.json();
  const content = j.choices?.[0]?.message?.content || '';
  // extract JSON from response (handle ```json fences)
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]+?)\s*```/) || [null, content];
  const json = jsonMatch[1] || content;
  let parsed: { chains: Array<{ name: string; severity: string; confidence: number; exploitability: string; narrative: string; stepIndices: number[] }> };
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`LLM returned invalid JSON: ${(e as Error).message}\n--- response ---\n${content.slice(0, 500)}`);
  }
  if (!parsed.chains) return [];
  return parsed.chains.map((c, i) => ({
    id: `chain-llm-${i}-${Date.now()}`,
    name: c.name,
    severity: (['critical', 'high', 'medium', 'low', 'info'].includes(c.severity) ? c.severity : 'medium') as AttackChain['severity'],
    confidence: c.confidence,
    narrative: c.narrative,
    exploitability: (['trivial', 'moderate', 'difficult'].includes(c.exploitability) ? c.exploitability : 'moderate') as AttackChain['exploitability'],
    steps: (c.stepIndices || []).map((idx, j) => {
      const f = findings[idx];
      if (!f) return { step: j + 1, findingType: 'unknown', endpoint: 'unknown', evidenceRef: '', description: 'LLM referenced non-existent finding' };
      return {
        step: j + 1,
        findingType: f.type,
        endpoint: f.endpoint,
        evidenceRef: f.evidence[0]?.label || `finding-${idx}`,
        description: f.evidence.map(e => e.data).join(' ').slice(0, 256),
      };
    }),
    discoveredAt: Date.now(),
  }));
}

// ── main entry point ─────────────────────────────────────────────────────

export async function runChainEngine(opts: ChainEngineOptions): Promise<ChainEngineResult> {
  const start = Date.now();
  const mode = opts.mode ?? (opts.llm ? 'llm' : 'heuristic');
  const minSeverity = opts.minSeverityForChain ?? 'low';
  let chains: AttackChain[] = [];

  if (mode === 'heuristic' || mode === 'hybrid') {
    chains = runHeuristicChains(opts.findings, minSeverity);
  }

  if ((mode === 'llm' || mode === 'hybrid') && opts.llm) {
    try {
      const llmChains = await runLlmChains(opts.findings, opts.llm);
      // merge: heuristic + LLM, dedupe by name similarity
      const existingNames = new Set(chains.map(c => c.name));
      for (const c of llmChains) {
        if (!existingNames.has(c.name)) chains.push(c);
      }
    } catch (e) {
      // LLM failed, fall back to heuristic only
      if (mode === 'llm') {
        chains = runHeuristicChains(opts.findings, minSeverity);
      }
    }
  }

  if (chains.length > 0) {
    updateAppModelSection(opts.appModelPath, 'attackChains', chains);
  }

  return { chains, mode, durationMs: Date.now() - start };
}
