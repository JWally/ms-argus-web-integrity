# Code Review: Dependency Injection Opportunities (Round 4)

Previous reviews focused on structural splits and duplication removal. This review asks a different question: **would dependency injection make this code more testable, shorter, clearer, and easier to maintain?**

The short answer: yes, but surgically. Not a DI framework. Not a container. Just passing things in instead of reaching out for them.

---

## The Problem

The existing tests tell the story. `canvas/index.test.ts` tests that `PICASSO_COLORS` has 50 entries. `lies/index.test.ts` tests that regex patterns match expected strings. These are constant-validation tests — they confirm data exists. They don't test behavior.

The behavioral code — the actual fingerprinting logic, lie detection decisions, bot scoring — is untestable because every module reaches out and grabs globals:

```typescript
// canvas/index.ts:91-109
const dataLie = !!lieProps['HTMLCanvasElement.toDataURL'];
const contextLie = !!lieProps['HTMLCanvasElement.getContext'];
// ...
```

```typescript
// navigator/index.ts:30-31
import { attempt, caniuse, captureError } from '../errors';
import { lieProps, documentLie, getPluginLies } from '../lies';
```

```typescript
// lies/index.ts:96-98 — runs on import
const { lieDetector, lieList, lieDetail, propsSearched } = getPrototypeLies(
  PHANTOM_DARKNESS as Window & typeof globalThis,
);
```

You can't test `checkCanvasLies()` without the lie detection module having already run. You can't test `getNavigator()` without lieProps being populated. You can't test `collectFingerprint()` without every collector module being importable (which means a full browser environment).

---

## What DI Would NOT Fix

Some things are inherently untestable without a real browser:

- Canvas pixel rendering (GPU-dependent)
- WebGL parameter enumeration (driver-dependent)
- AudioContext fingerprinting (audio pipeline-dependent)
- Font detection via TextMetrics (font renderer-dependent)
- Web Worker spawning (engine-dependent)

These need integration tests in a real browser (Playwright, not happy-dom). DI won't change that, and pretending otherwise with mocks would be self-gratification — tests that pass but prove nothing.

---

## What DI WOULD Fix

The core insight: every collector module contains two concerns tangled together:

1. **Collection** — talks to browser APIs, inherently environment-dependent
2. **Decision logic** — interprets collected data, detects anomalies, scores signals

Right now these are fused. DI separates them so the decision logic becomes testable with real data (captured from actual browsers, stored as fixtures) without needing the browser present at test time.

---

## Opportunity 1: LieProps as Parameter (~15 modules, ~0 LOC change)

### Current

Every module imports `lieProps` from `../lies` and reads it directly:

```typescript
// canvas/index.ts
import { lieProps } from '../lies';

function checkCanvasLies() {
  const dataLie = !!lieProps['HTMLCanvasElement.toDataURL'];
  // ...
}
```

This means:

- `lies/index.ts` must have already executed (side effects at import time)
- The module can't be tested with a known lieProps state
- No way to test "what happens when HTMLCanvasElement.toDataURL is lied?"

### With DI

```typescript
function checkCanvasLies(lieProps: Record<string, number>) {
  const dataLie = !!lieProps['HTMLCanvasElement.toDataURL'];
  // ...
}

export default async function getCanvas2d(
  lieProps: Record<string, number>,
): Promise<CanvasFingerprint | undefined> {
  const { textMetricsLie, lied } = checkCanvasLies(lieProps);
  // ...
}
```

The orchestrator (`fingerprint.ts`) already has lieProps — it calls `getLies()`. It just passes it down.

### Impact

| Metric      | Before                                         | After                                        |
| ----------- | ---------------------------------------------- | -------------------------------------------- |
| Testability | Can't test lie-dependent branching             | Test any lieProps combination with real data |
| LOC         | Same                                           | Same (add parameter, remove import)          |
| Clarity     | Hidden dependency on module load order         | Explicit: function needs lie data to work    |
| Maintenance | Changing lies module breaks importers silently | Type error if interface changes              |

### Modules Affected

`canvas`, `navigator`, `fonts`, `screen`, `webgl`, `audio`, `css`, `cssmedia`, `domrect`, `document`, `headless`, `window`, `features`, `worker`, `svg`

### What Becomes Testable

```typescript
it('marks canvas as lied when toDataURL is tampered', () => {
  const result = checkCanvasLies({ 'HTMLCanvasElement.toDataURL': 1 });
  expect(result.lied).toBe(true);
  expect(result.dataLie).toBe(true);
});

it('does not flag lies when lieProps is clean', () => {
  const result = checkCanvasLies({});
  expect(result.lied).toBe(false);
});
```

No mocks. Real logic. Real assertions.

