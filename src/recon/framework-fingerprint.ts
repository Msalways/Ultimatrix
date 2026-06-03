// src/recon/framework-fingerprint.ts
//
// Detects the application framework from response headers, HTML, and
// well-known cookie/path signals. Writes into `appModel.frameworks[]` and
// also extends `appModel.techStack` for the existing tech-stack list.

import { readAppModel, updateAppModelSection, type FrameworkInfo } from '../core/app-model';
import { logReconEntry } from './index';

interface FrameworkSignature {
  name: string;
  patterns: Array<{ kind: 'header' | 'cookie' | 'path' | 'html' | 'script'; key: string; value: RegExp }>;
  version?: { kind: 'header' | 'html'; key: string; re: RegExp; group: number };
}

const SIGNATURES: FrameworkSignature[] = [
  {
    name: 'next.js',
    patterns: [
      { kind: 'header', key: 'x-powered-by', value: /^Next\.js$/i },
      { kind: 'html', key: '__NEXT_DATA__', value: /__NEXT_DATA__/ },
      { kind: 'path', key: '/_next/', value: /\/_next\// },
      { kind: 'script', key: '_next/static', value: /\/_next\/static/ },
    ],
  },
  {
    name: 'react',
    patterns: [
      { kind: 'html', key: 'data-reactroot', value: /data-reactroot/i },
      { kind: 'script', key: 'react', value: /react/i },
    ],
  },
  {
    name: 'vue',
    patterns: [
      { kind: 'html', key: 'data-v-', value: /data-v-[a-f0-9]+/ },
      { kind: 'script', key: 'vue', value: /vue/i },
    ],
  },
  {
    name: 'angular',
    patterns: [
      { kind: 'html', key: 'ng-version', value: /ng-version=/ },
      { kind: 'html', key: '_ngcontent', value: /_ngcontent/ },
    ],
  },
  {
    name: 'django',
    patterns: [
      { kind: 'header', key: 'x-frame-options', value: /DENY/i },
      { kind: 'cookie', key: 'csrftoken', value: /.*/ },
      { kind: 'cookie', key: 'sessionid', value: /.*/ },
      { kind: 'html', key: 'csrfmiddlewaretoken', value: /csrfmiddlewaretoken/ },
    ],
  },
  {
    name: 'rails',
    patterns: [
      { kind: 'header', key: 'x-runtime', value: /.*/ },
      { kind: 'header', key: 'x-request-id', value: /.*/ },
      { kind: 'cookie', key: '_session_id', value: /.*/ },
    ],
  },
  {
    name: 'express',
    patterns: [
      { kind: 'header', key: 'x-powered-by', value: /Express/i },
      { kind: 'cookie', key: 'connect.sid', value: /.*/ },
    ],
  },
  {
    name: 'fastify',
    patterns: [
      { kind: 'header', key: 'x-powered-by', value: /Fastify/i },
    ],
  },
  {
    name: 'spring',
    patterns: [
      { kind: 'header', key: 'x-application-context', value: /.*/ },
      { kind: 'cookie', key: 'JSESSIONID', value: /.*/ },
      { kind: 'html', key: 'org.springframework', value: /org\.springframework/ },
    ],
  },
  {
    name: 'laravel',
    patterns: [
      { kind: 'cookie', key: 'XSRF-TOKEN', value: /.*/ },
      { kind: 'cookie', key: 'laravel_session', value: /.*/ },
    ],
  },
  {
    name: 'flask',
    patterns: [
      { kind: 'header', key: 'server', value: /Werkzeug/i },
      { kind: 'cookie', key: 'session', value: /.*/ },
    ],
  },
  {
    name: 'fastapi',
    patterns: [
      { kind: 'header', key: 'server', value: /uvicorn/i },
      { kind: 'path', key: '/docs', value: /\/docs/ },
      { kind: 'path', key: '/openapi.json', value: /\/openapi\.json/ },
    ],
  },
  {
    name: 'asp.net',
    patterns: [
      { kind: 'header', key: 'x-aspnet-version', value: /.*/ },
      { kind: 'header', key: 'x-aspnetmvc-version', value: /.*/ },
      { kind: 'cookie', key: 'ASP.NET_SessionId', value: /.*/ },
    ],
  },
  {
    name: 'phoenix',
    patterns: [
      { kind: 'cookie', key: '_csrf_token', value: /.*/ },
    ],
  },
  {
    name: 'gin',
    patterns: [
      { kind: 'header', key: 'server', value: /Gin/i },
    ],
  },
];

export async function runFrameworkFingerprint(
  target: string,
  appModelPath: string,
  timeoutMs: number = 5000,
  customHeaders?: Record<string, string>,
  cookies?: Record<string, string>,
): Promise<{ frameworks: FrameworkInfo[] }> {
  const start = Date.now();
  const model = readAppModel(appModelPath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    'user-agent': 'ultimatrix-recon/1.0',
    'accept': 'text/html,application/json',
    ...(customHeaders || {}),
  };
  if (cookies && Object.keys(cookies).length > 0) {
    headers['cookie'] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  let responseHeaders: Record<string, string> = {};
  let html = '';
  let scripts: string[] = [];
  try {
    const r = await fetch(target, { signal: controller.signal, headers, redirect: 'manual' });
    responseHeaders = {};
    r.headers.forEach((v, k) => { responseHeaders[k.toLowerCase()] = v; });
    html = await r.text();
    scripts = Array.from(html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)).map(m => m[1]);
  } catch {
    // unreachable
  } finally {
    clearTimeout(timer);
  }

  const cookiesLower: Record<string, string> = {};
  for (const [k, v] of Object.entries(model.cookies || {})) cookiesLower[k.toLowerCase()] = v;

  const detected: FrameworkInfo[] = [];
  for (const sig of SIGNATURES) {
    const hints: string[] = [];
    for (const p of sig.patterns) {
      let match = false;
      if (p.kind === 'header' && responseHeaders[p.key] && p.value.test(responseHeaders[p.key])) {
        match = true;
        hints.push(`header ${p.key}=${responseHeaders[p.key]}`);
      } else if (p.kind === 'html' && p.value.test(html)) {
        match = true;
        hints.push(`html contains ${p.key}`);
      } else if (p.kind === 'path' && p.value.test(target)) {
        match = true;
        hints.push(`URL path ${p.key}`);
      } else if (p.kind === 'script' && scripts.some(s => p.value.test(s))) {
        match = true;
        hints.push(`script src ${p.value}`);
      } else if (p.kind === 'cookie' && cookiesLower[p.key]) {
        match = true;
        hints.push(`cookie ${p.key}`);
      }
      if (match) break;
    }
    if (hints.length > 0) {
      detected.push({
        name: sig.name,
        evidence: hints.join('; '),
        discoveredAt: Date.now(),
        hints,
      });
    }
  }

  if (detected.length > 0) {
    updateAppModelSection(appModelPath, 'frameworks', detected);
    // also extend techStack array for the existing tech-stack list
    const techStack = Array.from(new Set([...(model.techStack || []), ...detected.map(d => d.name)]));
    updateAppModelSection(appModelPath, 'techStack', techStack);
  }

  logReconEntry(appModelPath, {
    tool: 'framework-fingerprint',
    target,
    status: detected.length > 0 ? 'found' : 'not-found',
    durationMs: Date.now() - start,
    detail: detected.map(d => d.name).join(', ') || 'no frameworks detected',
  });

  return { frameworks: detected };
}
