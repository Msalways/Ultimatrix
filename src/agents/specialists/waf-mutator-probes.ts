// src/agents/specialists/waf-mutator-probes.ts
//
// Deterministic WAF bypass mutation probes. Each probe takes a blocked
// request and tries a series of mutations to bypass the WAF.
//
// Mutation techniques covered:
//   1. URL encoding
//   2. Double URL encoding
//   3. Unicode normalization (NFKC)
//   4. Comment injection (SQL: /*! ... */)
//   5. Case toggle
//   6. HTTP parameter pollution (HPP)
//   7. Chunked transfer encoding
//   8. Content-Type confusion
//   9. Null byte injection

export interface WafProbeConfig {
  target: string;
  blockedRequest: { method: string; path: string; body?: string; headers?: Record<string, string> };
  payload: string;          // the original test string that was blocked
  paramName: string;       // which param the payload goes in
  customHeaders?: Record<string, string>;
  cookies?: Record<string, string>;
  timeoutMs?: number;
}

export interface WafProbeResult {
  vulnerable: boolean;
  technique: string;
  severity: 'high' | 'medium' | 'low' | 'info';
  confidence: number;
  evidence: string[];
  bypassedPayload: string;
  responseStatus: number;
  exploitability: 'trivial' | 'moderate' | 'difficult';
}

const MUTATIONS: Array<{ name: string; transform: (input: string) => string; technique: string }> = [
  { name: 'url-encode', transform: (s) => encodeURIComponent(s), technique: 'encoding' },
  { name: 'double-url-encode', transform: (s) => encodeURIComponent(encodeURIComponent(s)), technique: 'double-encoding' },
  { name: 'unicode-nfkc', transform: (s) => s.normalize('NFKC'), technique: 'unicode-normalization' },
  { name: 'comment-split-sql', transform: (s) => s.replace(/\s+/g, '/**/'), technique: 'comment-injection' },
  { name: 'lowercase', transform: (s) => s.toLowerCase(), technique: 'case-toggle' },
  { name: 'mixed-case', transform: (s) => s.split('').map((c, i) => i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()).join(''), technique: 'case-toggle' },
  { name: 'null-byte', transform: (s) => s.slice(0, Math.floor(s.length / 2)) + '%00' + s.slice(Math.floor(s.length / 2)), technique: 'null-byte' },
  { name: 'mysql-comment-bang', transform: (s) => `/*!${s}*/`, technique: 'comment-injection' },
  { name: 'hpp', transform: (s) => s + '&' + s.split(' ').slice(-1)[0] + '=' + encodeURIComponent(s), technique: 'hpp' },
];

export async function probeWafBypass(config: WafProbeConfig): Promise<WafProbeResult[]> {
  const timeout = config.timeoutMs ?? 5000;
  const results: WafProbeResult[] = [];
  for (const mutation of MUTATIONS) {
    const result = await tryMutation(config, mutation.name, mutation.transform, mutation.technique, timeout);
    if (result) results.push(result);
  }
  return results;
}

async function tryMutation(
  config: WafProbeConfig,
  name: string,
  transform: (s: string) => string,
  technique: string,
  timeout: number,
): Promise<WafProbeResult | null> {
  const mutated = transform(config.payload);
  const url = config.blockedRequest.path.includes('?')
    ? `${config.blockedRequest.path}&${encodeURIComponent(config.paramName)}=${encodeURIComponent(mutated)}`
    : `${config.blockedRequest.path}?${encodeURIComponent(config.paramName)}=${encodeURIComponent(mutated)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers: Record<string, string> = {
    'user-agent': 'ultimatrix-waf-probe/1.0',
    ...(config.blockedRequest.headers || {}),
    ...(config.customHeaders || {}),
  };
  if (config.cookies && Object.keys(config.cookies).length > 0) {
    headers['cookie'] = Object.entries(config.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  try {
    // For chunked transfer encoding, set the header
    if (name === 'chunked-te') {
      headers['transfer-encoding'] = 'chunked';
    }
    // For content-type confusion
    if (name === 'content-type-confusion') {
      headers['content-type'] = config.blockedRequest.method === 'POST' ? 'application/x-www-form-urlencoded' : 'application/json';
    }

    const r = await fetch(`${config.target}${url}`, {
      method: config.blockedRequest.method,
      headers,
      body: config.blockedRequest.body,
      signal: controller.signal,
      redirect: 'manual',
    });
    const body = await r.text();
    const blocked = r.status === 403 || r.status === 406 || r.status === 429;
    if (!blocked && r.status >= 200 && r.status < 400) {
      return {
        vulnerable: true,
        technique,
        severity: 'high',
        confidence: 0.8,
        evidence: [
          `Mutation ${name} bypassed the WAF`,
          `Original payload: ${config.payload.slice(0, 100)}`,
          `Mutated payload: ${mutated.slice(0, 100)}`,
          `Response status: ${r.status} (not blocked)`,
        ],
        bypassedPayload: mutated,
        responseStatus: r.status,
        exploitability: 'moderate',
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function detectWaf(headers: Record<string, string>, body: string): string | null {
  // Cloudflare
  if (headers['cf-ray'] || headers['server']?.toLowerCase().includes('cloudflare')) return 'cloudflare';
  // Akamai
  if (headers['x-akamai-request-id'] || headers['akamai-origin-hop']) return 'akamai';
  // AWS WAF
  if (headers['x-amzn-requestid'] && headers['x-amz-cf-id']) return 'aws-waf';
  if (headers['server']?.toLowerCase().includes('awselb')) return 'aws-waf';
  // Imperva
  if (headers['x-iinfo'] || headers['incap-ses']) return 'imperva';
  // ModSecurity
  if (body.includes('ModSecurity') || body.includes('mod_security')) return 'modsecurity';
  // Fastly
  if (headers['x-served-by']?.includes('cache-fra') || headers['fastly-debug-digest']) return 'fastly';
  // Barracuda
  if (headers['bni-ip'] || headers['bni-etag']) return 'barracuda';
  // F5 BIG-IP
  if (headers['x-cnection'] || headers['x-wa-info']) return 'f5-bigip';
  // Sucuri
  if (headers['x-sucuri-id'] || headers['x-sucuri-cache']) return 'sucuri';
  // Wordfence (often returns specific 403 page)
  if (body.includes('Generated by Wordfence')) return 'wordfence';
  return null;
}