---

## Opportunity 2: Error Collector as Parameter (~20 modules, net -30 LOC)

### Current

`errors/index.ts` already uses a factory (`createErrorsCaptured`), then immediately exports a singleton:

```typescript
const errorsCaptured = createErrorsCaptured();
const { captureError } = errorsCaptured;
export { captureError, attempt, errorsCaptured };
```

Every module imports `captureError` and `attempt` from this singleton. The `attempt` wrapper is used hundreds of times.

### With DI

The factory already exists. Just stop exporting the singleton as the primary interface:

```typescript
export interface ErrorCollector {
  captureError: (error: Error, msg?: string) => undefined;
  attempt: <T>(fn: () => T, msg?: string) => T | undefined;
  getErrors: () => CapturedError[];
}

export function createErrorCollector(): ErrorCollector {
  /* existing logic */
}
```

Collectors receive it:

```typescript
export default async function getCanvas2d(deps: {
  lieProps: Record<string, number>;
  errors: ErrorCollector;
}): Promise<CanvasFingerprint | undefined> {
  const { attempt } = deps.errors;
  // ...
}
```

### Impact

| Metric      | Before                                                            | After                                  |
| ----------- | ----------------------------------------------------------------- | -------------------------------------- |
| Testability | Can't verify error capture behavior                               | Inspect captured errors per-module     |
| LOC         | -30 (remove try/catch boilerplate in tests that fight the global) |                                        |
| Clarity     | Implicit global error bucket                                      | Each collector has its own error scope |
| Maintenance | Error in one module pollutes global state for others              | Isolated error tracking                |

### What Becomes Testable

```typescript
it('captures error when canvas context is null', () => {
  const errors = createErrorCollector();
  // getCanvas2d with a DOM that returns null context
  expect(errors.getErrors()).toContainEqual(
    expect.objectContaining({ trustedName: 'Error' }),
  );
});
```

---

## Opportunity 3: Separate Collection from Analysis in Collectors (~8 modules, -50 to -100 LOC)

### Current

Each collector does everything in one function:

```typescript
export default async function getNavigator(workerScope) {
  // 1. Check lies (decision logic - testable)
  let lied = !!(lieProps['Navigator.appVersion'] || ...);

  // 2. Collect raw data (browser-dependent - not unit-testable)
  const platform = attempt(() => navigator.platform);
  const userAgent = attempt(() => navigator.userAgent);

  // 3. Validate and cross-reference (decision logic - testable)
  if (!isCredibleUserAgent()) { lied = true; }
  if (gibberish(userAgent)) { sendToTrash('userAgent', 'contains gibberish'); }

  // 4. Hash and return (pure function - testable)
  return { data, $hash: hashMini(data), lied };
}
```

Steps 1, 3, and 4 are pure logic. Step 2 is environment-dependent. They're inseparable as written.

### With DI

Split each collector into two functions:

```typescript
// navigator/collect.ts — browser-dependent, not unit-tested
export function collectNavigatorData(win: Window): RawNavigatorData {
  return {
    platform: attempt(() => win.navigator.platform),
    userAgent: attempt(() => win.navigator.userAgent),
    // ...
  };
}

// navigator/analyze.ts — pure logic, fully testable
export function analyzeNavigator(
  raw: RawNavigatorData,
  lieProps: Record<string, number>,
  workerScope: WorkerScopeData | null,
): NavigatorFingerprint {
  let lied = !!(lieProps['Navigator.appVersion'] || ...);
  if (!isCredibleUserAgent(raw.userAgent, raw.appVersion)) { lied = true; }
  // ...
  return { data, $hash: hashMini(data), lied };
}

// navigator/index.ts — thin orchestration
export default async function getNavigator(workerScope, deps) {
  const raw = collectNavigatorData(deps.win);
  return analyzeNavigator(raw, deps.lieProps, workerScope);
}
```

### Impact

| Metric      | Before                                                                        | After                                                              |
| ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Testability | Can't test anomaly detection without a browser                                | Test with captured browser data fixtures                           |
| LOC         | Net reduction where validation logic is complex (navigator, headless, canvas) |                                                                    |
| Clarity     | Reading a 400-line function trying to find "where does it detect spoofing?"   | Two files: collection is boring, analysis is where the logic lives |
| Maintenance | Changing a validation rule requires browser testing                           | Change rule, run unit tests, done                                  |

### Best Candidates

