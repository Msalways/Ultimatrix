# Ultimatrix User Guide

This guide covers the normal operating workflow for Ultimatrix across the Web workspace, CLI, and SDK.

> [!IMPORTANT]
> Run security testing only against targets you own or have explicit permission to assess. Keep the configured target and every discovered endpoint within the approved scope.

## Contents

- [Install](#install)
- [First-time setup](#first-time-setup)
- [Web workspace](#web-workspace)
- [CLI workspace](#cli-workspace)
- [SDK usage](#sdk-usage)
- [Configuration and provider keys](#configuration-and-provider-keys)
- [Sessions and persistence](#sessions-and-persistence)
- [Browser and human actions](#browser-and-human-actions)
- [Findings and reports](#findings-and-reports)
- [Move to another device](#move-to-another-device)
- [Troubleshooting](#troubleshooting)

## Install

### Requirements

- Node.js 22.13 or newer
- npm
- A model-provider account and API key
- Chromium for browser-assisted work

```bash
git clone https://github.com/Msalways/Ultimatrix.git
cd Ultimatrix
npm install
npx playwright install chromium
```

Verify the CLI:

```bash
npx ultimatrix --version
npx ultimatrix --help
```

## First-Time Setup

Run the setup wizard from the project root:

```bash
npx ultimatrix init
```

The wizard configures:

1. A provider and model.
2. Provider authentication.
3. The default execution engine.
4. Browser behavior.
5. Project-level configuration files.

Confirm the active paths:

```bash
npx ultimatrix config path
```

Ultimatrix should report two files in the current project:

```text
ultimatrix.yaml   runtime behavior
providers.yaml    provider secrets
```

Do not commit `providers.yaml`. It is included in the repository ignore rules.

## Web Workspace

Start the application:

```bash
npx ultimatrix web
```

The default address is `http://localhost:3000`. Set `PORT` or `HOST` before starting the command when a different listener is required.

### 1. Add a target

Enter an HTTP or HTTPS target in the target selector. Ultimatrix normalizes the URL and creates a persisted target session.

Creating a target does **not** immediately launch a browser or assessment engine. Those resources initialize when a run needs them.

### 2. Choose Ask or Run

The composer has two explicit modes:

| Mode | Use it when | What happens |
|---|---|---|
| **Ask** | You want an explanation, status, summary, or answer from existing case context | Reads the active target state without starting an assessment |
| **Run** | You want Ultimatrix to execute research or testing | Starts an engine turn with tools, scope, and budget controls |

Examples for **Ask**:

```text
Summarize what has already been tested.
Which auth flows have been observed?
What are the highest-value untested areas?
```

Examples for **Run**:

```text
Fingerprint the landing page and map its redirects.
Inspect the password-reset flow for authorization weaknesses.
Test the observed API roles for object-level authorization gaps.
```

### 3. Read the stream

The timeline distinguishes these event types:

- model reasoning;
- tool calls and tool results;
- worker activity;
- evidence and findings;
- successful completion;
- cancellation;
- tool or frontier exhaustion;
- errors and retry actions.

The footer summarizes duration, tool calls, and findings. A run that executed no tests is not presented as a successful assessment.

### 4. Inspect the case

Use the workspace panels to review:

- target sessions;
- knowledge-graph state;
- findings;
- loaded skills;
- current phase and budget;
- browser capture status.

### 5. Reload or return later

Reloading the page restores persisted target sessions and chat history. Graph and finding views read the target's stored graph even when no engine is currently running.

Removing a target from the Web session list closes its live engine and hides the session. It does not imply secure erasure of every target artifact from disk.

## CLI Workspace

### Interactive research

```bash
npx ultimatrix interact -t https://app.example.com
```

Use plain terminal output when rich rendering is unsuitable:

```bash
npx ultimatrix interact -t https://app.example.com --plain
```

Interactive commands:

| Command | Action |
|---|---|
| `/status` | Show target, engine, model, and graph counts |
| `/reasoning` or `/r` | Show reasoning from the previous turn |
| `/report` | Write a Markdown report for the engagement |
| `/report <finding-id>` | Write a report for one finding |
| `/clear` | Clear the terminal view |
| `/exit` or `/quit` | Save and end the session |

### Focused commands

| Goal | Command |
|---|---|
| Resume target context | `npx ultimatrix resume -t <url>` |
| Autonomous OODA assessment | `npx ultimatrix solve -t <url>` |
| Capture and model a target | `npx ultimatrix learn -t <url>` |
| Learn, test, and report | `npx ultimatrix scan -t <url>` |
| Generate test cases | `npx ultimatrix generate -t <url>` |
| Replay generated tests | `npx ultimatrix replay -o <dir>` |
| Recheck findings | `npx ultimatrix verify -t <url>` |
| Export a report | `npx ultimatrix report -t <url> --format html` |
| Inspect models | `npx ultimatrix models` |
| Inspect tool availability | `npx ultimatrix tools` |
| Inspect budgets | `npx ultimatrix budget` |

Supported report formats are `markdown`, `html`, and `json`.

## SDK Usage

Use the SDK when Ultimatrix needs to be part of CI or a custom orchestration process:

```ts
import { Ultimatrix } from 'ultimatrix'

const researcher = new Ultimatrix({
  target: 'https://app.example.com',
  outputDir: './output',
})

try {
  const analysis = await researcher.learn()
  const tests = await researcher.generate()
  const result = await researcher.scan()

  console.log({
    endpoints: analysis.endpoints.length,
    generatedTests: tests.length,
    findings: result.findings.length,
  })
} finally {
  await researcher.close()
}
```

`learn()` models the target, `generate()` creates test cases, `scan()` runs the combined workflow, and `replay()` reruns generated tests. Always close the instance to release browser and runtime resources.

## Configuration and Provider Keys

### One source for behavior

`ultimatrix.yaml` is the shared behavioral configuration for Web and CLI.

```yaml
provider: nvidia
model: meta/llama-3.1-70b-instruct
engine: solver

solver:
  maxToolCalls: 50
  maxTokens: 100000
  maxDurationMs: 300000
  maxParallel: 1

antiLoop:
  staleThreshold: 3

reflexion:
  persistToGraph: true
```

Web Settings writes through the same configuration layer. An idle Web engine checks for external changes before the next turn.

### A separate source for secrets

`providers.yaml` stores provider authentication. Keeping secrets separate prevents ordinary behavior configuration from becoming a credential bundle.

List registered providers without printing their keys:

```bash
npx ultimatrix providers list
```

Add a provider or update it in place:

```bash
npx ultimatrix providers set nvidia
```

The prompt masks secret input. When a provider already exists, leave the key blank to retain it while changing another field such as the base URL.

Remove a provider:

```bash
npx ultimatrix providers remove openrouter
```

Removal requires confirmation.

> [!NOTE]
> Provider keys are intentionally not accepted through a `--key` argument. Command-line secrets can leak through shell history, process inspection, logs, and copied commands.

### Web provider settings

Open **Settings -> Providers** to add, update, or remove credentials. Existing keys are masked. Saving unrelated settings must not replace a stored key with its masked placeholder.

### Legacy credential migration

If credentials were previously stored in the user-level Ultimatrix configuration, import them into the project store:

```bash
npx ultimatrix config migrate-credentials
```

Review the reported paths and delete the legacy copy only after confirming the new provider store works.

### CI and temporary environments

Environment variables can supply provider credentials for ephemeral environments. For local Web and CLI use, `providers.yaml` is the persistent project store.

## Sessions and Persistence

Ultimatrix keeps each target in a separate directory:

```text
output/
  app-example-com/
    graph.json
    web-chat-history.json
    forensic.ndjson
    oast-callbacks.json
    reports/
    scans/
```

The exact files present depend on the operations run.

### What survives a reload

- target session metadata;
- Web chat history;
- graph nodes and edges;
- findings recorded in the graph;
- forensic events already written;
- generated reports and scan artifacts.

### What is intentionally live

- an active model stream;
- in-memory engine objects;
- browser processes and pages;
- transient progress indicators.

After a restart, Ultimatrix reconstructs the case from persisted data and creates live resources only when needed.

### Back up a case

Stop active runs, then copy the relevant `output/<target>/` directory. Treat case data as sensitive: it may contain target URLs, request metadata, evidence, or authentication-related observations.

## Browser and Human Actions

Browser automation uses a managed Playwright/Stagehand session.

### Browser lifecycle

- Adding a Web target does not open a browser.
- Asking about persisted context does not require a browser.
- A browser starts when an execution path requests browser capabilities.
- The Web status bar shows whether capture is active and how many pages are open.
- Use the status-bar close control to stop the automation browser.

### Human-action capture

When capture is active, Ultimatrix can observe actions such as navigation, clicks, and form input so they can inform flow reproduction and auth understanding.

For a login or complex business flow:

1. Start a Run that requests browser observation.
2. Confirm the status bar shows capture is active.
3. Complete the permitted flow in the managed browser window.
4. Return to Ultimatrix and ask it to summarize the observed flow.
5. Save or reproduce the flow only within the approved target scope.

Do not enter personal or production credentials unless the engagement explicitly permits their capture and storage.

## Findings and Reports

A finding should be backed by tool evidence, not only model text. Ultimatrix routes observed facts through its evidence ledger and verification gate before reporting confirmed claims.

Generate a report from the CLI:

```bash
npx ultimatrix report -t https://app.example.com --format markdown
npx ultimatrix report -t https://app.example.com --format html
npx ultimatrix report -t https://app.example.com --format json
```

In an interactive session:

```text
/report
/report finding-id
```

Reports are written beneath the target workspace or configured output directory. Always review evidence, scope, severity, and reproduction steps before sharing a report.

## Move to Another Device

Behavior and secrets must travel separately.

1. Install Ultimatrix and Chromium on the new device.
2. Copy `ultimatrix.yaml` into the project root.
3. Transfer `providers.yaml` through an approved secret-sharing channel.
4. Copy required `output/<target>/` directories when case continuity is needed.
5. Run `npx ultimatrix config path` on the new device.
6. Run `npx ultimatrix providers list` to confirm provider registration.
7. Start with an **Ask** request to confirm the target context before executing new tests.

Never commit `providers.yaml` or place its contents in issue trackers, chat messages, screenshots, or ordinary file-sharing links.

## Troubleshooting

### The configured provider is not available

```bash
npx ultimatrix config path
npx ultimatrix providers list
npx ultimatrix providers set <provider>
```

Confirm the provider selected in `ultimatrix.yaml` has a matching entry in `providers.yaml`.

### A Web setting does not appear in the CLI

Check that both commands are running from the same project root:

```bash
npx ultimatrix config path
```

If a run was already active, finish or cancel it. Configuration changes are applied to idle engines before their next turn; they do not rewrite an in-flight request.

### Reloading the Web UI shows no target

Confirm that the project contains the expected `output/<target>/` directory and session metadata. Run the Web command from the same working directory used to create the case.

### The browser did not open

An **Ask** request and target creation are intentionally browser-free. Start a **Run** that actually needs browser tools. If launch still fails:

```bash
npx playwright install chromium
npx ultimatrix tools
```

### The run stopped with `frontier_exhausted`

The engine found no eligible next action under the current state, tools, scope, or budget. Review the stream and then:

- provide a more specific goal;
- add missing auth or target context;
- inspect tool availability;
- adjust scope or budget only when authorized;
- use **Ask** to identify untested graph areas before starting another run.

### A provider key must be rotated

Do not remove the provider first. Update it directly:

```bash
npx ultimatrix providers set <provider>
```

Enter the replacement key at the masked prompt. The provider entry is updated in place.

### Port 3000 is already in use

In PowerShell:

```powershell
$env:PORT=3001
npx ultimatrix web
```

Then open `http://localhost:3001`.

## More Documentation

- [Project overview](../README.md)
- [Architecture](ARCHITECTURE.md)
- CLI help: `npx ultimatrix --help`
