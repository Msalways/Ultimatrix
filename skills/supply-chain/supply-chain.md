---
name: supply-chain
domain: supply-chain
category: supply-chain
tier: balanced
description: Review SBOMs, triage malicious packages, detect dependency confusion, and assess CI/CD supply-chain attack exposure.
toolRefs:
  - httpRequest
  - parseResponse
  - recordEvidence
  - writeFinding
  - getTargetSummary
  - runRecon
triggers:
  - sbom dependency review
  - malicious package triage
  - dependency confusion attack
  - ci cd supply chain compromise
  - software bill of materials audit
contextBoosts: []
toolChains: []
compositionRules: {}
mitreAttack:
  - T1195
  - T1195.001
  - T1195.002
  - T1195.003
owaspRefs:
  - A06:2021
  - A08:2021
---

# Supply-Chain Security Assessment

## When to Use
Use when reviewing an application's dependency tree, SBOM, package manifests, or CI/CD pipeline configuration. Trigger on requests to audit third-party risk, identify typosquatted or malicious packages, or evaluate whether internal package namespaces are reachable by public registries.

## Detection Approach
1. **Obtain the manifest / SBOM.** Locate `package-lock.json`, `pom.xml`, `go.mod`, SBOM exports, or build artifacts. Parse declared and transitive dependencies.
2. **Pinpoint external exposure.** Enumerate which registries (npm, PyPI, Maven, RubyGems) the build pulls from and whether internal/private package names are also claimable publicly.
3. **Test dependency confusion.** For each private/internal package name, check the public registry for a same-named package at a higher version. If installers resolve public over private by version, confusion is exploitable.
4. **Triage malicious packages.** Score packages by install scripts (`preinstall`, `postinstall`), obfuscated payloads, unexpected network egress, maintainer turnover, and typosquat similarity to popular names.
5. **Assess CI/CD exposure.** Review pipeline definitions for unpinned base images, unverified third-party actions/plugins, secrets passed to external steps, and write-access to artifact stores.
6. **Switch logic.** If the SBOM is absent, request generation or reconstruct from lockfiles; if confusion is blocked, pivot to malicious-package social-engineering vectors.

## Pitfalls
- Trusting lockfile integrity without checking resolved registry source.
- Missing transitive dependencies hidden behind scoped aliases.
- Assuming private registry names are secret — names are often guessable from public repos.
- Overlooking post-install scripts as the execution primitive.

## Verification & Impact
- **Confirmed:** A public package shadows an internal name at higher version; an install script performs egress or writes to disk; a pipeline step pulls unverified remote code.
- **Suspected:** Unpinned dependencies, absent SBOM, or unreviewed third-party plugins.
- Document impact as code execution at build, credential theft, or downstream artifact poisoning. Use `writeFinding` with resolved evidence.

## Key Concepts
| Term | Meaning |
|------|---------|
| SBOM | Software Bill of Materials |
| Dependency confusion | Public pkg overrides private by version |
| Typosquatting | Name mimicking a popular package |
| Transitive dep | Dependency of a dependency |