| Module            | Analysis Lines | Collection Lines | Ratio        |
| ----------------- | -------------- | ---------------- | ------------ |
| `navigator`       | ~280           | ~120             | 2.3:1        |
| `headless`        | ~350           | ~50              | 7:1          |
| `canvas`          | ~100           | ~80              | 1.25:1       |
| `resistance`      | ~200           | ~40              | 5:1          |
| `inconsistencies` | ~700           | ~50              | 14:1         |
| `status`          | ~300           | ~100             | 3:1          |
| `fonts`           | ~80            | ~150             | 0.5:1 (skip) |
| `webgl`           | ~60            | ~300             | 0.2:1 (skip) |

Modules where analysis >> collection benefit most. Modules where collection dominates (fonts, webgl) get little value — their logic IS the collection.

### What Becomes Testable

```typescript
// Captured from a real headless Chrome session:
const headlessFixture: RawHeadlessData = {
  chromeGet: false,
  webDriverGet: true,
  permissions: { state: 'prompt' },
  // ...
};

it('detects webdriver-based headless', () => {
  const result = analyzeHeadless(headlessFixture, {}, null);
  expect(result.headless).toBe(true);
  expect(result.stealthSignals.webdriver).toBe(true);
});
```

Real data from a real browser. No mocks. The test proves the detection logic works.

---

## Opportunity 4: Kill the Side-Effect Import in `lies/index.ts` (~1 module, -20 LOC, major clarity gain)

### Current

```typescript
// lies/index.ts:95-98 — executes on import!
const start = performance.now();
const { lieDetector, lieList, lieDetail, propsSearched } = getPrototypeLies(
  PHANTOM_DARKNESS as Window & typeof globalThis,
);
```

Any module that imports from `../lies` triggers full prototype scanning of 100+ APIs. This:

- Makes import order matter (fragile)
- Makes test setup require the full lies module to run
- Makes it impossible to test a module that imports lies without the scan running
- Adds ~100-300ms to any test file that touches lies

### With DI

Make lie scanning explicit rather than implicit:

```typescript
// lies/index.ts — no top-level execution
export { createLieRecords } from './records';
export { createLieDetector } from './detector';
export { getPrototypeLies } from './scanner';
// ...

// fingerprint.ts (orchestrator) — explicitly runs the scan
const phantom = createPhantomDarkness();
const { lieDetector, lieList, lieDetail } = getPrototypeLies(phantom);
const lieProps = computeLieProps(lieDetector);
// pass lieProps to collectors...
```

### Impact

| Metric      | Before                                              | After                                     |
| ----------- | --------------------------------------------------- | ----------------------------------------- |
| Testability | Importing lies triggers 100+ API scans              | Import is inert; scan is explicit         |
| LOC         | -20 (remove the IIFE, setTimeout, conditional)      |                                           |
| Clarity     | "Why is my test slow?" → hidden import side effect  | Scan is called where it's needed          |
| Maintenance | Can't change scan timing without breaking importers | Scan timing is the orchestrator's concern |

---

## Opportunity 5: Orchestrator Becomes Testable (`fingerprint.ts`, ~0 LOC change)

### Current

`collectFingerprint()` imports 24 collector functions at the top of the file. You can't test the orchestration logic (how it assembles results, computes hashes, detects bots) without all 24 collectors being importable and executable.

### With DI

```typescript
export interface CollectorResults {
  canvas: CanvasFingerprint | null;
  navigator: NavigatorFingerprint | null;
  // ...
}

export function assembleFingerprint(
  results: CollectorResults,
  imports: { getFeaturesLie, computeWindowsRelease, ... },
): FingerprintResult {
  // Bot hash computation
  // Stable/loose hash assembly
  // Fuzzy hash generation
  // All currently in collectFingerprint() after the Promise.all
}
```

The assembly logic (lines 192-end of fingerprint.ts) is pure data transformation. It doesn't touch the DOM. It just needs the collected results as input.

### What Becomes Testable

```typescript
it('flags bot when lie count exceeds threshold', () => {
  const results = createBaseResults();
  results.lies = {
    data: { 'Navigator.userAgent': ['failed toString'] },
    totalLies: 5,
  };
  const fp = assembleFingerprint(results, defaultImports);
  expect(fp.botSignals.hasLies).toBe(true);
});

it('computes stable hash ignoring volatile fields', () => {
  const results1 = createBaseResults({ timestamp: 1000 });
  const results2 = createBaseResults({ timestamp: 2000 });
  const fp1 = assembleFingerprint(results1, defaultImports);
  const fp2 = assembleFingerprint(results2, defaultImports);
  expect(fp1.hashes.stable).toBe(fp2.hashes.stable);
});
```

---

## Opportunity 6: Window/Document Injection (already half-done)

### Current

The canvas module already does this partially:

```typescript
// canvas/index.ts:148-152
let win: Window = window;
if (!LIKE_BRAVE && PHANTOM_DARKNESS) {
  win = PHANTOM_DARKNESS as Window;
}
const doc = win.document;
```

