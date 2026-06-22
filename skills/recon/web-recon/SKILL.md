---
name: web-recon
description: "Web application reconnaissance — technology detection, endpoint discovery, form/param enumeration"
version: 1.0.0
tags: [recon, discovery, enumeration]
toolRefs: [runRecon, graphqlIntrospect, frameworkFingerprint, jwtDecode, cloudMetadataProbe, updateGraph, writeFinding]
mitre_attack: T1595, T1595.002, T1595.003
---

## Web Reconnaissance

### Technology Detection
Use `frameworkFingerprint` tool on the target URL to identify framework, server, and libraries.

### Endpoint Discovery
- Navigate the target with `runRecon` and explore all pages via `httpRequest`
- Look for `/api/`, `/graphql`, `/rest/`, `/v1/`, `/v2/` patterns in links
- Use `graphqlIntrospect` to discover GraphQL endpoints

### Input Vector Mapping
For each page, identify:
- Form fields (name, type)
- URL parameters
- Cookie values
- API endpoint parameters
- Use `jwtDecode` to analyze JWT tokens
- Use `cloudMetadataProbe` to check for cloud metadata exposure

Document all findings with `writeFinding`.
