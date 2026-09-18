FROM kalilinux/kali-rolling

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# System essentials + security tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core utilities
    curl wget git unzip \
    # Network scanning
    nmap masscan \
    # Web app testing
    nuclei sqlmap nikto \
    # Directory fuzzing
    gobuster \
    # Password attacks
    hydra john \
    # DNS/Recon
    dnsrecon whois \
    # Network analysis
    tshark tcpdump netcat-openbsd socat \
    # Post-exploitation
    smbclient \
    # Forensics
    binwalk exiftool \
    # Languages
    python3 python3-pip golang-go \
    # Wordlists
    seclists \
    # Cleanup
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Go tools (nuclei, ffuf, subfinder, httpx, amass)
RUN go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest 2>/dev/null || true \
    && go install github.com/ffuf/ffuf/v2@latest 2>/dev/null || true \
    && go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest 2>/dev/null || true \
    && go install github.com/projectdiscovery/httpx/cmd/httpx@latest 2>/dev/null || true

# Python tools (sqlmap is from apt, but ensure pip works)
RUN pip3 install --break-system-packages sqlmap 2>/dev/null || true

# Non-root user for execution
RUN useradd -m -s /bin/bash sandbox
USER sandbox
WORKDIR /home/sandbox

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD which nmap || exit 1
