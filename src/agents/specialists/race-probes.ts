// src/agents/specialists/race-probes.ts
//
// Deterministic probes for race conditions (TOCTOU).
//
// Strategy:
//   1. Identify candidate endpoints — any POST endpoint with body params
//      related to value transfer (amount, balance, transfer, withdraw,
//      coupon, redeem, invite, file upload, claim, vote, etc.)
//   2. Fire N requests in parallel and compare the success rate.
//   3. If the operation has a check-then-act pattern (e.g. coupon used?),
//      and N requests all succeed, the race is exploitable.

export interface RaceProbeConfig {
  target: string;
  endpoint: { path: string; method: string; body?: Record<string, unknown> };
  authToken?: string;
  parallel?: number;          // default 10
  headers?: Record<string, string>;
  timeoutMs?: number;         // default 5000
}

export interface RaceProbeResult {
  vulnerable: boolean;
  technique: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  confidence: number;
  successCount: number;
  totalCount: number;
  evidence: string[];
  payload: string;
  responseSummary: string;
  exploitability: 'trivial' | 'moderate' | 'difficult';
}

const TRANSFER_PARAM_PATTERNS = /^(amount|qty|quantity|price|balance|withdraw|deposit|transfer|discount|coupon|code|invite|file|claim|vote|points|credit|score)$/i;

export async function probeRaceCondition(config: RaceProbeConfig): Promise<RaceProbeResult> {
  const parallel = config.parallel ?? 10;
  const timeout = config.timeoutMs ?? 5000;
  const url = config.endpoint.path.startsWith('http') ? config.endpoint.path : `${config.target}${config.endpoint.path}`;
  const body = config.endpoint.body || {};
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'ultimatrix-race-probe/1.0',
    ...(config.headers || {}),
  };
  if (config.authToken) headers['authorization'] = `Bearer ${config.authToken}`;

  const requests: Promise<Response>[] = [];
  for (let i = 0; i < parallel; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    requests.push(
      fetch(url, {
        method: config.endpoint.method,
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'manual',
      }).finally(() => clearTimeout(timer)),
    );
  }

  const responses = await Promise.allSettled(requests);
  const bodies: string[] = [];
  let successCount = 0;
  for (const r of responses) {
    if (r.status === 'fulfilled') {
      const resp = r.value;
      const txt = await resp.text();
      bodies.push(`[${resp.status}] ${txt.slice(0, 256)}`);
      // 2xx is success
      if (resp.status >= 200 && resp.status < 300) successCount++;
    } else {
      bodies.push(`[error] ${r.reason}`);
    }
  }

  // race is exploitable if >1 request succeeded in parallel
  const vulnerable = successCount > 1;
  const successRate = successCount / parallel;
  const severity: RaceProbeResult['severity'] = successRate >= 0.5 ? 'critical' : successRate >= 0.2 ? 'high' : successRate > 0 ? 'medium' : 'info';
  const technique = inferTechnique(body);

  return {
    vulnerable,
    technique,
    severity: vulnerable ? severity : 'info',
    confidence: Math.min(0.95, successRate + 0.3),
    successCount,
    totalCount: parallel,
    evidence: [
      `${successCount}/${parallel} parallel requests succeeded (success rate ${(successRate * 100).toFixed(0)}%)`,
      `If successCount > 1, the operation is exploitable as a TOCTOU race.`,
      `Sample responses: ${bodies.slice(0, 3).join(' | ')}`,
    ],
    payload: JSON.stringify(body),
    responseSummary: `${successCount}/${parallel} succeeded`,
    exploitability: successRate >= 0.8 ? 'trivial' : successRate >= 0.4 ? 'moderate' : 'difficult',
  };
}

function inferTechnique(body: Record<string, unknown>): string {
  const keys = Object.keys(body).join(',').toLowerCase();
  if (TRANSFER_PARAM_PATTERNS.test(keys)) {
    if (/amount|balance|withdraw|transfer|credit|deposit|price/.test(keys)) return 'balance-race';
    if (/coupon|code|discount/.test(keys)) return 'coupon-race';
    if (/invite|claim/.test(keys)) return 'invite-race';
    if (/file|upload/.test(keys)) return 'upload-race';
    if (/vote|score|points/.test(keys)) return 'voting-race';
  }
  return 'generic-race';
}

export function findRaceCandidates(appModel: { endpoints: Array<{ path: string; method: string; params: Array<{ name: string; type: string }>; bodyFields?: Array<{ name: string }> }> }): Array<{ path: string; method: string; body: Record<string, unknown> }> {
  const candidates: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  for (const ep of appModel.endpoints || []) {
    if (ep.method !== 'POST') continue;
    const bodyKeys = [
      ...(ep.bodyFields || []).map(f => f.name),
      ...(ep.params || []).map(p => p.name),
    ];
    if (bodyKeys.some(k => TRANSFER_PARAM_PATTERNS.test(k))) {
      const body: Record<string, unknown> = {};
      for (const k of bodyKeys) {
        if (/amount|balance|withdraw|transfer|price/.test(k)) body[k] = 100;
        else if (/coupon|code/.test(k)) body[k] = 'PROMO50';
        else if (/invite/.test(k)) body[k] = 'invite-1';
        else if (/file/.test(k)) body[k] = 'test.txt';
        else body[k] = 'test';
      }
      candidates.push({ path: ep.path, method: ep.method, body });
    }
  }
  return candidates;
}
