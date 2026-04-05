# Code Review: Consolidation & Reduction (Round 3)

Previous reviews focused on splitting god-classes and structural issues. This review goes the other direction: **consolidating duplicated patterns across the codebase to reduce total code volume**. Less code = fewer bugs = smaller attack surface.

---

## 1. Storage Access Pattern (3 files, ~200 lines removable)

### Problem

Three persistence modules each implement their own IndexedDB open/read/write, localStorage get/set, and Cache API interactions with nearly identical try/catch + error handling:

| File                     | Storage Types                                       | Lines Spent      |
| ------------------------ | --------------------------------------------------- | ---------------- |
| `utils/evercookie.ts`    | IDB, localStorage, sessionStorage, cookie, CacheAPI | 130-301          |
| `utils/favicon-cache.ts` | CacheAPI, localStorage                              | 116-193, 313-345 |
| `utils/get-crypto-id.ts` | IDB                                                 | 64-102           |

### Duplicated Logic

**IndexedDB open pattern** (evercookie.ts:130-152 vs get-crypto-id.ts:64-79):

```typescript
// Both do: new Promise → indexedDB.open → onupgradeneeded → onsuccess → onerror
```

**IndexedDB read pattern** (evercookie.ts:154-175 vs get-crypto-id.ts:81-90):

```typescript
// Both do: transaction('readonly') → objectStore.get(key) → onsuccess → onerror
```

**localStorage read pattern** (evercookie.ts:179-190 vs favicon-cache.ts:313-326):

```typescript
// Both do: try { JSON.parse(localStorage.getItem(key)) } catch { expectFailure(...) }
```

### Fix

Create `utils/storage.ts` with generic adapters:

```typescript
export function idbRead<T>(
  dbName: string,
  storeName: string,
  key: string,
): Promise<T | null>;
export function idbWrite<T>(
  dbName: string,
  storeName: string,
  key: string,
  value: T,
): Promise<boolean>;
export function localRead<T>(key: string): T | null;
export function localWrite<T>(key: string, value: T): boolean;
```

Each persistence module then uses 1-line calls instead of 20-line implementations.

**Estimated reduction: ~200 lines across 3 files.**

---

## 2. Memoization + Inflight Deduplication (3 files, ~120 lines removable)

### Problem

Three files implement the exact same async memoization pattern with inflight promise deduplication:

| File                       | Variables                         | Function              |
| -------------------------- | --------------------------------- | --------------------- |
| `evercookie.ts:415-481`    | `memoizedData`, `inflightPromise` | `getEvercookieId()`   |
| `favicon-cache.ts:349-489` | `memoizedData`, `inflightPromise` | `getFaviconCacheId()` |
| `get-crypto-id.ts:59-197`  | `memoised`, `inflight`            | `getCryptoId()`       |

### The Pattern (repeated 3x)

```typescript
let memo: T | undefined;
let inflight: Promise<T> | undefined;

export async function getData(): Promise<T> {
  if (memo) return memo;
  if (inflight) return inflight;
  inflight = (async () => {
    // ... initialization ...
    memo = result;
    return result;
  })();
  const result = await inflight;
  inflight = undefined;
  return result;
}

export function getDataSync(): T | undefined {
  return memo;
}
export function refresh(): Promise<T> {
  memo = undefined;
  return getData();
}
export function clear(): void {
  memo = undefined; /* cleanup storage */
}
```

### Fix

Create `utils/memo-async.ts`:

```typescript
export function createAsyncMemo<T>(init: () => Promise<T>) {
  let memo: T | undefined;
  let inflight: Promise<T> | undefined;
  return {
    get: async () => {
      /* dedup logic */
    },
    getSync: () => memo,
    refresh: () => {
      memo = undefined;
      return get();
    },
    reset: () => {
      memo = undefined;
    },
  };
}
```

Each persistence module becomes:

```typescript
const store = createAsyncMemo(() => initializeEvercookie());
export const getEvercookieId = store.get;
export const getEvercookieIdSync = store.getSync;
export const refreshEvercookieId = store.refresh;
```

**Estimated reduction: ~120 lines (40 per file).**

---

## 3. Loader Auto-Run Duplication (2 files, ~80 lines removable)

### Problem

`loader.ts:432-467` and `loader-lite.ts:246-291` contain ~85% identical auto-run logic:

- Parse URL parameters from script `src` attribute
- Detect auto-run configuration
- Submit fingerprint via `navigator.sendBeacon` with `fetch` fallback
- Handle endpoint, apiKey, sessionId extraction

### Fix

Create `loader-common.ts`:

```typescript
export function parseLoaderConfig(scriptUrl: URL): Partial<LoaderConfig>;
export function submitResult(
  endpoint: string,
  data: unknown,
  apiKey?: string,
): Promise<void>;
```

Both loaders import and call these instead of duplicating.

**Estimated reduction: ~80 lines.**

---

## 4. Shared Constants Between Loaders (2 files, ~20 lines)

### Problem

Both loaders define their own version of:

