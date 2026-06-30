---
name: waf-bypass
description: "WAF detection, characterization, and systematic bypass techniques for filtered inputs"
category: core
toolRefs: [httpRequest, parseResponse, checkWaf, encodeDecode, findEndpointsInResponse, updateGraph]
---

# WAF Detection and Bypass

## Description
Web Application Firewalls sit between the tester and the application, filtering malicious input. This skill teaches how to detect WAF presence, understand their limitations, and use systematic techniques to work around them while maintaining test integrity.

## Methodology
1. **Detect the WAF** — Identify WAF presence through HTTP headers (X-CDN, Server headers), error pages, response behavior to known-bad input, and timing differences.
2. **Characterize the WAF** — What does it filter? Is it signature-based, anomaly-based, or rate-limiting? Test with simple payloads to understand its rules.
3. **Apply Bypass Techniques** — Work systematically through encoding, case variation, fragmentation, comments, null bytes, and HTTP parameter pollution.
4. **Document What Works** — Record which techniques bypass which rules. This knowledge is reusable across assessments.
5. **Know When to Stop** — If a WAF is blocking all attempts, consider alternative approaches: testing different endpoints, focusing on logic flaws, or using passive recon.

## Key Concepts
- **WAF Detection**: Fingerprint the WAF type (Cloudflare, AWS WAF, ModSecurity, Imperva) to predict its rule patterns
- **Encoding Tricks**: URL encoding, double encoding, Unicode, HTML entities can transform blocked strings into allowed ones
- **Case Variation**: SQL and command injection are often case-insensitive — mixed case may bypass case-sensitive filters
- **Fragmentation**: Breaking payloads across multiple parameters, chunks, or requests can evade pattern matching
- **HTTP Parameter Pollution**: Sending duplicate parameters may cause backend parsing differences from the WAF

## Evidence to Collect
- WAF type identification (headers, error pages, behavior)
- Before/after comparison showing blocked vs allowed request
- Successful bypass technique and the payload that worked
- Any WAF configuration indicators visible in responses

## Common Pitfalls
- Spending hours on WAF bypass when the application has unprotected endpoints
- Not recognizing that a 403 or 406 response IS a finding (WAF presence indicates risk awareness)
- Using aggressive payloads that trigger rate limiting or IP blocking
- Forgetting that logic flaws and business logic bypass WAFs entirely
- Not testing API endpoints which may have different WAF rules than web endpoints

## References
- OWASP WAF Evaluation Criteria
- CWE-20: Improper Input Validation
- Academic papers on WAF bypass techniques