But `PHANTOM_DARKNESS` is a global import, and the decision of which window to use is made inside the collector.

### With DI

```typescript
export default async function getCanvas2d(deps: {
  win: Window;
  lieProps: Record<string, number>;
  errors: ErrorCollector;
}): Promise<CanvasFingerprint | undefined> {
  const doc = deps.win.document;
  const canvas = doc.createElement('canvas');
  // ...
}
```

The orchestrator decides which window to use. The collector just uses what it's given. This pattern already exists conceptually — DI just makes it consistent.

---

## What NOT to Inject

Some things should stay as direct imports:

- **Constants** (`CANVAS_SIZES`, `PICASSO_COLORS`, etc.) — immutable, no testing benefit from injection
- **Pure utility functions** (`hashMini`, `getOS`, `decryptUserAgent`) — stateless, deterministic, test them directly
- **Type imports** — zero runtime effect
- **The `queueEvent`/`createTimer` helpers** — scheduling plumbing, not decision logic

Don't inject things just because you can. Inject things that are either:

1. Mutable state read by the module (lieProps, errorsCaptured)
2. Environment-dependent (window, document, navigator, performance)
3. Preventing you from testing the interesting logic

---

## Proposed Collector Interface

A single deps object keeps signatures clean and extensible:

```typescript
interface CollectorDeps {
  win: Window;
  lieProps: Record<string, number>;
  errors: ErrorCollector;
}

// Each collector:
export default async function getCanvas2d(
  deps: CollectorDeps,
): Promise<CanvasFingerprint | undefined>;
export default async function getNavigator(
  deps: CollectorDeps,
  workerScope: WorkerScope,
): Promise<NavigatorFingerprint>;
export default async function getFonts(
  deps: CollectorDeps,
): Promise<FontsFingerprint | undefined>;
```

The orchestrator builds the deps once and passes to all collectors:

```typescript
const deps: CollectorDeps = {
  win: PHANTOM_DARKNESS || window,
  lieProps: computeLieProps(lieDetector),
  errors: createErrorCollector(),
};

const [canvas, navigator, fonts] = await Promise.all([
  getCanvas2d(deps),
  getNavigator(deps, workerScope),
  getFonts(deps),
]);
```

---

## Summary

| #   | Opportunity                      | Testability Gain                           | LOC Delta   | Clarity                         | Maintenance                  |
| --- | -------------------------------- | ------------------------------------------ | ----------- | ------------------------------- | ---------------------------- |
| 1   | LieProps as parameter            | Test lie-dependent branching with fixtures | 0           | Explicit deps                   | Type-safe interface          |
| 2   | Error collector injection        | Inspect errors per-module                  | -30         | No global error bucket          | Isolated failures            |
| 3   | Separate collect/analyze         | Test all decision logic with captured data | -50 to -100 | Two clear concerns              | Change rules without browser |
| 4   | Kill lies import side-effect     | Import without triggering scan             | -20         | No hidden execution             | No import order fragility    |
| 5   | Orchestrator assembly extraction | Test hash/bot logic independently          | 0           | Assembly is just data transform | Modify scoring in isolation  |
| 6   | Window injection (formalize)     | Already partially done                     | -10         | Consistent pattern              | One decision point           |

---

## Recommended Execution Order

**Phase 1 — Unlock everything else:**

- Item 4 (kill side-effect import) — every other change is easier once imports are inert

**Phase 2 — The deps object:**

- Item 1 (lieProps as parameter) + Item 2 (error collector) + Item 6 (window injection)
- Create the `CollectorDeps` interface, update collectors one at a time
- Each collector update is a self-contained PR

**Phase 3 — The big payoff:**

- Item 3 (separate collect/analyze) for `headless`, `navigator`, `resistance`, `inconsistencies`, `status`
- These are the modules where the analysis:collection ratio is highest
- Each split unlocks a large surface area of testable decision logic

**Phase 4 — Orchestrator:**

- Item 5 (extract assembly logic) — only makes sense after collectors are updated

---

## What This Gets You

After all phases, the test situation changes from:

**Before:** 13 test files testing constants and pure utilities. No behavioral tests for fingerprinting logic, lie detection decisions, or bot scoring.

**After:** Every collector's decision logic is testable with captured browser fixtures. The orchestrator's assembly logic is testable with synthetic results. The lie detection's impact on each module is testable with crafted lieProps. All without mocking browser APIs — just passing real data through real functions.

The tests that remain impossible (Canvas pixel output, WebGL parameters, AudioContext rendering) are genuinely integration-level concerns. They belong in Playwright, not Vitest. DI doesn't pretend otherwise.