- `SRCDOC_HTML` / `SRCDOC` (identical HTML content, lines loader.ts:93-94 / loader-lite.ts:59-60)
- `IFRAME_STYLES` / `IFRAME_CSS` (same styling, different format)

### Fix

Single `loader-constants.ts` exporting both.

**Estimated reduction: ~20 lines + single source of truth.**

---

## 5. `calculateRating()` Duplicated Across Modules (3 files, ~30 lines removable)

### Problem

The same boolean-signal-to-percentage scoring function appears in:

- `headless/index.ts:402-406`
- `incognito/index.ts` (inline equivalent logic ~lines 460-470)
- `inconsistencies/index.ts:752-766`

```typescript
function calculateRating(signals: Record<string, boolean>): number {
  const keys = Object.keys(signals);
  const trueCount = keys.filter((key) => signals[key]).length;
  return +((trueCount / keys.length) * 100).toFixed(0);
}
```

### Fix

Export from `utils/helpers.ts` (or a new `utils/scoring.ts`). All three modules import it.

**Estimated reduction: ~30 lines.**

---

## 6. Property Enumeration via `attempt()` (4 files, ~150 lines removable)

### Problem

Multiple modules manually enumerate properties with repetitive `attempt(() => obj.prop)` calls:

| File                 | Lines    | Properties                |
| -------------------- | -------- | ------------------------- |
| `audio/index.ts`     | 100-167  | 30+ audio node properties |
| `navigator/index.ts` | ~620-650 | navigator properties      |
| `worker/index.ts`    | 308-340  | worker scope properties   |
| `webgl/index.ts`     | 294-321  | WebGL parameters          |

### Example (audio/index.ts)

```typescript
return {
  'AnalyserNode.channelCount': attempt(() => analyser.channelCount),
  'AnalyserNode.channelCountMode': attempt(() => analyser.channelCountMode),
  'AnalyserNode.channelInterpretation': attempt(
    () => analyser.channelInterpretation,
  ),
  'AnalyserNode.context.sampleRate': attempt(() => analyser.context.sampleRate),
  // ... 26 more lines identical in structure
};
```

### Fix

```typescript
// utils/collect.ts
export function collectProps<T>(
  obj: T,
  keys: (keyof T)[],
  prefix: string,
): Record<string, unknown> {
  return Object.fromEntries(
    keys.map((k) => [`${prefix}.${String(k)}`, attempt(() => obj[k])]),
  );
}
```

Audio becomes:

```typescript
return {
  ...collectProps(analyser, ['channelCount', 'channelCountMode', ...], 'AnalyserNode'),
  ...collectProps(biquadFilter, ['frequency', 'gain', ...], 'BiquadFilterNode'),
};
```

**Estimated reduction: ~150 lines across 4 files.**

---

## 7. UUID / Random ID Generation (2 files, ~25 lines removable)

### Problem

- `evercookie.ts:71-85` — full UUID v4 implementation with `crypto.randomUUID()` fallback
- `favicon-cache.ts:80-84` — `Uint32Array` random number generation

Both are small but represent duplicated "generate a random identifier" concerns.

### Fix

Add to `utils/crypto.ts` (already exists as the hash module):

```typescript
export function generateUUID(): string {
  /* evercookie's logic */
}
export function randomUint32(): number {
  /* favicon-cache's logic */
}
```

**Estimated reduction: ~25 lines.**

---

## 8. Telemetry Sub-Modules (3 files → 1 file, eliminate 2 files)

### Problem

| File                   | Lines | Exports                              |
| ---------------------- | ----- | ------------------------------------ |
| `telemetry/schema.ts`  | 40    | `PayloadV3Schema`, `PayloadV2Schema` |
| `telemetry/payload.ts` | 61    | `buildPayloadV3()`                   |
| `telemetry/api.ts`     | 251   | Everything else                      |

`schema.ts` and `payload.ts` are only consumed by `api.ts`. They exist as separate files for no structural benefit — three 40-60 line files with single exports each.

### Fix

Inline `schema.ts` and `payload.ts` contents into `api.ts`. Eliminates 2 files, 2 import chains, and the mental overhead of navigating 3 files for one concern.

**Estimated reduction: 2 files eliminated, ~20 lines of import/export boilerplate.**

---

## 9. Engine Detection Duplication (2 files, ~12 lines removable)

### Problem

`brave.ts:19-29` defines its own `getEngineId()`:

```typescript
function getEngineId(): number {
  const x = [].constructor;
  try {
    (-1).toFixed(-1);
  } catch (err) {
    return (
      (err as Error).message.length + (x + '').split(x.name).join('').length
    );
  }
  return 0;
}
```

This same logic exists in `engine/index.ts`. The brave module re-implements it to avoid a circular dependency.

### Fix

Move the primitive `getEngineId()` into `constants/engine.ts` (31 lines currently, shared constants file). Both `brave.ts` and `engine/index.ts` import from there. No circular dependency since constants have no imports from either module.

**Estimated reduction: ~12 lines.**

---

## 10. Lies Module Internal Patterns (detector.ts, ~70 lines reducible)

### Problem

