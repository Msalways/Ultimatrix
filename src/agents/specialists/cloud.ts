// src/agents/specialists/cloud.ts
//
// Cloud-metadata SSRF specialist — tests for SSRF that reaches the AWS IMDS,
// GCP metadata, or Azure IMDS endpoint. When IAM credentials are leaked, it
// enumerates S3 buckets as proof of full account takeover.
//
// Selection heuristic: include when:
//   - Any cloudProbes entry in appModel
//   - Any endpoint has SSRF-prone param (url, uri, callback, webhook, fetch, ...)
//   - appModel.frameworks includes 'aws', 'gcp', or 'azure' hints
//
// Output:
//   - Finding: ssrf-cloud-metadata (severity critical)
//   - Chain step: SSRF → AWS creds → S3 enumeration

import type { AppModel } from '../../core/app-model';
import type { SpecialistFactory } from './types';
import { probeCloudMetadata, enumerateS3WithCreds, type CloudProbeConfig, type CloudProbeResult } from './cloud-probes';

const CLOUD_SYSTEM_PROMPT = `You are a cloud-metadata SSRF specialist. Your job is to determine if the target's SSRF surface can reach the cloud metadata service (AWS IMDSv1/v2, GCP metadata, Azure IMDS), extract IAM credentials, and pivot to S3 / storage.

## Output (call conclude when done)
{
  "vulnerable": boolean,
  "confidence": <0-1>,
  "vulnerability": "<aws-imdsv1|aws-imdsv2|gcp-meta|azure-imds|none>",
  "evidence": ["<verbatim response snippets with AccessKeyId, project-id, etc.>"],
  "iamCredentials": { "accessKeyId": "...", "secretAccessKey": "...", "token": "..." },
  "s3Buckets": ["<bucket names enumerated>"],
  "payloads": ["<the metadata URLs probed>"],
  "summary": "<one paragraph explaining the kill chain>"
}

## Available tools (deterministic, no LLM needed)
- cloud_run_probes: probes SSRF surface for AWS IMDSv1, IMDSv2, GCP, Azure in parallel. Returns the raw responses.
- cloud_enumerate_s3: takes IAM creds from a successful probe, signs an S3 ListBuckets request, returns bucket names. Call this AFTER cloud_run_probes if creds were found.
- conclude: emit the verdict

## Approach
1. Call cloud_run_probes ONCE with the discovered SSRF surface path.
2. Read the results. If any provider returned status='leaked', the metadata is reachable.
3. If AWS creds are present (imdsv1 result), call cloud_enumerate_s3 with the creds to prove full account takeover.
4. The combined evidence (SSRF + creds + S3 buckets) is a critical kill chain. Report it.
5. Call conclude() with the verdict.

## Style rules
- Never use "exploit", "attack", "payload", "injection". Use "test", "probe", "check".
- Quote AccessKeyId / project-id / subscriptionId values verbatim.
- If no SSRF surface was discovered, conclude vulnerable=false with reason 'no SSRF surface in app-model'.`;

export async function runAllCloudProbes(
  config: CloudProbeConfig,
): Promise<{ results: CloudProbeResult[]; summary: { leaked: number; blocked: number; inconclusive: number } }> {
  const results = await probeCloudMetadata(config);
  return {
    results,
    summary: {
      leaked: results.filter(r => r.status === 'leaked').length,
      blocked: results.filter(r => r.status === 'blocked').length,
      inconclusive: results.filter(r => r.status === 'inconclusive').length,
    },
  };
}

export const cloudSpecialist: SpecialistFactory = {
  name: 'cloud-specialist',
  description: 'Cloud metadata SSRF: AWS IMDSv1/v2, GCP metadata, Azure IMDS. S3 enumeration with stolen creds.',
  build: (tools) => {
    const cloudProbeTool = {
      name: 'cloud_run_probes',
      description: 'Probe SSRF surface for AWS IMDSv1, IMDSv2, GCP metadata, Azure IMDS in parallel.',
      invoke: async (input: { config: CloudProbeConfig }) => {
        return JSON.stringify(await runAllCloudProbes(input.config));
      },
    };
    const s3EnumTool = {
      name: 'cloud_enumerate_s3',
      description: 'Use stolen AWS creds to enumerate S3 buckets. Returns the list of bucket names.',
      invoke: async (input: { accessKeyId: string; secretAccessKey: string; sessionToken: string; region?: string }) => {
        return JSON.stringify(await enumerateS3WithCreds(input.accessKeyId, input.secretAccessKey, input.sessionToken, input.region));
      },
    };
    return {
      name: 'cloud-specialist',
      description: 'Cloud metadata SSRF: AWS IMDSv1/v2, GCP metadata, Azure IMDS. S3 enumeration with stolen creds.',
      systemPrompt: CLOUD_SYSTEM_PROMPT,
      tools: [cloudProbeTool, s3EnumTool, tools.scratchpadWrite, tools.scratchpadRead, tools.conclude],
    };
  },
  shouldInclude: (appModel: AppModel) => {
    if ((appModel.cloudProbes || []).length > 0) return true;
    if ((appModel.frameworks || []).some(f => /aws|gcp|azure|gce|cloud/i.test(f.name))) return true;
    const SSRF_PARAM = /^(url|uri|callback|webhook|fetch|load|proxy|img|preview)$/i;
    return (appModel.endpoints || []).some((e) => (e.params || []).some((p) => SSRF_PARAM.test(p.name)));
  },
};
