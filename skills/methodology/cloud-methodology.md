---
name: cloud-methodology
description: "Structured methodology for cloud security testing — IAM, storage, serverless, container, Kubernetes"
category: methodology
tier: balanced
toolRefs: [httpRequest, parseResponse, loadSkillReference, writeFinding, updateGraph, encodeDecode, runPrimitive, searchSkills]
triggers: ["cloud", "aws", "azure", "gcp", "kubernetes", "docker", "serverless", "iam", "cloud security"]
---

# Cloud Security Testing Methodology

## Phase 1: Cloud Surface Mapping

1. **Provider identification** — Detect cloud provider from response headers, error messages, metadata endpoints.
2. **Metadata endpoints** — Test `http://169.254.169.254/latest/meta-data/` (AWS), `http://169.254.169.254/metadata/instance` (Azure), `http://metadata.google.internal/computeMetadata/v1/` (GCP).
3. **Service enumeration** — Map observed services: S3, Lambda, ECS, EKS, Azure Functions, Cloud Run, GKE.
4. **Configuration disclosure** — Check for exposed config files, environment variables, cloud metadata in responses.

## Phase 2: Identity & Access Management

### IAM Policy Analysis
1. **Privilege escalation paths** — Can a low-priv user assume higher-priv roles? Test `sts:AssumeRole`, `iam:PassRole`.
2. **Cross-account access** — Test cross-account role assumption, federated identity abuse.
3. **Service account abuse** — Test impersonation of service accounts, metadata-based token acquisition.

### Authentication Testing
1. **Credential exposure** — Scan for hardcoded AWS keys (`AKIA...`), GCP service account keys, Azure connection strings.
2. **Token abuse** — Test with expired tokens, wrong scopes, stolen metadata tokens.
3. **MFA bypass** — Test if privileged operations bypass MFA requirements.

## Phase 3: Storage Security

### Object Storage (S3, Blob, GCS)
1. **Public access** — Test listing, reading, writing without authentication.
2. **Bucket policies** — Analyze for overly permissive `Principal` or `Resource` patterns.
3. **ACL bypass** — Test ACL inheritance, pre-signed URL generation, temporary credential abuse.
4. **Static hosting** — Test for XSS via HTML/JS file upload to public buckets.

### Database Services
1. **Public exposure** — Test if RDS, CosmosDB, Cloud SQL are accessible from public internet.
2. **Encryption at rest** — Verify encryption is enabled and keys are customer-managed (not default).
3. **Backup exposure** — Test if automated backups are accessible.

## Phase 4: Serverless & Container

### Serverless (Lambda, Azure Functions, Cloud Run)
1. **Environment variable leakage** — Test for secrets in env vars visible through error messages or SSRF.
2. **Layer/module exposure** — Test if deployed code reveals dependencies, versions, internal paths.
3. **Event injection** — Craft malicious events (S3 event, API Gateway event, queue message) to trigger unexpected behavior.
4. **Cold start timing** — Use timing to infer function internals.

### Containers & Kubernetes
1. **Registry access** — Test if container registries are publicly accessible.
2. **Image scanning** — Identify known CVEs in base images.
3. **Kubernetes API** — Test unauthenticated access to `/api/v1`, `/apis`, `/healthz`.
4. **RBAC bypass** — Test role bindings, service account permissions, pod security policies.
5. **Secrets exposure** — Check mounted secrets, environment variables, ConfigMaps.

## Phase 5: Infrastructure as Code

1. **Terraform state** — Test if state files are publicly accessible (S3 backend).
2. **CloudFormation** — Test for template injection, parameter exposure.
3. **CI/CD pipelines** — Test for credential leakage in build logs, artifact exposure.

## Phase 6: Network & Perimeter

1. **VPC/VNet misconfigurations** — Test for overly permissive security groups, NACLs.
2. **Load balancer exposure** — Test if internal services are exposed via misconfigured LBs.
3. **DNS exfiltration** — Test if DNS queries can be used for data exfiltration.
4. **Private endpoint bypass** — Test if private endpoints can be accessed from public networks.

## Exploitation & Proof

For each confirmed finding:
1. Document the exact path to exploitation (steps, credentials, configuration)
2. Assess blast radius (single resource vs. entire account/tenant)
3. Structured evidence via `writeFinding`
4. Remediation: specific IAM policy, configuration change, or architectural fix

## Anti-Patterns

- Do not assume cloud services are secure by default
- Do not skip metadata endpoint testing (SSRF → credentials)
- Do not ignore cross-service trust relationships
- Do not test production accounts without explicit authorization
- Do not delete or modify resources — read-only testing unless explicitly authorized
