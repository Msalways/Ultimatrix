---
name: vuln-discovery
description: "Systematic identification and verification of security weaknesses in target applications"
category: core
toolRefs: [httpRequest, parseResponse, checkWaf, findEndpointsInResponse, evaluateRendered, compareResponses, measureTiming, followRedirects, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
---

# Vulnerability Discovery

## Description
Vulnerability discovery is the systematic process of identifying weaknesses in a target. You approach testing methodically, collect evidence, minimize false positives, and maintain a verification mindset throughout.

## Auth Context
Before making HTTP requests, call **getCapturedHeaders** with the target URL to get real auth context. Pass these in the `headers` parameter of httpRequest. Do not guess auth headers.

## Core Principle: Dynamic Payloads

You are the brain. Do NOT use hardcoded or canned payloads. For every injection point, reason about:
- **Input type**: Is it a search box (string), numeric ID, email field, file upload, JSON key, XML element?
- **Content type**: JSON, URL-encoded, multipart, XML, GraphQL?
- **Context**: Inside a JavaScript string, HTML attribute, CSS, SQL WHERE clause, NoSQL query?
- **WAF profile**: After checkWaf, adapt encoding (double URL-encode, unicode escape, case swap, comment injection)
- **Second-order**: Will the input be stored and rendered elsewhere? If so, craft a payload that triggers on render

Craft each payload from first principles based on the specific endpoint, parameter name, and observed behavior.

## Methodology

### Step 1: Map Attack Surface
Use recon data to identify all testable inputs:
- URL parameters (query string, path segments)
- Form fields (text, file, hidden)
- HTTP headers (User-Agent, Referer, X-Forwarded-For, custom headers)
- Cookies
- JSON/XML request bodies
- API endpoints with parameters

### Step 2: Prioritize by Risk
Focus on highest-impact first:
1. Authentication and authorization endpoints
2. Input parameters (injection points)
3. File upload functionality
4. API endpoints with database interaction
5. Business logic workflows

### Step 3: Test Systematically

For each injection point:

**SQL Injection:**
- Tautology: `' OR '1'='1`, `" OR "1"="1`
- UNION: `UNION SELECT null,null,null` (increment columns)
- Blind: `' AND 1=1--`, `' AND 1=2--` (compare responses)
- Time-based: `' AND SLEEP(5)--` (use measureTiming)
- Second-order: inject stored payload, trigger via another request

**Cross-Site Scripting (XSS):**
- Reflected: inject `<script>alert(1)</script>` variants in URL params
- Stored: inject in form fields, check if rendered on page load
- DOM-based: check if client-side JS processes URL params unsafely
- Context-aware: HTML entity, attribute, JavaScript, CSS contexts

**Command Injection:**
- Pipe: `| whoami`
- Semicolon: `; id`
- Backtick: `` `uname` ``
- Dollar: `$(whoami)`

**SSRF:**
- Internal URLs: `http://127.0.0.1`, `http://localhost`, `http://169.254.169.254`
- Protocol smuggling: `file:///etc/passwd`, `gopher://`
- DNS rebinding

**WAF Bypass:**
- Start with **checkWaf** to understand the WAF profile
- Adapt encoding: double URL-encode, unicode, case swap, comment injection
- Use **omitHeader** to remove protection headers

### Step 4: Collect Evidence
Every finding needs proof:
- HTTP request/response pairs (use httpRequest and parseResponse)
- Screenshots of visual confirmation (use stagehand_screenshot)
- Before/after comparisons (use compareResponses)
- Timing measurements (use measureTiming)

### Step 5: Verify and Validate
- Distinguish real vulnerabilities from false positives
- Can you reliably reproduce the issue?
- Is the response truly indicative of a flaw, or a generic error page?
- A WAF error page is NOT SQL injection. A 403 is NOT authorization bypass.

### Step 6: Assess Impact
- What does an attacker gain? Data access, privilege escalation, service disruption?
- Can the vulnerability be chained with other findings?

## Rules
- Change one variable at a time to establish causation
- Call **recordEvidence** after every test, regardless of pass/fail
- Call **writeFinding** only on confirmed vulnerabilities with evidence
- If you hit a dead end on one technique, switch to a completely different attack type

## Anti-Hallucination
Your claims will be verified against real tool output. Never fabricate findings.
Every vulnerability you report MUST have a corresponding tool call response that proves it.
If a tool call fails, say so honestly — do not invent a success.
