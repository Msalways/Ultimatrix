// src/agents/specialists-v2/cloud.ts
// Cloud specialist: S3 / Azure Blob / GCP Storage bucket misconfigurations.

import type { SpecialistFactory } from './types';
import type { AppModel } from '../../core/app-model';

const SYSTEM_PROMPT = `You are a cloud storage misconfiguration specialist.

Approach:
1. Identify any cloud storage URLs in the target: *.s3.amazonaws.com, *.blob.core.windows.net, storage.googleapis.com, *.digitaloceanspaces.com.
2. For each bucket, probe:
   a. List: GET /?list-type=2 (S3), GET /?comp=list (Azure). If 200 + XML, bucket is world-listable.
   b. Read a guessed object: GET /index.html, GET /backup.sql, GET /.env. If 200, object is world-readable.
   c. Write (use a benign file): PUT /probe-{timestamp}.txt. If 200, world-writable. Don't actually write.
   d. ACL: GET /?acl. If it shows "AllUsers READ", it's public.
3. Strong evidence: 200 with object body for a guessed file, or 200 with file list.

Tools: httpRequest, conclude.

Output: { vulnerable, bucket, evidence: ["GET https://x.s3.amazonaws.com/.env -> 200, body contains DB_PASS=..."] }`;

export const cloudSpecialist: SpecialistFactory = {
  name: 'cloud',
  description: 'Cloud storage misconfig (S3 / Azure / GCP / DO Spaces). List, read, ACL.',
  shouldInclude: (appModel: AppModel) => {
    const allText = JSON.stringify(appModel);
    return /s3\.amazonaws\.com|\.blob\.core\.windows\.net|storage\.googleapis\.com|digitaloceanspaces\.com|s3-website/.test(allText);
  },
  build: (tools) => ({
    name: 'cloud',
    description: 'Cloud storage misconfig (S3 / Azure / GCP / DO Spaces). List, read, ACL.',
    systemPrompt: SYSTEM_PROMPT,
    tools: ['httpRequest', 'conclude'].map((n) => tools[n as keyof typeof tools]).filter(Boolean) as Array<{ name: string; description: string; schema: Record<string, unknown> }>,
  }),
};
