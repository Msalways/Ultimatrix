# F6: Missing Lethal Primitives (Fuel Tank)

**Phase**: F6 - Missing Lethal Primitives
**Status**: PENDING
**Priority**: HIGH
**Effort**: Large (4-6 weeks)

---

## Overview

The "fuel tank" is the collection of attack primitives that the swarm can execute. Currently the framework has the orchestration layer (pheromones, schedulers, workers) but the actual attack primitives are incomplete. This spec covers the missing lethal primitives needed to make the swarm genuinely lethal.

---

## Missing Primitive Categories

### F6.1 Credential Reuse Engine (Weeks 1-3) — HIGHEST ROI

**Problem**: Found credentials don't automatically propagate → spray → validate → graph edges

**Design**:
```typescript
// src/primitives/credential-reuse.ts
interface CredentialReuseEngine {
  onCredentialFound(cred: Credential, context: AttackContext): Promise<ReuseResult>;
  spray(cred: Credential, targets: Target[]): Promise<SprayResult[]>;
  validate(cred: Credential, target: Target): Promise<ValidationResult>;
  recordReuse(cred: Credential, from: NodeId, to: NodeId, result: ValidationResult): Promise<void>;
}

interface Credential {
  type: 'password' | 'hash' | 'token' | 'key' | 'cookie' | 'ssh_key';
  value: string;
  metadata: {
    source: string;              // where found
    username?: string;
    domain?: string;
    validity?: Date;
    tags: string[];
  };
}

interface ReuseResult {
  validated: Target[];
  failed: Target[];
  graphEdges: GraphEdge[];      // cred → target edges
}
```

**Implementation Steps**:
1. Week 1: Core engine + graph integration (Credential node + REUSES edge)
2. Week 2: Spray engine with rate limiting, lockout detection, concurrency control
3. Week 3: Per-protocol validators (SSH, WinRM, SMB, LDAP, HTTP, API, Cloud)

**Graph Integration**:
- `Credential` node with `type`, `value` (hashed), `source`, `validity`
- `REUSES` edge: `(credential)-[:REUSES]->(target)` with `result`, `timestamp`, `success`

---

### F6.2 Exploit Chain Engine (Weeks 4-6)

**Problem**: No automated chaining of exploits (SQLi → RCE → Persistence → Lateral)

```typescript
// src/orchestration/exploit-chain.ts
interface ExploitChain {
  steps: ChainStep[];
  execute(context: ChainContext): Promise<ChainResult>;
}

interface ChainStep {
  id: string;
  primitive: string;           // e.g., 'sql-injection', 'rce-class'
  input: Record<string, any>;  // from previous step output
  conditions: Condition[];     // when to execute
  onSuccess: (output) => void; // graph edges, pheromones
  onFailure: FallbackAction;
}

// Built-in chains
const BUILTIN_CHAINS = {
  'sqli-to-rce': ['sql-injection', 'rce-class', 'persistence', 'lateral-movement'],
  'auth-bypass-to-rce': ['auth-bypass', 'rce-class', 'persistence'],
  'ssrf-to-cloud': ['ssrf-metadata', 'cloud-privesc', 'lateral-movement'],
  'idor-to-data-exfil': ['idor-swapper', 'data-exfil', 'credential-harvest'],
};
```

**Graph Integration**:
- `CHAIN` node linking `FINDING` → `PRIMITIVE` → `FINDING` → ...
- `STEP` edges with `input`, `output`, `status`, `evidenceRef`

---

### F6.3 AD/Kerberos Primitive Pack (Week 5-7)

| Primitive | Technique | Output | Next Primitives |
|-----------|-----------|--------|-----------------|
| `kerberoast` | T1208 | SPN scan → TGS request → offline crack | `dcsync`, `golden-ticket` |
| `dcsync` | T1003.006 | DRsuAPI DRSGetNCChanges | `ntds.dit`, `krbtgt` hash |
| `golden-ticket` | T1558.001 | Forge TGT with krbtgt hash | `dcsync`, `silver-ticket` |
| `rbcd` | T1550.003 | Resource-Based Constrained Delegation | `shadow-credentials` |
| `shadow-credentials` | T1550.003 | `msDS-KeyCredentialLink` abuse | `persistence` |
| `dcsync` | T1003.006 | DRsuAPI replication | `golden-ticket`, `skeleton-key` |

---

### F6.4 Cloud Primitive Pack v1 (Weeks 8-10)

| Provider | Primitives |
|---|---|
| **AWS** | `iam-enum`, `s3-enum`, `lambda-enum`, `sts-assume-role`, `ec2-metadata`, `cloudtrail-enum`, `secrets-manager-dump` |
| **Azure** | `graph-api-enum`, `keyvault-dump`, `managed-identity`, `azure-cli`, `rbac-enum` |
| **GCP** | `iam-enum`, `secret-manager`, `cloud-functions`, `cloud-run`, `cloud-build` |
| **Kubernetes** | `k8s-api-enum`, `rbac-enum`, `pod-escape`, `service-account-theft` |

---

### F6.5 Lateral Movement Pack
- Pass-the-Hash / Pass-the-Ticket
- DCSync (already in AD pack)
- RBCD (Resource-Based Constrained Delegation)
- Shadow Credentials (`msDS-KeyCredentialLink`)
- Pass-the-Key / Overpass-the-Hash
- SMB/WinRM/WinRS lateral movement

---

