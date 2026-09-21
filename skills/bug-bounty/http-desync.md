---
name: http-desync
description: "Research HTTP request smuggling, HTTP/2 downgrade, CL.0, and response-queue desynchronization only when the transport and scope support bounded canary tests."
category: specialized
tier: powerful
toolRefs: [queryGraph, getCaptureOverview, listCapturedRequests, replayCapturedRequest, httpRequest, compareResearchResponses, evaluateResearchExperiment, recordEvidence, recordFindingCandidate, writeFinding]
triggers: ["request smuggling", "HTTP desync", "CL.0", "HTTP/2 downgrade", "response queue poisoning"]
contextBoosts: [web, network]
owaspRefs: ["OWASP WSTG-CONF-15"]
compositionRules:
  enhances: [http-smuggling, cache-boundary-testing, web-pentest]
requires:
  capabilities: [graph.query, network.request, response.compare, evidence.capture, finding.write]
procedure:
  stages:
    - id: capability
      goal: Confirm raw framing, connection reuse, proxy/origin topology, and scope.
    - id: canary
      goal: Run one bounded non-sensitive framing differential.
    - id: impact
      goal: Stop on shared-response anomalies and assess only authorized impact.
    - id: retest
      goal: Reproduce parser disagreement without collateral traffic.
verification:
  coverage:
    - id: transport-capability
      required: true
    - id: parser-differential
      required: true
output:
  schema: HttpDesyncConclusion
---

# HTTP desynchronization

This scenario requires a transport capable of preserving raw framing and connection reuse. A high-level fetch/replay tool that normalizes `Content-Length` and `Transfer-Encoding` cannot prove smuggling; record that capability limitation and do not substitute a malformed request.

## Safe procedure

1. Confirm proxy/origin topology, protocol versions, connection reuse, and explicit program authorization.
2. Use a unique canary and a disposable endpoint. Start with a non-sensitive differential that should fail closed.
3. Change one framing interpretation at a time and observe only your own follow-up request.
4. Stop on any shared-response anomaly; never intentionally poison other users or run volumetric probes.
5. Promote only when parser disagreement and the security impact are independently reproducible.

```text
required capability: raw HTTP/1 framing + controlled connection reuse
not proof: a 400/408/502, a generic timeout, or a proxy error
```
