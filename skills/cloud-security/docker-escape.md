---
name: docker-escape
description: "Docker container escape techniques including privilege escalation, socket abuse, and namespace breakout"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["docker escape", "container escape", "breakout", "docker socket", "privileged container", "escape docker", "namespace escape", "cgroup escape", "docker root", "host access from container"]
contextBoosts: [endpoints]
mitreAttack: ["T1611", "T1610"]
owaspRefs: ["OWASP Docker Security", "OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# Docker Container Escape

Container escape is the act of breaking out of an isolated container environment to gain access to the underlying host system. This skill covers every documented technique for escaping Docker containers, from simple misconfigurations to advanced kernel-level exploits.

---

## When to Use

- You have shell access inside a Docker container and need to assess host escape risk
- You are auditing a Dockerfile, docker-compose stack, or Kubernetes pod for escape vectors
- You found a privileged container or one with dangerous capabilities/volumes
- You are testing a containerized application's isolation boundaries
- The Docker daemon socket is mounted inside the container
- You need to verify whether a container breakout is possible during a penetration test

## Do Not Use

- Against production systems without explicit written authorization
- Against containers you do not own or have permission to test
- To exfiltrate data from containers beyond the scope of the engagement
- Against Kubernetes clusters in shared tenant environments without cluster-admin approval
- Against cloud-managed container services (ECS, GKE, AKS) where host escape has different implications

---

## Auth Context

Container escape requires existing shell access inside the container or the ability to execute commands within it. Before attempting escape:

1. **Confirm authorization**: The engagement scope must explicitly include container escape testing
2. **Document the entry point**: Record how you gained container access (reverse shell, exec, SSRF, etc.)
3. **Identify the container runtime**: Docker, containerd, CRI-O — each has different escape surfaces
4. **Check the orchestrator**: Standalone Docker vs. Kubernetes vs. Docker Swarm changes the blast radius

---

## Detection — Confirm You Are Inside a Container

Before attempting escape, confirm you are actually in a container and identify its configuration.

### Filesystem Indicators


### Cgroup Detection


### Process Table Analysis


### Mount Enumeration


---

## Privileged Container Escape

A privileged container has nearly all host capabilities and can mount the host filesystem directly.

### Detection


### Mount Host Filesystem


### Alternative: Use nsenter to Enter Host Namespace


### Mount Host Docker Socket


### Write to Host Filesystem


---

## Docker Socket Abuse

If `/var/run/docker.sock` is mounted inside the container, you can control the Docker daemon on the host.

### Verify Socket Access


### Escape by Creating a Privileged Container


### Alternative: Run with Host PID Namespace


### Extract Secrets from Host


---

## HostPID / HostNetwork Escape

Containers sharing the host PID or network namespace have direct access to host processes and network interfaces.

### HostPID — Access Host Processes


### HostNetwork — Sniff Host Traffic


---

## Cgroup Escape

Cgroup escape uses the Linux cgroup subsystem to execute commands on the host. This works on older kernels (pre-5.x) or when the container has `SYS_ADMIN` capability.

### Classic cgroup release_agent Escape


### Modern cgroup v2 Escape


---

## Capabilities Abuse

Linux capabilities grant granular kernel-level privileges. Abusable capabilities enable escape.

### Key Capabilities for Escape

| Capability | Hex | Escape Vector |
|------------|-----|---------------|
| `CAP_SYS_ADMIN` | 0x200000 | Mount host filesystem, cgroup escape, mount fuse |
| `CAP_SYS_PTRACE` | 0x20000 | Attach to host processes, inject code |
| `CAP_NET_ADMIN` | 0x1000 | Modify host network, ARP spoofing, iptables |
| `CAP_DAC_OVERRIDE` | 0x8 | Bypass file permissions, read /etc/shadow |
| `CAP_SYS_RAWIO` | 0x10 | Direct I/O to host devices |
| `CAP_SYS_MODULE` | 0x1000 | Load kernel modules (ultimate escape) |
| `CAP_MKNOD` | 0x200000 | Create device files, access /dev/sda |

### SYS_PTRACE Escape


### SYS_ADMIN — Mount FUSE/Overlay


### SYS_MODULE — Load Kernel Module


---

## Docker API Exploitation

Exposed Docker daemon APIs are a critical attack surface. The daemon may listen on TCP ports 2375 (HTTP) or 2376 (HTTPS).

### Detection


### Escape via API


### Extract Credentials


---

## Volume Mount Abuse

Mounted host volumes provide direct filesystem access to the host.

### Common Dangerous Mounts

| Mount | Risk | Exploitation |
|-------|------|-------------|
| `/var/run/docker.sock` | Full Docker control | Create privileged container |
| `/etc/shadow` | Host password hashes | Offline cracking |
| `/root/.ssh` | SSH private keys | Persistent host access |
| `/etc/kubernetes` | Cluster credentials | Cluster takeover |
| `/var/log` | Log files, credentials | Information disclosure |
| `/proc` | Host process info | Process injection |
| `/sys` | Kernel parameters | Module loading |

### Read Host Secrets


### Write to Host Filesystem via Volume


---

## Anti-Hallucination

Every escape technique described here is based on documented Linux kernel mechanics and Docker runtime behavior. Before executing any technique:

1. **Verify the condition exists**: Do not assume a container is privileged without checking `CapEff` in `/proc/1/status`. Do not assume the docker socket is mounted without confirming `/var/run/docker.sock` exists and is accessible.

2. **Check kernel version**: Cgroup escape requires specific kernel versions. Run `uname -r` before attempting. Kernels 5.x+ have additional mitigations.

3. **Validate capability set**: Read `/proc/self/status` `CapEff` field and decode it. Do not assume capabilities are present.

4. **Test mounts before exploiting**: Always `ls` and `cat` mount points before attempting to write. A read-only mount will fail writes silently.

5. **Confirm API exposure**: Before exploiting Docker API on port 2375, confirm with a version request. Do not assume the API is unauthenticated.

6. **Document evidence**: Run every detection command, capture output, and record it as evidence before proceeding with exploitation.

---

## References

- MITRE ATT&CK T1611: Escape to Host
- MITRE ATT&CK T1610: Deploy Container
- OWASP Docker Security Cheat Sheet
- Docker Security Documentation: https://docs.docker.com/engine/security/
- Linux man pages: capabilities(7), namespaces(7), cgroups(7)
- Trail of Bits: Exploiting Linux Kernel Heap Consolidation (cgroup escape)
- NCC Group: A Guide to Linux Kernel Exploitation
