---
name: serverless-attacks
description: "Serverless function exploitation including Lambda/GCP/Azure Functions abuse, event injection, and environment theft"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["serverless", "lambda", "cloud functions", "azure functions", "function url", "serverless injection", "event injection", "cold start", "serverless security", "faas"]
contextBoosts: [api]
mitreAttack: ["T1190", "T1059"]
owaspRefs: ["OWASP Serverless Top 10", "OWASP Top 10 A03:2021 Injection"]
---

# Serverless Attacks

## When to Use

- Target exposes serverless functions via API Gateway, Function URLs, or HTTP triggers
- Lambda, GCP Cloud Functions, or Azure Functions are identified in responses, headers, or error messages
- Function invocations return verbose errors (stack traces, env dumps, cold-start artifacts)
- Event-driven architecture detected (SQS, S3, EventBridge, Pub/Sub triggers)
- You have captured event payloads or function configuration data

## Do Not Use

- Target is a traditional server — use `injection/` or `recon/recon.md` instead
- No serverless indicators found (no `x-amzn-*` headers, no `server: Google-Forwarded-Proxy`, no function stack traces)
- Engagement rules prohibit cloud-side testing or function invocation
- Functions are behind WAF with rate limiting that blocks repeated invocation attempts

---

## 1. Auth Context

Before attacking serverless functions, capture and validate all available invocation context.

### Capture Sequence


### Record Evidence

Log the following without logging secret values:
- Function ARN/name and region
- Runtime (python3.11, nodejs18.x, java17, dotnet6)
- Trigger type and endpoint URL
- IAM role ARN or service account email

---

## 2. Lambda Exploitation

### Environment Variable Theft

Lambda functions commonly store secrets in environment variables. Exploit via:

#### Via Verbose Error Messages


#### Via SSRF to Metadata Service


#### Via /proc/self/environ


### IAM Role Abuse

Lambda execution roles often have excessive permissions. Enumerate from inside the function:


### /tmp Persistence

Lambda functions have writable /tmp storage (512MB-10GB depending on config). Use for:


### Lambda Layer Hijacking


---

## 3. Event Injection

Craft malicious event payloads to manipulate function behavior.

### API Gateway Event Injection


### SQS Message Injection


### S3 Event Injection


### EventBridge / CloudWatch Event Injection


---

## 4. Function URL Attacks

Lambda Function URLs and Azure Direct Invocation bypass API Gateway entirely.

### Lambda Function URL Bypass


### Azure Functions Direct Invocation


### Bypassing API Gateway Authentication


---

## 5. GCP Cloud Functions Exploitation

### Metadata Access


### Service Account Abuse


### GCP Cloud Functions Source Code Extraction


---

## 6. Azure Functions Exploitation

### Host Key Theft


### ARM Template Injection


### Azure Function App Settings Theft


---

## 7. Persistent Backdoor

### Lambda Layer Injection for Persistence


### Event Source Mapping Persistence


### Cross-Account Lambda Invocation Persistence


---

## 8. Data Exfiltration

### DNS Exfiltration


### HTTP Exfiltration


### S3/Cloud Storage Exfiltration


### CloudWatch Logs Exfiltration


---

## 9. Anti-Hallucination

### Verify Before Claiming

- **Do not assume** a function is vulnerable — invoke it and verify the error response contains sensitive data
- **Do not assume** environment variables contain secrets — invoke and dump actual environment
- **Do not assume** a function URL is public — test without authentication headers
- **Do not assume** IAM role is overprivileged — use `simulate-principal-policy` with concrete actions
- **Do not assume** source code is accessible — attempt actual download from GCS bucket
- **Do not assume** a function persists — check if it's been decommissioned between invocations

### Evidence Requirements

Every finding must include:
1. The exact function ARN/name, region, and trigger endpoint
2. The invocation request and full response (redact secrets, keep structure)
3. The IAM role ARN or service account email attached to the function
4. The specific overprivileged permission and its AWS/GCP/Azure ARN
5. Timestamp of invocation and cold-start indicators (duration headers)

### Reject Hallucinated Findings

If you cannot invoke the function (403, timeout, function not found), mark the finding as **unverified**. Do not claim a vulnerability exists based on inference alone. The EvidenceGate will reject findings without concrete invocation response evidence.
