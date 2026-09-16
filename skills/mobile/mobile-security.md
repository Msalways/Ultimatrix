---
name: mobile-security
description: "Mobile application security testing: Android/iOS static analysis, Frida hooking, cert pinning bypass, intent injection, and storage flaws"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["mobile security", "android testing", "ios testing", "frida hooking", "certificate pinning bypass", "intent injection", "deep link abuse", "apk reversing", "jailbreak detection bypass", "mobile app security"]
mitreAttack: ["T1659", "T1404", "T1406"]
owaspRefs: ["OWASP Mobile Top 10"]
---

# Mobile Application Security

## When to Use

- You are testing a mobile application for security vulnerabilities
- You need to assess Android or iOS app security posture
- You are testing API security through the mobile client
- Assessing certificate pinning, root/jailbreak detection, or storage security

## Do Not Use

- Against apps you do not own or have permission to test
- To distribute modified apps to users
- To intercept traffic beyond the agreed engagement scope

## Auth Context

Mobile testing requires the app installed on a test device. For API testing through the app, use **httpRequest** with **getCapturedHeaders** to capture and replay mobile API calls.

---

## Phase 1: Static Analysis

### Android APK

```bash
# Decompile APK
apktool d app.apk -o app_decoded

# Extract Java source
jadx -d app_java app.apk

# Search for sensitive data
grep -r "password\|secret\|api_key\|token" app_decoded/
grep -r "http://" app_decoded/  # Cleartext traffic

# Check AndroidManifest.xml
cat app_decoded/AndroidManifest.xml
# Look for:
# - android:debuggable="true"
# - android:allowBackup="true"
# - android:usesCleartextTraffic="true"
# - Exported activities/services/receivers
# - android:exported="true" without permissions
```

### iOS IPA

```bash
# Extract IPA
unzip app.ipa -d app_extracted

# Class dump
class-dump app_extracted/Payload/App.app

# Check Info.plist
cat app_extracted/Payload/App.app/Info.plist
# Look for:
# - NSAppTransportSecurity (cleartext traffic)
# - UIFileSharingEnabled
# - ITSAppUsesNonExemptEncryption

# Binary analysis
otool -L app_extracted/Payload/App.app/App
# Check for weak security frameworks
```

---

## Phase 2: Dynamic Analysis

### Frida Instrumentation

```bash
# Install Frida
pip install frida-tools
frida-server  # Run on device

# Hook function
frida -U -f com.target.app -l hook.js

# hook.js
Java.perform(function() {
    var TargetClass = Java.use("com.target.app.SecurityCheck");
    TargetClass.isRooted.implementation = function() {
        console.log("Root check bypassed");
        return false;
    };
});
```

### Certificate Pinning Bypass

```bash
# Frida - bypass SSL pinning
frida -U -f com.target.app -l bypass.js

# bypass.js (using objection)
objection -g com.target.app explore
objection> android sslpinning disable

# Or manual hook
Java.perform(function() {
    var TrustManagerImpl = Java.use("com.android.org.conscrypt.TrustManagerImpl");
    TrustManagerImpl.verifyChain.implementation = function() {
        return arguments[0];
    };
});
```

### Objection

```bash
# Install objection
pip install objection

# Start exploration
objection -g com.target.app explore

# Bypass root detection
objection> android root disable

# Bypass SSL pinning
objection> android sslpinning disable

# List activities
objection> android hooking list activities

# List classes
objection> android hooking list classes

# Hook method
objection> android hooking watch class com.target.app.LoginActivity
```

---

## Phase 3: API Testing

### Capture Mobile API Calls

```bash
# Set up proxy
# - mitmproxy: mitmproxy -p 8080
# - Burp Suite: Configure proxy on device

# Configure device proxy
# Android: Settings → WiFi → Proxy → Manual
# iOS: Settings → WiFi → Configure Proxy → Manual

# Intercept API requests
# Capture authentication tokens
# Replay with httpRequest
```

### Common Mobile API Issues

```bash
# 1. Mass assignment
# Modify user profile with admin fields
POST /api/user/profile
{"role": "admin", "isVerified": true}

# 2. IDOR
# Change user ID in request
GET /api/user/123/profile → GET /api/user/456/profile

# 3. Broken auth
# Weak token validation
# Token not tied to device
# No token expiration
```

---

## Phase 4: Storage Analysis

### Android Storage

```bash
# Check shared preferences
cat /data/data/com.target.app/shared_prefs/*.xml

# Check databases
sqlite3 /data/data/com.target.app/databases/*.db

# Check internal storage
ls -la /data/data/com.target.app/files/

# Check external storage
ls -la /sdcard/Android/data/com.target.app/
```

### iOS Storage

```bash
# Check UserDefaults
cat /var/mobile/Containers/Data/Application/*/Library/Preferences/*.plist

# Check Keychain
# Use keychain-dumper on jailbroken device
keychain-dumper

# Check SQLite databases
sqlite3 /var/mobile/Containers/Data/Application/*/Documents/*.db
```

---

## Phase 5: Deep Link / URL Scheme Abuse

```bash
# Enumerate URL schemes
# Android: grep AndroidManifest.xml for intent-filter
# iOS: grep Info.plist for CFBundleURLSchemes

# Test deep link injection
# custom://profile?user_id=123
# custom://admin?action=delete&id=456

# Test universal links
# https://app.target.com/secret?token=abc
```

---

## Cheat Sheet — Quick Reference

| Test | Android | iOS |
|------|---------|-----|
| Decompile | `apktool d app.apk` | `class-dump` |
| Source extract | `jadx -d app_java app.apk` | `Hopper` / `IDA Pro` |
| Hook | `frida -U -f com.app -l hook.js` | `frida -U -f com.app -l hook.js` |
| Root bypass | `objection android root disable` | `objection jailbreak disable` |
| SSL bypass | `objection android sslpinning disable` | `objection ios sslpinning disable` |
| Storage | `/data/data/com.app/` | Keychain + UserDefaults |
| Deep links | `am start -a android.intent.action.VIEW -d "custom://..."` | `open custom://...` |

---

## Anti-Hallucination

- Mobile testing requires the actual app binary — never guess about vulnerabilities without static/dynamic analysis
- Certificate pinning bypass works only on rooted/jailbroken devices or with specific Frida hooks
- Deep link testing requires knowing the URL scheme — enumerate from manifest/plist first
- API vulnerabilities found through mobile testing should be verified independently via direct API calls
- Document the exact app version, OS version, and device model for each finding
