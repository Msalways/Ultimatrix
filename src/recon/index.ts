// src/recon/index.ts
//
// Recon layer — pre-attack discovery that finds endpoints the HTML spider
// misses. Each tool reads the target URL + the current AppModel and writes
// its findings into typed sections (oauthProviders, graphqlEndpoints,
// jwtTokens, frameworks, cloudProbes).
//
// Tools:
//   - oauth-discovery:        .well-known/openid-configuration + IdP list
//   - graphql-discovery:      /graphql introspection + field-level authz hints
//   - jwt-discovery:          decode tokens in cookies/headers/storage (no verify)
//   - framework-fingerprint:  detect Next.js/Django/Rails/Spring/Express/etc.
//   - cloud-metadata-probe:   SSRF to AWS/GCP/Azure metadata via OAST callback
//
// Usage:
//   import { runRecon } from './recon';
//   await runRecon({ target: 'https://x', appModel, appModelPath, session, oastBaseUrl });

import { readAppModel, updateAppModelSection, writeAppModelAsync } from '../core/app-model';
import { runOauthDiscovery } from './oauth-discovery';
import { runGraphqlDiscovery } from './graphql-discovery';
import { runJwtDiscovery } from './jwt-discovery';
import { runFrameworkFingerprint } from './framework-fingerprint';
import { runCloudMetadataProbe } from './cloud-metadata-probe';

export interface ReconOptions {
  target: string;
  appModelPath: string;
  oastBaseUrl?: string;        // e.g. http://127.0.0.1:8765  (OAST callback base)
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  perProbeTimeoutMs?: number;
  parallel?: boolean;
}

export interface ReconResult {
  oauthProviders: number;
  graphqlEndpoints: number;
  jwtTokens: number;
  frameworks: number;
  cloudProbes: number;
  durationMs: number;
  errors: string[];
}

export async function runRecon(opts: ReconOptions): Promise<ReconResult> {
  const start = Date.now();
  const errors: string[] = [];
  const timeout = opts.perProbeTimeoutMs ?? 5000;

  const tasks: Array<{ name: string; run: () => Promise<void> }> = [
    { name: 'oauth-discovery',        run: async () => { await runOauthDiscovery(opts.target, opts.appModelPath, timeout, opts.headers, opts.cookies).catch(e => errors.push(`oauth: ${e.message}`)); } },
    { name: 'graphql-discovery',      run: async () => { await runGraphqlDiscovery(opts.target, opts.appModelPath, timeout, opts.headers, opts.cookies).catch(e => errors.push(`graphql: ${e.message}`)); } },
    { name: 'jwt-discovery',          run: async () => { await runJwtDiscovery(opts.appModelPath, timeout).catch(e => errors.push(`jwt: ${e.message}`)); } },
    { name: 'framework-fingerprint',  run: async () => { await runFrameworkFingerprint(opts.target, opts.appModelPath, timeout, opts.headers, opts.cookies).catch(e => errors.push(`framework: ${e.message}`)); } },
    { name: 'cloud-metadata-probe',   run: async () => { await runCloudMetadataProbe(opts.target, opts.appModelPath, timeout, opts.oastBaseUrl, opts.headers, opts.cookies).catch(e => errors.push(`cloud: ${e.message}`)); } },
  ];

  if (opts.parallel !== false) {
    await Promise.all(tasks.map(t => t.run()));
  } else {
    for (const t of tasks) await t.run();
  }

  const model = readAppModel(opts.appModelPath);
  await writeAppModelAsync(opts.appModelPath, model);
  return {
    oauthProviders: model.oauthProviders.length,
    graphqlEndpoints: model.graphqlEndpoints.length,
    jwtTokens: model.jwtTokens.length,
    frameworks: model.frameworks.length,
    cloudProbes: model.cloudProbes.length,
    durationMs: Date.now() - start,
    errors,
  };
}

export { runOauthDiscovery, runGraphqlDiscovery, runJwtDiscovery, runFrameworkFingerprint, runCloudMetadataProbe };

export function logReconEntry(
  appModelPath: string,
  entry: { tool: ReconLogEntry['tool']; target: string; status: ReconLogEntry['status']; durationMs: number; detail: string },
): void {
  updateAppModelSection(appModelPath, 'reconLog', [{
    timestamp: Date.now(),
    tool: entry.tool,
    target: entry.target,
    status: entry.status,
    durationMs: entry.durationMs,
    detail: entry.detail,
  }]);
}

export type ReconLogEntry = import('../core/app-model').ReconLogEntry;
