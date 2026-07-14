---
id: output-contract
name: Output Contract
description: Mandatory structured JSON output format for all council members
---

## Output Contract (MANDATORY)

You MUST end every response with a JSON code block containing your structured output.
The orchestrator reads these typed fields — it does NOT parse your free text.

### When proposing an attack:
```json
{
  "intent": "propose",
  "proposal": {
    "action": "human-readable description of the attack",
    "skillId": "skill-file-id (e.g. injection, web-pentest, exploitation)",
    "endpointId": "optional graph endpoint node ID",
    "complexity": "low|medium|high|critical",
    "impact": "low|medium|high|critical",
    "reasoning": "why this attack and why now",
    "evidenceRequired": ["list of evidence needed before executing"],
    "claim": {
      "type": "finding|vuln|behavior",
      "endpoint": "https://target/path (must match an OBSERVED evidence URL)",
      "param": "optional parameter name the finding concerns",
      "method": "GET|POST|... (asserted HTTP method, if any)",
      "observed": { "method": "POST", "url": "https://target/path", "status": 200 }
    }
}
```

> Include `claim` ONLY when you are asserting a confirmed finding backed by
> observed evidence already recorded in the ledger. Action-only proposals
> (recon / explore / test) must OMIT `claim` so the skeptic approves them
> to go gather that evidence. The skeptic structurally verifies every
> `claim.observed` against the recorded evidence items — a claim with no
> matching evidence is rejected, never silently passed.

### When critiquing others' proposals:
```json
{
  "intent": "critique",
  "critique": {
    "targets": ["role names of members you are critiquing"],
    "agreements": ["what you agree with"],
    "disagreements": ["what you disagree with and why"],
    "evidenceGaps": ["claims that lack supporting evidence"],
    "alternative": "optional alternative suggestion"
  }
}
```

### When signaling completion:
```json
{
  "intent": "complete",
  "reflection": {
    "whatWorked": ["techniques that produced findings"],
    "whatFailed": ["techniques that failed and why"],
    "whatLearned": ["new information about the target"],
    "nextSteps": ["what to do next if we were to continue"]
  }
}
```

### When escalating to the human:
```json
{
  "intent": "escalate",
  "text": "explanation of why escalation is needed"
}
```

Impact levels:
- low: passive recon, information gathering, report generation
- medium: active probing, directory enumeration, fingerprinting
- high: exploit attempts, privilege escalation, injection payloads
- critical: auth bypass, credential extraction, reverse shell, data exfiltration, destructive action

Complexity levels map to worker model tiers:
- low: simple HTTP requests, no browser needed
- medium: multi-step requests, basic browser interaction
- high: complex chains, browser automation, multi-worker coordination
- critical: full exploitation chains, lateral movement
