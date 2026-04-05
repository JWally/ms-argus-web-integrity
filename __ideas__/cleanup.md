# Code Cleanup

## Giant Files

| File                           | Lines | Problem                                                                         |
| ------------------------------ | ----- | ------------------------------------------------------------------------------- |
| `src/worker/index.ts`          | 1248  | Inline worker scripts, factories, comparison logic, orchestration all in one    |
| `src/inconsistencies/index.ts` | 945   | 8 nearly identical checker functions with copy-paste structure                  |
| `src/fingerprint.ts`           | 742   | 24-element Promise.all, 52 hash computations, 30+ conditional object properties |
| `src/utils/sigint.ts`          | 684   | Monolithic integration module                                                   |
| `src/webgl/index.ts`           | 677   | Drawing, parameter extraction, pixel rendering all together                     |
| `src/navigator/index.ts`       | 651   | Multiple independent collectors bundled                                         |
| `src/utils/favicon-cache.ts`   | 634   | Multiple storage mechanism handlers                                             |
| `src/utils/evercookie.ts`      | 633   | 7 different storage mechanisms in one file                                      |

## God Classes

### `src/worker/index.ts`

Handles 6-7 distinct concerns:

- Inline script generation and embedding (lines 27-131)
- 3 worker type implementations (Service, Shared, Dedicated)
- Main thread vs worker scope data collection
- Cross-worker comparison logic (lines 906-981)
- Parallel execution orchestration (lines 1016-1248)
- Lie detection within workers

Could split into:

- `worker/inline-script.ts` — the embedded worker code
- `worker/factories.ts` — worker creation (dedicated, shared, service)
- `worker/comparison.ts` — cross-worker validation
- `worker/index.ts` — orchestration only

### `src/inconsistencies/index.ts`

8 checker functions all following the same pattern:

1. Extract data from source
2. Validate internally
3. Push to shared inconsistencies array

Candidate for a data-driven approach where checks are configuration objects rather than individual functions.

## Duplication

### `ask()` wrapper defined 3 times in `worker/index.ts`

```typescript
const ask = (fn) => {
  try {
    return fn();
  } catch (e) {
    return;
  }
};
```

Appears at lines ~300, ~579, and ~1021. Should be a shared utility.

### Worker factory duplication

`getDedicatedWorker()` and `getSharedWorker()` (lines 595-647) are ~95% identical. Only difference is `Worker` vs `SharedWorker` and `terminate()` vs `port.close()`. Should be a parameterized factory.

### Audio node property collection

`src/audio/index.ts` lines 94-150 repeat `attempt(() => node.prop)` 20+ times. Could use a loop over a property list instead.

## Patterns to Clean Up

### Ternary cascade in `fingerprint.ts`

The pattern `!computed || computed.lied ? undefined : { ...computed, $hash: hash }` repeats 30+ times in the loose/stable object construction (lines 396-660). A helper function would reduce this significantly.

### Inline worker script as string

100+ lines of untyped JavaScript embedded as a template literal in `worker/index.ts:27-131`. This can't be type-checked, is hard to debug, and duplicates logic that exists elsewhere (e.g., `getUserAgentData`). Should be a separate `.worker.ts` file.

### `@ts-ignore` usage

At least 3 instances in `fingerprint.ts` (lines 72, 101, 164). Worth investigating whether proper types can replace these.

### Dead code

Commented-out code at `worker/index.ts:475-481`.

## .gitignore

The `public/` directory is correctly tracked for the most part (demo pages + static data files). Two items should be added to `.gitignore`:

```
public/argus.esm.js
public/debug.html
```

The existing ignores for `public/creep.js`, `public/creepworker.js`, etc. are leftovers from the old naming but still relevant.
