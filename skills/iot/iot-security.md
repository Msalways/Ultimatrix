---
name: iot-security
description: "IoT and embedded device security: hardware recon, firmware extraction, UART/JTAG, default credentials, MQTT/CoAP exploitation, and ICS protocols"
category: specialized
tier: powerful
toolRefs: [httpRequest, parseResponse, updateGraph, writeFinding, recordEvidence, getCapturedHeaders]
triggers: ["iot security", "firmware extraction", "uart", "jtag", "swd", "mqtt exploitation", "coap", "ics security", "scada", "plc", "embedded device", "hardware hacking", "iot pentest"]
mitreAttack: ["T1190", "T1133", "T1571"]
owaspRefs: ["OWASP IoT Top 10"]
---

# IoT & Embedded Device Security

## When to Use

- You are testing an IoT device for security vulnerabilities
- You need to assess firmware security or hardware attack surface
- You are testing MQTT/CoAP/Modbus protocols
- Assessing whether embedded devices expose the network to compromise

## Do Not Use

- Against devices you do not own or have permission to test
- To extract firmware for unauthorized reproduction
- On medical/ICS devices in production environments without explicit authorization

## Auth Context

IoT testing often involves direct hardware access or protocol-level testing. For any HTTP-based management interfaces, use **httpRequest** with **getCapturedHeaders** for auth context.

---

## Phase 1: Hardware Reconnaissance

### Visual Inspection

```bash
# Identify components
# - Main MCU/SoC
# - Flash memory chips
# - Debug headers (UART, JTAG, SWD)
# - Antenna (WiFi, BLE, Zigbee)
# - Unpopulated headers

# Look for:
# - PCB silkscreen labels (TX, RX, GND, VCC, JTAG, SWD)
# - UART pins (typically 4 pins: VCC, GND, TX, RX)
# - JTAG pins (TDI, TDO, TCK, TMS, TRST)
# - Test points
```

### UART Discovery

```bash
# Connect to UART pins
# Baud rate: common rates (9600, 115200, 57600, 38400)
screen /dev/ttyUSB0 115200
minicom -D /dev/ttyUSB0 -b 115200

# Or use picocom
picocom -b 115200 /dev/ttyUSB0

# Common UART access:
# - Boot log (reveals firmware version, boot process)
# - Shell access (if not password-protected)
# - Debug console
```

### JTAG/SWD Discovery

```bash
# Identify JTAG pins
# Use JTAGulator or Bus Pirate
jtagulator -d /dev/ttyUSB0

# SWD (Serial Wire Debug)
# Common on ARM Cortex-M
# 2 pins: SWDIO, SWCLK
# Use OpenOCD for debugging
openocd -f interface/stlink.cfg -f target/stm32f1x.cfg
```

---

## Phase 2: Firmware Extraction

### Via UART

```bash
# If bootloader allows firmware read
# U-Boot commands:
=> md.b 0x08000000 0x100000  # Read flash
=> tftp 0x80000000 firmware.bin  # Download firmware
```

### Via Flash Dump

```bash
# SPI flash read
# Use flashrom with CH341A programmer
flashrom -p ch341a_spi -r firmware.bin

# Or use Bus Pirate
flashrom -p buspirate_spi:dev=/dev/ttyUSB0 -r firmware.bin
```

### Via Update Download

```bash
# Intercept firmware update
# - Monitor HTTP traffic for update URLs
# - Download firmware file
# - Extract filesystem

# Common update mechanisms
wget http://device.local/firmware/update.bin
binwalk -e update.bin
```

---

## Phase 3: Firmware Analysis

### Filesystem Extraction

```bash
# Extract filesystem
binwalk -e firmware.bin

# Or manually with firmware-mod-kit
./extract-firmware.sh firmware.bin

# Analyze filesystem
ls -la _firmware.extracted/squashfs-root/
cat _firmware.extracted/squashfs-root/etc/passwd
cat _firmware.extracted/squashfs-root/etc/shadow
```

### Hardcoded Secrets

```bash
# Search for credentials
grep -r "password" _firmware.extracted/
grep -r "secret" _firmware.extracted/
grep -r "api_key" _firmware.extracted/
grep -r "private" _firmware.extracted/

# Search for certificates
find _firmware.extracted/ -name "*.pem" -o -name "*.crt" -o -name "*.key"

# Search for hardcoded IPs
grep -r "192.168\." _firmware.extracted/
grep -r "10.0.0\." _firmware.extracted/
```

### Binary Analysis

```bash
# Check for known vulnerable libraries
strings busybox | grep -i version
strings openssl | grep -i version

# Identify services
cat _firmware.extracted/squashfs-root/etc/init.d/*
cat _firmware.extracted/squashfs-root/etc/inittab
```

---

## Phase 4: Network Protocol Attacks

### MQTT Exploitation

```bash
# Connect to MQTT broker
mosquitto_sub -h 192.168.1.100 -t '#'

# Publish to topic
mosquitto_pub -h 192.168.1.100 -t 'device/command' -m '{"action":"reboot"}'

# If no auth required:
# - Subscribe to all topics (#)
# - Publish to device control topics
# - Extract credentials from messages
```

### CoAP Exploitation

```bash
# Discover CoAP devices
coap-client -m get coap://192.168.1.100/.well-known/core

# Read resource
coap-client -m get coap://192.168.1.100/api/config

# Write resource (if allowed)
coap-client -m put coap://192.168.1.100/api/config -e '{"admin":true}'
```

### Modbus/ICS

```bash
# Modbus discovery
nmap -sU -p 502 192.168.1.0/24

# Read holding registers
modbus-cli -h 192.168.1.100 read-holding 0 10

# Write register (if authorized)
modbus-cli -h 192.168.1.100 write-register 0 1 1
```

---

## Phase 5: Default Credentials

### Common Defaults

| Device | Username | Password |
|--------|----------|----------|
| Router | admin | admin |
| Router | admin | password |
| Camera | admin | 12345 |
| IoT Hub | admin | (blank) |
| PLC | admin | admin |
| Printer | admin | admin |

### Brute Force

```bash
# Hydra
hydra -l admin -P passwords.txt 192.168.1.100 http-get /login
hydra -l root -P passwords.txt 192.168.1.100 ssh
```

---

## Cheat Sheet — Quick Reference

| Phase | Tool/Command |
|-------|-------------|
| UART connect | `screen /dev/ttyUSB0 115200` |
| JTAG scan | `jtagulator -d /dev/ttyUSB0` |
| Firmware extract | `flashrom -p ch341a_spi -r firmware.bin` |
| Filesystem | `binwalk -e firmware.bin` |
| MQTT subscribe | `mosquitto_sub -h IP -t '#'` |
| CoAP discover | `coap-client -m get coap://IP/.well-known/core` |
| Default creds | `hydra -l admin -P passwords.txt IP http-get /` |

---

## Anti-Hallucination

- IoT testing requires physical access to the device — never claim vulnerabilities without hardware confirmation
- Firmware analysis reveals potential vulnerabilities, but exploitation depends on the running version
- MQTT/CoAP protocols often lack authentication by design — document this as a configuration issue
- Default credentials should be tested against the specific device model
- Document the exact device model, firmware version, and hardware revision for each finding
