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
    # Directory fuzzing / recon
    gobuster ffuf subfinder \
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

# Optional Go tooling is bounded and never blocks image startup. The core
# scanners above come from Kali packages; this layer only adds httpx when the
# package mirror is reachable.
RUN timeout 180s go install github.com/projectdiscovery/httpx/cmd/httpx@latest || true

# Python tools (sqlmap is from apt, but ensure pip works)
RUN pip3 install --break-system-packages sqlmap 2>/dev/null || true

# Non-root user for execution
RUN useradd -m -s /bin/bash sandbox
ENV PATH="/root/go/bin:/home/sandbox/go/bin:${PATH}"
USER sandbox
WORKDIR /home/sandbox

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD which nmap || exit 1
