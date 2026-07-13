---
name: file-upload-attacks
description: "File upload exploitation including double extension, polyglot files, SVG XSS, and restricted file bypass"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, followRedirects, recordEvidence, getCapturedHeaders]
triggers: ["file upload vulnerability", "upload exploitation", "unrestricted file upload", "file type bypass", "upload bypass", "double extension", "polyglot file", "svg upload", "image upload attack", "upload validation bypass"]
contextBoosts: [api]
mitreAttack: ["T1190", "T1059"]
owaspRefs: ["OWASP Top 10 A04:2021 Insecure Design"]
---

# File Upload Attacks

## When to Use
- Testing file upload functionality for unrestricted upload, type bypass, or path traversal
- Assessing SVG uploads for XSS
- Testing image processing libraries for vulnerabilities

**Do not use** to deploy actual malicious files in production. Prove the flaw, don't weaponize.

## Auth Context
Before making HTTP requests, call **getCapturedHeaders** with the target URL to get real auth context. Pass these in the `headers` parameter of httpRequest.

## Upload Field Discovery

## Double Extension Bypass

## Content-Type Bypass

## Magic Bytes Bypass

## Polyglot Files

## SVG XSS Upload

## Path Traversal in Filename

## ImageMagick Exploitation (CVE-2016-3714)

## Race Condition on Upload

## Evidence Collection
- Upload request/response pairs
- Evidence of file execution (command output, XSS alert)
- File storage path discovery
- **recordEvidence** for every finding
- **writeFinding** with severity based on impact

## Anti-Hallucination
Your claims will be verified against real tool output. Never fabricate findings.
Every upload bypass you report MUST have a corresponding tool call response that proves it.
If a tool call fails, say so honestly — do not invent a success.

## Trigger Conditions

Activate on any file upload/import feature: avatars, documents, media, archives, certificates, plugins/themes, or profile imports. Trigger especially for SVG uploads (XSS), server-side processing (ImageMagick/GD/librsvg), and endpoints that later serve uploaded files. Also relevant when filenames/paths are user-controlled (path traversal) or the app processes the file server-side. Do not trigger to deploy actual malware — prove the flaw, don't weaponize. Avoid destructive payloads on production.

## Detection Approach

First discover the upload field and the validation model: inspect accepted extensions, `Content-Type`, magic bytes, size, and the response (stored path, processed output). Reason about the weakest link. Test filename-based bypasses (double extension `shell.php.jpg`, trailing dot/null byte, path traversal `../../`), then `Content-Type` spoofing, then magic-byte padding ahead of a polyglot payload (script embedded after a valid GIF/JPEG header). For SVG, inject XML/script and verify server-side or client-side rendering. For processing libraries, probe known unsafe primitives (ImageMagick `</>` delegates). Confirm success by actually retrieving/executing the uploaded artifact (XSS alert, command output, or saved file at a predictable path) — not by a generic "upload succeeded" message. Mind the race condition on async AV scanners that delete bad files after a delay.

## Pitfalls

- Treating "upload succeeded" as proof of execution — you must retrieve/execute the file to confirm impact.
- Assuming client-side extension checks are the only control — verify server-side validation too.
- Overlooking content-type vs magic-byte mismatches — set both consistently for the spoof.
- Forgetting processing libraries (ImageMagick) can be the real sink, not just the web server.
- Ignoring the async-scanner race — a file may vanish after upload, defeating the test.
- Weaponizing with real malware on production — keep PoCs benign proof-of-concept files.

## Verification & Impact

CONFIRMED when the uploaded file is stored/served and demonstrably executes or renders with attacker control: script/XSS from an SVG, command output from a server-side processed polyglot, or a file written outside the intended directory via traversal. SUSPECTED when the upload is accepted but execution/retrieval isn't proven — record as candidate. Document impact by capability (arbitrary file write, XSS, RCE via processing library, traversal) and severity. Capture the upload request, stored-path discovery, and execution/retrieval proof via `recordEvidence`.