`lies/detector.ts` `searchLies()` method (lines 64-176, 113 lines) contains:

- Duplicated property descriptor testing logic (lines 114-143 and 149-164)
- Repeated error handling blocks (lines 70-76, 144-146, 170-174)
- Two nearly identical code paths for function properties vs getter properties

### Fix

Extract:

```typescript
function testFunctionProperty(name, obj, target, ignore): LieResult;
function testGetterProperty(name, obj, target, ignore): LieResult;
```

Reduces `searchLies()` from 113 lines to ~40 lines of orchestration.

**Estimated reduction: ~70 lines.**

---

## 11. Async Timeout Wrapper (2+ files, ~50 lines removable)

### Problem

`incognito/index.ts` repeats this pattern 6+ times (lines 77-104, 110-137, 144-174, 235-254, 261-282, 381-402):

```typescript
return new Promise((resolve) => {
  const timeout = setTimeout(() => resolve(fallbackValue), TIMEOUT_MS);
  operation()
    .then((result) => {
      clearTimeout(timeout);
      resolve(result);
    })
    .catch(() => {
      clearTimeout(timeout);
      resolve(errorFallback);
    });
});
```

### Fix

```typescript
// utils/timing.ts (already exists)
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T>;
```

Each incognito test becomes:

```typescript
return withTimeout(testFirefoxIndexedDB(), 500, { ...result, weight: 0 });
```

**Estimated reduction: ~50 lines from incognito, reusable elsewhere.**

---

## 12. Serialization Helpers (3 files, ~40 lines removable)

### Problem

JSON parse-with-validation repeated in:

- `evercookie.ts:87-105` — `serialize()` / `deserialize()` with type guard
- `favicon-cache.ts:313-326` — inline `JSON.parse` with try/catch
- `get-crypto-id.ts:22-29` — `arrayBufferToBase64()` (different serialization, same concern)

### Fix

Add to `utils/storage.ts` (from item #1):

```typescript
export function jsonParse<T>(
  str: string | null,
  guard: (x: unknown) => x is T,
): T | null;
export function arrayBufferToBase64(buf: ArrayBuffer): string;
export function base64ToArrayBuffer(b64: string): ArrayBuffer;
```

**Estimated reduction: ~40 lines.**

---

## Summary

| #   | Consolidation            | Files Affected | Lines Saved    | Effort  |
| --- | ------------------------ | -------------- | -------------- | ------- |
| 1   | Storage adapters         | 3              | ~200           | Medium  |
| 2   | Async memoization        | 3              | ~120           | Low     |
| 3   | Loader auto-run          | 2              | ~80            | Low     |
| 4   | Loader constants         | 2              | ~20            | Trivial |
| 5   | `calculateRating()`      | 3              | ~30            | Trivial |
| 6   | Property enumeration     | 4              | ~150           | Medium  |
| 7   | UUID generation          | 2              | ~25            | Trivial |
| 8   | Telemetry merge          | 3→1            | ~20            | Trivial |
| 9   | Engine detection         | 2              | ~12            | Trivial |
| 10  | Lies detector extraction | 1              | ~70            | Low     |
| 11  | Async timeout wrapper    | 2+             | ~50            | Low     |
| 12  | Serialization helpers    | 3              | ~40            | Low     |
|     | **TOTAL**                |                | **~820 lines** |         |

---

## Recommended Execution Order

**Phase 1 — Quick wins (trivial effort, immediate reduction):**

- Items 4, 5, 7, 8, 9 → ~107 lines, minimal risk

**Phase 2 — Low effort, high value:**

- Items 2, 3, 10, 11 → ~320 lines, straightforward extractions

**Phase 3 — Medium effort, highest volume:**

- Items 1, 6, 12 → ~390 lines, requires new shared modules + updating consumers

---

## New Files Created

| File                  | Purpose                                    | Consumed By                              |
| --------------------- | ------------------------------------------ | ---------------------------------------- |
| `utils/storage.ts`    | Generic IDB/localStorage/CacheAPI adapters | evercookie, favicon-cache, get-crypto-id |
| `utils/memo-async.ts` | Async memoizer with inflight dedup         | evercookie, favicon-cache, get-crypto-id |
| `utils/collect.ts`    | Property enumeration helper                | audio, navigator, worker, webgl          |
| `loader-common.ts`    | Shared loader auto-run + config parsing    | loader, loader-lite                      |

---

## What NOT to Consolidate

These were evaluated and intentionally left alone:

- **css/ vs cssmedia/** — different APIs (computed styles vs matchMedia), merging would create a 630-line file with mixed concerns
- **domrect/ vs svg/** — different DOM measurement APIs despite both measuring emoji rendering
- **intl/ vs timezone/** — different detection strategies (Intl API probing vs offset calculation)
- **document/ vs window/** — different objects with different processing needs
- **screen/ vs speech/ vs media/** — independent device capabilities with no shared logic
- **Individual fingerprinting modules** — their isolation is a feature (parallel execution, independent failure)
- **The quirky API-triggering code** — intentional by design for fingerprinting purposes
