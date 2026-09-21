---
name: cache-boundary-testing
description: "Test web cache poisoning and deception through cache-key, path-normalization, and response-privacy differentials without polluting shared users."
category: specialized
tier: powerful
toolRefs: [queryGraph, listCapturedRequests, replayCapturedRequest, httpRequest, compareResearchResponses, evaluateResearchExperiment, recordEvidence, recordFindingCandidate, writeFinding]
triggers: ["web cache poisoning", "web cache deception", "cache key", "CDN cache", "unkeyed header"]
contextBoosts: [web, cache]
owaspRefs: ["OWASP WSTG-CONF-06"]
compositionRules:
  enhances: [cache-poisoning, web-pentest, security-headers-audit]
requires:
  capabilities: [graph.query, network.request, response.compare, evidence.capture, finding.write]
procedure:
  stages:
    - id: baseline
      goal: Characterize cache headers, key hints, and actor-specific content.
    - id: isolate
      goal: Mutate one unkeyed input or path interpretation with a unique cache-buster.
    - id: clean-fetch
      goal: Compare the result from a clean context and stop on shared anomalies.
    - id: retest
      goal: Reproduce the cache boundary with fresh keys and evidence.
verification:
  coverage:
    - id: cache-differential
      required: true
    - id: cross-context-effect
      required: true
output:
  schema: CacheBoundaryConclusion
---

# Cache boundary testing

Separate poisoning (attacker-controlled content served to another clean client) from deception (private dynamic content stored as if static). Use a unique cache-buster on every probe and only disposable accounts/data.

## Procedure

1. Baseline a safe GET/HEAD and record cache headers, age, key hints, status, content type, and response timing.
2. Change one candidate unkeyed header, delimiter, extension, or path normalization detail while retaining the cache-buster.
3. Fetch the same key from a clean context and compare body, headers, and actor-specific markers.
4. Stop immediately if a response appears shared beyond the test context; do not continue poisoning.

```http
GET /account/profile;probe-<unique>.js HTTP/1.1
Host: target.example
Cache-Control: no-cache
```

The proof requires a cache hit/miss transition plus a cross-context content effect. `public` or `max-age` alone is not proof of a vulnerability.
