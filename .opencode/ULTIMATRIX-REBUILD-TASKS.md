# Ultimatrix v7 Rebuild — E2E Task Breakdown

## Phase 1: Capture Infrastructure

### 1.1 HAR Parser (`src/capture/har-parser.ts`)
- [x] Define HAR types (HarEntry, HarRequest, HarResponse, HarArchive)
- [x] Implement `parseHar(raw: string): HarArchive`
- [x] Implement `getEntries(archive: HarArchive): HarEntry[]`
- [x] Implement `getEndpoints(entries: HarEntry[]): Endpoint[]`
- [x] Implement `getSecrets(entries: HarEntry[]): Secret[]`
- [x] Implement `getDataFlows(entries: HarEntry[]): DataFlow[]`
- [x] Unit test: parse valid HAR file
- [x] Unit test: parse invalid HAR throws
- [x] Unit test: extract endpoints from entries
- [x] Unit test: detect secrets in response bodies
- [x] Unit test: track data flows between requests

### 1.2 Network Capture (`src/capture/network-capture.ts`)
- [x] Implement `NetworkCapture` class
- [x] Implement `start(page: Page): void`
- [x] Implement `stop(): HarEntry[]`
- [x] Implement `getEntries(): HarEntry[]`
- [x] Implement `exportHar(): string`
- [x] Unit test: capture request/response pairs
- [x] Unit test: handle request body capture
- [x] Unit test: handle response body capture
- [x] Unit test: export valid HAR format

### 1.3 Browser Launcher (`src/capture/browser-launcher.ts`)
- [x] Implement `BrowserLauncher` class
- [x] Implement `launch(options: BrowserOptions): Browser`
- [x] Implement `newPage(browser: Browser): Page`
- [x] Implement `close(browser: Browser): void`
- [x] Unit test: launch with default options
- [x] Unit test: launch with custom options
- [x] Unit test: close cleans up resources

---

## Phase 2: LLM Analysis

### 2.1 Skill Loader Rewrite (`src/analysis/skill-loader.ts`)
- [x] Define `Skill` type (name, description, content, category)
- [x] Implement `loadSkill(name: string): Skill`
- [x] Implement `loadAllSkills(): Skill[]`
- [x] Implement `getSkillsByCategory(category: string): Skill[]`
- [x] Unit test: load skill from markdown file
- [x] Unit test: load all skills from directory
- [x] Unit test: filter skills by category

### 2.2 Instructions Rewrite (`src/analysis/instructions.ts`)
- [x] Define `Instructions` type
- [x] Implement `buildInstructions(skills: Skill[], harData: HarArchive): string`
- [x] Implement `buildReasoningFramework(): string`
- [x] Unit test: build instructions with skills
- [x] Unit test: build reasoning framework

### 2.3 HAR Analyzer (`src/analysis/har-analyzer.ts`)
- [x] Implement `HarAnalyzer` class
- [x] Implement `analyze(entries: HarEntry[]): AnalysisResult`
- [x] Implement `identifyPatterns(entries: HarEntry[]): Pattern[]`
- [x] Implement `generateHypotheses(patterns: Pattern[]): Hypothesis[]`
- [x] Unit test: identify API patterns
- [x] Unit test: generate attack hypotheses
- [x] Unit test: handle empty entries

### 2.4 Knowledge-Based Skills
- [x] Create `src/skills/authorization.md`
- [x] Create `src/skills/business-logic.md`
- [x] Create `src/skills/information-disclosure.md`
- [x] Create `src/skills/race-conditions.md`

---

## Phase 3: Test Generation

### 3.1 Enhance Test Generator (`src/generation/test-generator.ts`)
- [x] Refactor existing `test-generator.ts` for attack patterns
- [x] Implement `generateFromFinding(finding: Finding): TestCase[]`
- [x] Implement `generateSetupCode(session: Session): string`
- [x] Implement `generateAssertionCode(finding: Finding): string`
- [x] Unit test: generate test from IDOR finding
- [x] Unit test: generate test from XSS finding
- [x] Unit test: generate test from race condition finding

### 3.2 Test Parameterizer (`src/generation/test-parameterizer.ts`)
- [x] Implement `TestParameterizer` class
- [x] Implement `parameterize(test: TestCase, variations: Variation[]): TestCase[]`
- [x] Implement `generateUserVariants(users: User[]): Variation[]`
- [x] Implement `generatePayloadVariants(category: string): Variation[]`
- [x] Unit test: parameterize with user variants
- [x] Unit test: parameterize with payload variants

### 3.3 Test Storage (`src/generation/test-storage.ts`)
- [x] Implement `TestStorage` class
- [x] Implement `save(tests: TestCase[], dir: string): void`
- [x] Implement `load(dir: string): TestCase[]`
- [x] Implement `list(dir: string): string[]`
- [x] Unit test: save and load tests
- [x] Unit test: list test files

---

## Phase 4: Replay Engine

