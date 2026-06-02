# CrAPI Validation Runbook

> **INTERNAL ONLY — not part of the public product surface.** This document
> describes how to validate the depth-first multi-session rebuild against a
> public CrAPI instance. CrAPI is OWASP's deliberately vulnerable API test
> bed; the creds below are test accounts, not real user data. Do not commit
> `CRAPI_URL` or `CRAPI_CREDS` to the repo. They must be set as env vars at
> run time.

## Why CrAPI

CrAPI exposes a multi-role auth model (mechanic, driver, admin) with
pre-seeded users and OWASP-API top-10 flaws. It is the only public,
no-Docker, no-signup test API we can use to validate that the new
`SessionPool` + `WorkflowStateGraph` + `AuthFlow` architecture can
actually detect IDOR, JWT bypass, and broken function authorization.

The npm package SDK constraint excludes Docker-based targets (DVWA,
bWAPP, Juice Shop). Public sites that work for un-authed recon
(xss-game.appspot.com, testphp.vulnweb.com) lack multi-role auth. CrAPI
is the validation target.

## Test categories

Each run should attempt to detect:

| ID    | OWASP-API | Endpoint                                      | Expected detection                                  |
| ----- | --------- | --------------------------------------------- | --------------------------------------------------- |
| BOLA1 | API1      | `GET /api/v1/vehicles/{id}` cross-user        | `idor-v2` finds it via `diff_sessions`              |
| BOLA2 | API1      | `GET /api/v1/users/{id}` cross-user           | `idor-v2` finds it via `diff_sessions`              |
| BFLA1 | API5      | `POST /api/v1/admin/playbooks` (driver token) | `auth-bypass-specialist` finds via `switch_session` |
| JWTA1 | API2      | Weak JWT secret allows forging admin token    | `jwt-v2` finds via `diff_sessions` after forgery    |
| OWNA1 | API3      | `PUT /api/v1/users/{id}/change-password`      | `idor-v2` finds via cross-session diff              |

## Running the smoke test

```bash
# Set env vars (do NOT commit)
export CRAPI_URL=https://crapi.apisec.ai
export CRAPI_CREDS='{"mechanic":{"email":"...","password":"..."},"driver":{"email":"...","password":"..."}}'

# Run the integration test
npx vitest run tests/integration/crapi-smoke.test.ts
```

If `CRAPI_URL` or `CRAPI_CREDS` is unset, the test is skipped. The
test uses the real `SessionPool` against the live CrAPI; it does NOT
mock the network. The Playwright browser must be installed via
`npx playwright install chromium`.

## Running 5x validation

```bash
# Run the full assess pipeline 5 times, varying the model temperature
for i in 1 2 3 4 5; do
  CRAPI_URL=... CRAPI_CREDS=... \
    npx ultimatrix assess -t $CRAPI_URL -o ./runs/run-$i \
    --depth 2 --max-runtime 600 --per-technique-budget 3
done
```

The `assess` command currently does NOT yet use `autonomous-v3`. To
validate the depth-first architecture, you must wire
`AutonomousV3Orchestrator` into the `assess` command explicitly (see
followup below). Until then, the smoke test (`crapi-smoke.test.ts`)
exercises `SessionPool`, `WorkflowStateGraph`, and `AuthFlow` in
isolation.

## Expected results

When the test runs against a live CrAPI, you should see:

1. `mechanic` and `driver` sessions logged in successfully.
2. `pool.diff('mechanic', 'driver', { url: '/api/v1/whoami' })`
   returns `bodyEqual: false` (different identities).
3. `AuthFlow.discoverAndPopulate()` returns 2 detected roles and 2
   populated sessions when the env creds JSON is provided.

If any of these fail, the test fails; document the failure mode in
the `Results` table below.

## Results (to be filled in)

| Run | Date | Mechanic login | Driver login | whoami diff | AuthFlow populated | Notes |
| --- | ---- | -------------- | ------------ | ----------- | ------------------ | ----- |
| 1   |      |                |              |             |                    |       |
| 2   |      |                |              |             |                    |       |
| 3   |      |                |              |             |                    |       |
| 4   |      |                |              |             |                    |       |
| 5   |      |                |              |             |                    |       |

## Followup

- **Wire `AutonomousV3Orchestrator` into the `assess` CLI command**
  so that 5x end-to-end validation runs exercise the full pipeline
  (spider -> workflow-state -> session pool -> worker -> specialist).
  Currently the `assess` command still uses the older single-session
  orchestrator. Without this, we are only validating the building
  blocks, not the full rebuild.
- **Wire `session_diff` and `session_switch` events into the
  dashboard** so live runs show session activity in real time.
  Currently the dashboard server emits the events, but the
  client-side handler does not render them yet.
- **Add CrAPI full-scan to CI** as an opt-in job that runs nightly
  with `RUN_INTEGRATION=1`.
- **Document a non-CrAPI test path** — `SessionPool` should also be
  validated against a locally-spawned mock server for reproducibility
  without external network dependency. Tracked in
  `tests/integration/fixtures/`.

## Out of scope

- Mutating CrAPI state (we use read-only diff tests).
- CrAPI test account creation (we use pre-seeded accounts from the
  public docs).
- Authenticated screenshots from production CrAPI (test only — never
  commit screenshots with real user data).
