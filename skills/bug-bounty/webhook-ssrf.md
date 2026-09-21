---
name: webhook-ssrf
description: "Verify server-side request behavior in webhooks, URL importers, previews, PDF renderers, and callback validators using approved OAST evidence."
category: specialized
tier: powerful
toolRefs: [queryGraph, listCapturedRequests, replayCapturedRequest, httpRequest, getOastUrlTool, checkOastCallbacks, compareResearchResponses, evaluateResearchExperiment, recordEvidence, recordFindingCandidate, writeFinding]
triggers: ["webhook SSRF", "URL fetch", "import URL", "PDF SSRF", "callback validation", "blind SSRF"]
contextBoosts: [web, api, cloud]
owaspRefs: ["OWASP WSTG-INPV-19", "OWASP API7:2023 Server Side Request Forgery"]
compositionRules:
  enhances: [blind-ssrf, cloud-metadata, api-security]
requires:
  capabilities: [graph.query, network.request, response.compare, evidence.capture, finding.write]
procedure:
  stages:
    - id: identify-fetch
      goal: Bind a caller-controlled URL to a server-side fetch boundary.
    - id: oast
      goal: Execute one approved OAST correlation probe.
    - id: impact
      goal: Assess only the minimum authorized impact and stop.
    - id: retest
      goal: Reproduce the callback with a fresh correlation token.
verification:
  coverage:
    - id: server-side-callback
      required: true
    - id: fresh-correlation
      required: true
output:
  schema: WebhookSsrFConclusion
---

# Webhook and URL-fetch SSRF

Use an approved OAST endpoint and a unique correlation token. Do not probe cloud metadata, internal ranges, or third-party systems unless the engagement explicitly authorizes that destination.

## Procedure

1. Identify a captured request whose server-side behavior accepts a URL, callback, import, preview, or document source.
2. Establish a normal external URL baseline and record response/status/timing.
3. Replace only the URL with a fresh OAST URL; preserve method, body, and auth context.
4. Check the OAST callback log and correlate method, timestamp, DNS/HTTP interaction, and token.
5. If confirmed, stop at the minimum proof. A callback proves server-side fetch, not internal compromise; report impact separately and conservatively.

```text
baseline: source=https://approved.example/marker
mutation: source=https://<oast-host>/<unique-token>
oracle: matching callback with target correlation token
```