### 4.1 Test Runner (`src/replay/test-runner.ts`)
- [x] Implement `TestRunner` class
- [x] Implement `run(testFile: string): TestResult`
- [x] Implement `runAll(testDir: string): TestResult[]`
- [x] Unit test: run single test file
- [x] Unit test: run all test files
- [x] Unit test: handle test failure

### 4.2 Result Comparator (`src/replay/result-comparator.ts`)
- [x] Implement `ResultComparator` class
- [x] Implement `compare(baseline: TestResult[], current: TestResult[]): ComparisonResult`
- [x] Unit test: detect new findings
- [x] Unit test: detect fixed findings
- [x] Unit test: detect changed findings

### 4.3 Regression Detector (`src/replay/regression-detector.ts`)
- [x] Implement `RegressionDetector` class
- [x] Implement `detect(baseline: TestResult[], current: TestResult[]): Regression[]`
- [x] Unit test: detect regression
- [x] Unit test: detect no regression

### 4.4 Report Generator (`src/report/generator.ts`)
- [x] Implement `ReportGenerator` class
- [x] Implement `generateJson(findings: Finding[]): string`
- [x] Implement `generateHtml(findings: Finding[]): string`
- [x] Implement `generateMarkdown(findings: Finding[]): string`
- [x] Unit test: generate JSON report
- [x] Unit test: generate HTML report
- [x] Unit test: generate Markdown report

---

## Phase 5: HTTP Infrastructure

### 5.1 HTTP Client (`src/http/client.ts`)
- [x] Implement `HttpClient` class
- [x] Implement `get(url: string, options?: RequestOptions): Response`
- [x] Implement `post(url: string, options?: RequestOptions): Response`
- [x] Implement `put(url: string, options?: RequestOptions): Response`
- [x] Implement `delete(url: string, options?: RequestOptions): Response`
- [x] Implement automatic cookie persistence
- [x] Implement token injection
- [x] Unit test: GET request
- [x] Unit test: POST request
- [x] Unit test: cookie persistence
- [x] Unit test: token injection

### 5.2 Session Manager (`src/http/session-manager.ts`)
- [x] Implement `SessionManager` class
- [x] Implement `createSession(name: string): Session`
- [x] Implement `getSession(name: string): Session`
- [x] Implement `extractCookies(response: Response): void`
- [x] Unit test: create session
- [x] Unit test: extract cookies
- [x] Unit test: persist session

---

## Phase 6: SDK Entry Point

### 6.1 Ultimatrix Class (`src/sdk.ts`)
- [x] Implement `Ultimatrix` class
- [x] Implement `learn(): void`
- [x] Implement `generate(): void`
- [x] Implement `replay(): TestResult[]`
- [x] Implement `scan(): ScanResult`
- [x] Implement `getFindings(): Finding[]`
- [x] Implement `getTests(): TestCase[]`
- [x] Implement `exportReport(format: string): string`
- [x] Unit test: learn phase
- [x] Unit test: generate phase
- [x] Unit test: replay phase
- [x] Unit test: scan full cycle

### 6.2 CLI Rewrite (`src/cli/index.ts`)
- [x] Implement `scan` command
- [x] Implement `learn` command
- [x] Implement `generate` command
- [x] Implement `replay` command
- [x] Implement `report` command
- [x] Unit test: CLI commands

### 6.3 Config Schema (`src/config/schema.ts`)
- [x] Define `UltimatrixConfig` schema
- [x] Implement `validateConfig(config: unknown): UltimatrixConfig`
- [x] Implement `loadConfig(path: string): UltimatrixConfig`
- [x] Unit test: valid config
- [x] Unit test: invalid config throws

---

## Phase 7: Traditional Tools

### 7.1 Tool Wrappers (`src/tools/traditional-tools.ts`)
- [x] Implement `SqlMapWrapper` class
- [x] Implement `FfufWrapper` class
- [x] Implement `NucleiWrapper` class
- [x] Implement `NmapWrapper` class
- [x] Unit test: SQLMap execution
- [x] Unit test: ffuf execution

### 7.2 Delegator (`src/tools/delegator.ts`)
- [x] Implement `ToolDelegator` class
- [x] Implement `delegate(tool: string, target: string): ToolResult`
- [x] Unit test: delegate to SQLMap
- [x] Unit test: delegate to ffuf

---

## Phase 8: Polish

### 8.1 Error Handling
- [ ] Add try/catch to all tools
- [ ] Add error messages
- [ ] Add error logging

### 8.2 Documentation
- [ ] Update README.md
- [ ] Add API documentation
- [ ] Add usage examples

### 8.3 Performance
- [ ] Optimize test execution
- [ ] Add parallel test running
- [ ] Add memory cleanup

---

## Final Verification

- [x] All unit tests pass (448 tests total, 115 new)
- [x] TypeScript compilation succeeds (fixed new code errors)
- [ ] Build succeeds
- [ ] Lint passes
- [ ] E2E test with httpbin.org
