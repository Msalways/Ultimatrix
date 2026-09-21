---
name: web-message-boundaries
description: "Test postMessage, DOM sinks, client-side storage, and browser trust boundaries for exploitable cross-origin data or action flows."
category: specialized
tier: balanced
toolRefs: [queryGraph, getCaptureOverview, listCapturedRequests, httpRequest, replayCapturedRequest, evaluateRendered, compareResearchResponses, evaluateResearchExperiment, recordEvidence, recordFindingCandidate, writeFinding]
triggers: ["postMessage", "DOM XSS", "client-side trust boundary", "XS-Leaks", "DOM clobbering", "browser message"]
contextBoosts: [web, browser]
owaspRefs: ["OWASP WSTG-CLNT-11", "OWASP WSTG-CLNT-DOM"]
compositionRules:
  enhances: [modern-xss, open-redirect, cors-misconfig, clickjacking]
requires:
  capabilities: [graph.query, network.request, response.compare, evidence.capture, finding.write]
procedure:
  stages:
    - id: source-sink
      goal: Identify an untrusted source, validation boundary, and security-relevant sink.
    - id: marker
      goal: Use a harmless marker to prove data flow before any context probe.
    - id: effect
      goal: Observe the browser or cross-origin security effect.
    - id: retest
      goal: Reproduce the effect from a clean origin/context.
verification:
  coverage:
    - id: source-to-sink
      required: true
    - id: observable-effect
      required: true
output:
  schema: BrowserBoundaryConclusion
---

# Browser trust boundaries

Look for a complete source → validation → sink chain. A message listener, reflected marker, or DOM assignment is not a finding until an untrusted origin can cause a security-relevant effect.

## Procedure

1. Observe message listeners, origin checks, iframe relationships, storage reads, URL sinks, and fetch/XHR construction from captured pages and bundles.
2. Establish a benign marker baseline from the normal application flow.
3. Change one origin, message field, URL component, or storage value in a controlled browser harness.
4. Record the browser effect (DOM mutation, sensitive read, navigation, request header, or state change) and its origin.
5. Retest with a clean context and report the exact user interaction required.

Do not claim “DOM XSS” from a string appearing in HTML or JavaScript. The oracle must show execution or a concrete cross-origin/security boundary effect.

```text
source -> origin validation -> sink -> observable browser effect
```
