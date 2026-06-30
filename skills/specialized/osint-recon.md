---
name: osint-recon
description: "Open source intelligence gathering from public data sources, social media, and infrastructure records"
category: specialized
toolRefs: [httpRequest, runRecon, graphqlIntrospect, cloudMetadataProbe, updateGraph, writeFinding]
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