### F6.6 Cloud PrivEsc Pack
- AWS: IMDS → IAM role assumption, `iam:PassRole`, Lambda privilege escalation
- Azure: Managed Identity → Key Vault → Resource access, Graph API abuse
- GCP: IAM impersonation, Service Account impersonation, Cloud Functions

---

### F6.8 Lateral Movement Pack
- Pass-the-Hash / Pass-the-Ticket
- DCSync (domain controller sync)
- RBCD (Resource-Based Constrained Delegation)
- Shadow Credentials (`msDS-KeyCredentialLink`)
- Pass-the-Key / Overpass-the-Hash

---

### F6.9 Cloud PrivEsc Pack
- AWS: IMDS → IAM role assumption, `iam:PassRole`, Lambda persistence
- Azure: Managed Identity → Graph/Key Vault access, MSI token theft
- GCP: IAM impersonation, Service Account keys, Cloud Functions abuse

---

### F6.10 C2/Implant Framework (Wave 2)
- Beacon protocol (DNS/HTTP/HTTPS/DNS)
- Pivot graph (session → pivot → target)
- Encrypted channels (TLS, DNS, ICMP)
- Agent deployment via exploit chain output

---

## Acceptance Criteria

| Primitive | Criteria |
|-----------|----------|
| Credential Reuse | Found cred → auto-spray → graph edge created → validated |
| Exploit Chain | `sqli-to-rce` executes 4 steps, each output feeds next |
| AD Pack | Kerberoast → hash → crack → DCSync → Golden Ticket verified |
| Cloud Pack | AWS/Azure/GCP primitives execute against live targets |
| Lateral Pack | PTH → DCSync → RBCD chain produces graph edges |
| Cloud PrivEsc | IMDS → role assumption → privilege escalation verified |

---

## Integration Points

| Primitive | Hook Point |
|-----------|------------|
| Credential Reuse | `src/intelligence/credential-graph.ts` + `exploitation-loop.ts` |
| Exploit Chain | `src/orchestration/exploit-chain.ts` |
| AD Pack | `src/primitives/ad-kerberos.ts` |
| Cloud Pack | `src/primitives/cloud/` |
| Lateral Movement | `src/primitives/lateral-movement.ts` |
| C2 Framework | `src/c2/` (new module) |

---

## Dependencies

| Primitive | Depends On |
|-----------|------------|
| Credential Reuse | Graph store, EvidenceGate, Reflexion |
| Exploit Chains | EvidenceGate, Primitive registry |
| AD Pack | `resolvePrimitive('dcsync')` etc. |
| Cloud Pack | Cloud SDKs (AWS SDK v3, Azure SDK, GCP SDK) |
| Lateral Pack | Credential Reuse + AD Pack |
| Cloud PrivEsc | Cloud Pack + IAM primitives |

---

## Acceptance Criteria (Per Primitive)

| Primitive | Criteria |
|-----------|----------|
| Credential Reuse | Found cred → spray → validated → graph edge created in < 5s |
| Exploit Chain | Each step output feeds next; graph edges created per step |
| AD Pack | Kerberoast → hash → crack → DCSync verified against DC |
| Cloud Pack | Live AWS/Azure/GCP targets enumerated + exploited |
| Lateral | PTH → session → DCSync → graph edges created |
| C2 | Beacon check-in, tasking, result exfil, pivot graph |

---

## Dependencies

| Primitive | Depends On |
|-----------|------------|
| Credential Reuse | Graph store, EvidenceGate, Spray engine |
| Exploit Chains | EvidenceGate, Primitive registry |
| AD Pack | AD primitives registered, Graph store |
| Cloud Pack | Cloud SDKs (AWS/Azure/GCP SDKs) |
| Lateral | Credential Reuse + AD Pack |
| C2 | Graph store, EvidenceGate, Agent comms |

---

## Milestones

| Milestone | Target | Criteria |
|-----------|--------|----------|
| M1: Credential Reuse Engine | Week 3 | Found cred → spray → graph edge in < 5s |
| M2: Exploit Chain Engine | Week 6 | 2 chains execute end-to-end with graph edges |
| M3 | AD Pack | Kerberoast → DCSync → Golden Ticket verified |
| M4 | Cloud Pack v1 | AWS/Azure/GCP primitives execute against live targets |
| M5 | Lateral + PrivEsc | Chained lateral + priv esc graphs |
| M6 | C2 Framework | Beacon check-in, tasking, pivot graph |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Legal/Compliance | All primitives gated behind `engine: 'solver'` + scope guard |
| Detection | Built-in opsec (jitter, jitter, encryption, rotation) |
| False positives | EvidenceGate verification before graph commit |
| Scope creep | Scope guard enforced at tool level + claim registry |

---

## Dependencies

| Component | Depends On |
|---|---|
| `src/primitives/` | Core primitive registry |
| `src/intelligence/credential-graph.ts` | NEW |
| `src/orchestration/exploit-chain.ts` | NEW |
| `src/primitives/ad-kerberos.ts` | NEW |
| `src/primitives/cloud/` | NEW |
| `src/primitives/lateral-movement.ts` | NEW |
| `src/c2/` | NEW (Phase 2) |

---

## Next Steps

1. **Week 1-2**: Implement `src/primitives/credential-reuse.ts` + graph integration
2. **Week 3-4**: Exploit chain engine + 2 built-in chains
3. **Week 5-7**: AD/Kerberos primitives
4. **Week 8-10**: Cloud primitive pack v1
5. **Week 11-12**: Lateral movement + Cloud priv esc
6. **Week 13-14**: C2 framework skeleton
7. **Week 15-16**: Integration testing, benchmarks, documentation