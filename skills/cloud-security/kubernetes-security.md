---
name: kubernetes-security
description: "Kubernetes cluster security including API server exposure, RBAC bypass, etcd access, and pod escape techniques"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["kubernetes", "k8s", "kube api", "kubelet", "etcd", "rbac bypass", "pod escape", "container escape k8s", "kubectl", "cluster breach", "k8s api server", "service account token"]
contextBoosts: [endpoints]
mitreAttack: ["T1610", "T1611", "T1613"]
owaspRefs: ["OWASP Kubernetes Security", "OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# Kubernetes Security — Skill Reference

## When to Use

Use this skill when the target is a Kubernetes cluster, kube-apiserver endpoint, kubelet port, etcd API, or any container orchestration platform. Applicable when you observe kubeconfig files, service account tokens mounted at `/var/run/secrets/kubernetes.io/serviceaccount/`, kubelet metrics endpoints, or Kubernetes-style API responses (e.g., `kind: List`, `apiVersion: v1`).

## Do Not Use

- Target is a plain Docker host (no orchestration layer).
- Target is a managed Kubernetes control plane where you have no foothold (GKE, EKS, AKS managed API server — cloud IAM is the attack surface, not K8s RBAC).
- You have already established full cluster-admin and the task is purely data exfiltration (use lateral movement or post-exploitation skills instead).

---

## 1. Auth Context — Service Account Tokens & Kubeconfig

Every pod by default gets a service account token mounted at `/var/run/secrets/kubernetes.io/serviceaccount/`. This is the primary foothold.

**Extract the token from inside a compromised pod:**

**Validate the token against the API server:**

**Check token permissions:**

**Look for kubeconfig in common paths:**
- `~/.kube/config`
- `/etc/kubernetes/admin.conf`
- `/etc/kubernetes/kubelet.conf`
- `/var/lib/kube-proxy/kubeconfig`
- Environment variable: `KUBECONFIG`

**If no token is mounted** — check if the pod has a projected service account token volume (Kubernetes 1.11+) or if `automountServiceAccountToken: true` is set. Exploit via the Kubernetes API by requesting a token for the pod's service account.

---

## 2. API Server Enumeration

The API server is the central control plane. Enumerate endpoints to understand cluster scope.

**Version and health:**

**Core API resources:**

**Extension APIs (apps, networking, RBAC):**

**Key indicators:**
- `200` on `/api/v1/secrets` → full secret read access
- `403 Forbidden` → RBAC is enforced but may be misconfigured
- `200` on `/metrics` → metrics leak (may reveal auth tokens, internal IPs)
- `401 Unauthorized` → no valid token; look for anonymous auth

---

## 3. RBAC Bypass

RBAC (Role-Based Access Control) is the primary authorization layer. Misconfigurations create privilege escalation paths.

**Enumerate effective permissions:**

**Common overprivileged patterns:**
| Pattern | Risk | Example |
|---------|------|---------|
| `cluster-admin` binding to SA | Full cluster control | `kubectl create clusterrolebinding exploit --clusterrole=cluster-admin --serviceaccount=default:default` |
| `*` verbs on `secrets` | Read all secrets | Role with `verbs: ["get","list"]` on `resources: ["secrets"]` |
| `escalate` verb on `roles` | Create higher-privileged roles | Can bind cluster-admin to own SA |
| `impersonate` on `users/groups` | Act as any user | `kubectl auth can-i impersonate users/system:admin` |
| `bind` on `clusterroles` | Bind any clusterrole | Can grant cluster-admin |
| `patch` on `deployments` | Inject containers with host mounts | Modify deployment to add `hostPath` volume |

**Privilege escalation chain:**
1. Find a service account with `create` on `clusterrolebindings` → bind `cluster-admin` to your SA.
2. Find `update/patch` on `roles` → modify existing role to add `secrets` access.
3. Find `get/list` on `pods/exec` → exec into privileged pods for host access.
4. Find `impersonate` on `users` → impersonate `system:admin`.

**Bypass network policies:** Network policies only restrict pod-to-pod traffic. They do NOT restrict:
- Pod to API server (port 6443)
- Pod to kubelet (port 10250)
- Pod to etcd (port 2379)
- Pod to external networks (unless egress policy blocks it)

---

## 4. etcd Access

etcd stores the entire cluster state including secrets, configurations, and RBAC policies. Direct access to etcd = full cluster compromise.

**Default ports:**
- `2379` — etcd client port
- `2380` — etcd peer port

**Check if etcd is exposed:**

**Read all secrets from etcd (v3 API):**

**Using etcdctl directly:**

**Common etcd paths:**
| Path | Content |
|------|---------|
| `/registry/pods/` | All pod definitions |
| `/registry/secrets/` | All secrets (tokens, passwords, TLS certs) |
| `/registry/serviceaccounts/` | Service account definitions |
| `/registry/roles/` | RBAC roles |
| `/registry/clusterrolebindings/` | Cluster-wide RBAC bindings |
| `/registry/deployments/` | Deployment specs |
| `/registry/nodes/` | Node information |

**Write to etcd (persistent compromise):**

---

## 5. Kubelet Exploitation

The kubelet runs on every node and exposes an API on port `10250`. Compromising a kubelet gives control over all pods on that node.

**Enumerate kubelet:**

**Exec into a container via kubelet:**

**Attach to a container:**

**Port-forward through kubelet:**

**Kubelet authentication modes:**
- `Anonymous` — no auth required (default in some configurations)
- `Webhook` — validates tokens against API server
- `X.509` — client certificate authentication

**If anonymous auth is enabled:** No token needed. Direct API access.
**If webhook auth is enabled:** Use a valid service account token (extracted from Step 1).
**If X.509 is enabled:** Need a valid client certificate (check `/etc/kubernetes/pki/kubelet/`).

---

## 6. Pod Escape

Escaping a container gives access to the underlying node.

### 6a. Privileged Container Escape

If a container runs with `privileged: true`, it has full host access:

### 6b. hostPath Mount Escape

If the pod has a `hostPath` volume mount:

**Docker socket escape:**

### 6c. hostPID / hostNetwork

- `hostPID: true` → access host PID namespace, see all processes, send signals
- `hostNetwork: true` → access host network stack, bind to host ports, sniff traffic

### 6d. Kernel Exploitation

Container breakout via kernel vulnerability (e.g., Dirty COW CVE-2016-5195):

### 6e. Service Account Token Abuse

Even without host access, a service account token can be used to:
- Create a new privileged pod with host mounts
- Delete existing pods to disrupt workloads
- Read secrets across namespaces


---

## 7. Secret Extraction

Kubernetes secrets are base64-encoded (not encrypted). If you have RBAC access:

**List and extract secrets:**

**Common high-value secrets:**
| Secret Name Pattern | Content |
|--------------------|---------|
| `<sa>-token-<random>` | Service account JWT token |
| `default-token-<random>` | Default SA token |
| `tls-*` | TLS certificates and keys |
| `docker-registry-*` | Container registry credentials |
| `aws-*` | AWS credentials (EKS) |
| `gcp-*` | GCP service account keys |
| `db-*` | Database connection strings |

**Decode all secrets in a namespace:**

**Write findings for each secret:**

---

## 8. Lateral Movement

Service account tokens are namespace-scoped by default but can be used for lateral movement.

**Cross-namespace access:**

**Pivot to other nodes:**
1. Use kubelet API on other nodes (same cluster, different IP)
2. Use service account tokens to access node-level resources
3. Modify DaemonSets to deploy on all nodes

**Access external cloud APIs:**
- EKS: STS calls using pod identity or IRSA
- GKE: Metadata server calls for GCP tokens
- AKS: Azure managed identity endpoint

**Exploit trust relationships:**
- Service accounts can be impersonated if `impersonate` is allowed
- Cluster roles may grant access across all namespaces
- Federation tokens allow cross-cluster access

---

## 9. Reverse Shell in Container

If you have exec access to a container and need a persistent shell:

**Bash reverse shell:**

**Netcat (if available):**

**Python reverse shell:**

**Perl reverse shell:**

**Kubectl exec reverse shell (from outside):**

**Upload tools:**

---

## 10. Evidence Collection & Graph Updates

For each finding, record evidence and update the knowledge graph:


---

## 11. Anti-Hallucination

**Never claim a finding without proof.** Every Kubernetes security finding MUST be backed by verifiable tool output:

- **API server access**: Include the full HTTP response body (status code + JSON response). A `200` status with an empty `items: []` is NOT evidence of access to secrets.
- **RBAC permissions**: Include the full `kubectl auth can-i --list` output. Do not claim "full cluster access" without showing `* *` in the output.
- **Secret extraction**: Include the actual decoded content (redact only truly sensitive values like live passwords). Do not claim "AWS credentials found" without showing `AKIA...` in the evidence.
- **etcd access**: Include the response from `/health` or `/version` endpoint. Do not claim "etcd is exposed" without a valid HTTP response.
- **Pod escape**: Include the output of `id`, `hostname`, or `cat /etc/os-release` from the HOST after escape. A command that returns exit code 0 is NOT evidence of escape.
- **Kubelet access**: Include the response from `/pods` endpoint. Do not claim "kubelet anonymous auth enabled" without a `200` response.

**Structured tool output for all claims:**

**Verification checklist before reporting:**
- [ ] HTTP response body captured and matches expected format
- [ ] Status code is `200` (not `403`, `401`, `503`)
- [ ] Response content actually contains the claimed data (not empty or error)
- [ ] If claiming privilege escalation, the `can-i` output shows the claimed permissions
- [ ] If claiming container escape, `id` or `uname -r` from host namespace is captured
