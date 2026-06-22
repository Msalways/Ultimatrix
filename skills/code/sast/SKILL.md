---
name: sast
description: "Static analysis — source-to-sink taint tracking, secret scanning, entry point detection"
version: 1.0.0
tags: [code, sast, static-analysis]
toolRefs: [runRecon, findEndpointsInResponse, updateGraph, writeFinding]
mitre_attack: T1595
---

## Static Analysis

### Taint Analysis
Use the `findEndpointsInResponse` tool to scan for potential source-to-sink data flow vulnerabilities in source code.

### Secret Scanning
Use `runRecon` with appropriate patterns for:
- API keys, tokens, passwords in source code
- Hardcoded credentials
- `.env` files or exposed configuration

### Entry Point Detection
Examine source code for:
- Route handlers, controllers, API endpoints
- Database queries, shell exec calls
- File read/write operations
- Authentication/authorization logic

Document all findings with `writeFinding`.
