---
name: osint-recon
description: "Open source intelligence gathering from public data sources, social media, and infrastructure records"
category: specialized
tier: fast
toolRefs: [httpRequest, runRecon, graphqlIntrospect, cloudMetadataProbe, updateGraph, writeFinding]
triggers: ["osint", "open source intelligence", "intelligence gathering", "social media", "public records", "reconnaissance", "information gathering", "osint recon", "public data", "intelligence collection"]
mitreAttack: ["T1593", "T1596"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# OSINT Reconnaissance

## Description
Open Source Intelligence (OSINT) gathering uses publicly available information to build a comprehensive picture of a target. This skill covers public data sources, social media analysis, domain history, and technology fingerprinting from public data.

## Methodology
1. **Define the Scope** — What are you looking for? Domain infrastructure, employee information, technology choices, leaked credentials, business relationships?
2. **Search Engine Research** — Use advanced search operators to find indexed pages, cached content, file types, and subdomains. Google dorking reveals exposed admin panels, error pages, and configuration files.
3. **Domain and IP Intelligence** — WHOIS records, DNS history, IP ownership (ARIN/RIPE), BGP announcements, reverse DNS, SSL certificate history reveal infrastructure evolution.
4. **Certificate Transparency Logs** — crt.sh, Censys, and CT logs show every SSL certificate issued for a domain, revealing subdomains and internal hostnames.
5. **Social Media and People** — LinkedIn reveals organizational structure and tech stack. GitHub exposes code, credentials, and internal tools. Job postings indicate technologies in use.
6. **Data Breach Intelligence** — Check if employees or systems appear in known breaches. Credentials from other services often work on the target.

## Key Concepts
- **Passive Intelligence**: Gathering information without any interaction with the target systems
- **Metadata as Intel**: File metadata, EXIF data, document properties, and version control history reveal more than the content itself
- **Temporal Analysis**: Wayback Machine snapshots show how a target has changed over time — old admin panels, forgotten subdomains
- **Relationship Mapping**: Connections between people, domains, IP ranges, and organizations reveal trust relationships
- **Operational Security**: Be aware that your queries may be logged. Use appropriate infrastructure for research.

## Evidence to Collect
- Discovered domains, subdomains, and IP ranges
- Technology stack indicators from public data
- Employee information relevant to social engineering awareness
- Exposed credentials or sensitive files
- Historical changes to infrastructure and configuration

## Common Pitfalls
- Relying on a single source — cross-reference findings across multiple tools
- Not respecting rate limits and getting IP-blocked by search engines
- Confusing correlation with causation in relationship mapping
- Forgetting to check non-English sources and regional platforms
- Not documenting negative results (domains confirmed not to exist)

## References
- OWASP OSINT Resources
- Maltego (OSINT visualization)
- Shodan, Censys (infrastructure search)
- crt.sh (certificate transparency)

## Trigger Conditions

Activate during the passive/early recon phase to build target knowledge from public sources: domain/IP infrastructure, employee/tech-stack intel, leaked credentials, exposed files, and historical changes. Trigger when starting any assessment before active testing, or to support social-engineering/phishing awareness and subdomain/infra mapping. Do not trigger for active vulnerability testing (use active skills) or where scope prohibits passive collection; keep queries privacy- and scope-aware.

## Detection Approach

Define the intelligence need first (infra, people, tech, leaks, relationships). Then gather from multiple independent sources and cross-reference: search-engine dorking for indexed/admin/config pages, WHOIS/DNS history/RIR data and BGP for infra evolution, certificate transparency logs (crt.sh/Censys) for subdomains and internal hostnames, social/professional platforms for org structure and stack, and breach corpora for credential reuse. Use temporal analysis (Wayback snapshots) to find forgotten subdomains/panels. Build relationship maps (domains↔IPs↔people↔orgs) but treat correlation as hypothesis, not proof. Route concrete technical findings (subdomains, exposed files, disclosed endpoints) into active verification via the recon/information-disclosure skills.

## Pitfalls

- Relying on a single source — always cross-reference.
- Hitting search-engine rate limits and getting IP-blocked.
- Confusing correlation with causation in relationship mapping.
- Ignoring non-English/regional platforms.
- Not recording negative results (domains confirmed absent).
- Treating a leaked credential as valid on the target without verification.

## Verification & Impact

CONFIRMED when OSINT yields actionable, cross-referenced artifacts: verified subdomains/IP ranges, real exposed credentials/files, or tech-stack indicators tied to the target. SUSPECTED when a lead is plausible but unverified — record as candidate for active confirmation. Document impact by what the intel enables (phishing targeting, attack-surface expansion, credential reuse, forgotten-asset discovery). Capture source URLs, CT-log entries, and breach references via `recordEvidence`.
