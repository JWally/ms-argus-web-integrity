# Server-Side Caniuse Cross-Reference

## Overview

Cross-reference every feature-related attribute in the fingerprint payload against the full caniuse database to produce a server-side "feature-age profile." This gives browser version pinpointing, spoofing detection, and consistency scoring — all without trusting the User-Agent string.

This complements the existing MDN BCD approach (TODO-server-side-analysis.md #8) but is broader: caniuse covers ~550 features with per-version support tables, partial support flags, and prefix requirements.

## Data Source

- **Full database:** `github.com/Fyrd/caniuse` → `data.json` (~3MB)
- **npm:** `caniuse-db` (full) or `caniuse-lite` (compressed, ~400KB)
- **Structure:** Each feature has a `stats` object mapping `browser → version → support_level`
  - `"y"` = supported, `"n"` = not supported, `"a"` = partial, `"p"` = polyfill, `"x"` = prefix required
- **Update cadence:** caniuse updates weekly; server can auto-pull via cron

## Payload Attributes to Match

### CSS Module (`payload.css`)

- `cssKeys` — list of supported CSS properties
- Maps directly to caniuse features like `css-grid`, `css-variables`, `css-subgrid`, `css-container-queries`, etc.
- Caniuse IDs use kebab-case; CSS properties use camelCase → need a mapping table

### Window Features (`payload.windowFeatures`)

- `windowKeys` — list of window/global APIs
- Maps to caniuse features like `web-animation`, `intersectionobserver`, `resizeobserver`, `sharedarraybuffer`

### HTML Element Version (`payload.htmlElementVersion`)

- Element support → maps to caniuse entries like `dialog`, `details`, `datalist`

### WebGL (`payload.canvasWebgl`)

- WebGL extensions → maps to `webgl`, `webgl2`, specific extension support

### Media (`payload.media`)

- Codec support → maps to `webm`, `opus`, `av1`, `hevc`, `aac`

### JS Features (`payload.features.jsKeys`)

- Built-in APIs → maps to `es6-class`, `promises`, `async-functions`, `optional-chaining`, etc.

### WebRTC (`payload.webrtc`)

- Presence/absence → maps to `rtcpeerconnection`

### Speech (`payload.voices`)

- SpeechSynthesis API → maps to `speech-synthesis`

## Server-Side Analysis

### 1. Build Inverted Index (one-time, refresh weekly)

```typescript
// Invert caniuse: feature → { browser: version_range[] }
interface FeatureSupport {
  [featureId: string]: {
    [browser: string]: { added: number; removed?: number; partial?: number };
  };
}

// From caniuse stats, compute the first version where support = "y"
function buildFeatureIndex(caniuseData): FeatureSupport {
  const index = {};
  for (const [id, feature] of Object.entries(caniuseData.data)) {
    index[id] = {};
    for (const [browser, versions] of Object.entries(feature.stats)) {
      const entries = Object.entries(versions);
      const firstSupported = entries.find(([v, s]) => s.startsWith('y'));
      if (firstSupported) {
        index[id][browser] = { added: parseFloat(firstSupported[0]) };
      }
    }
  }
  return index;
}
```

### 2. Build Payload-to-Caniuse Mapping

```typescript
// Map payload attribute names to caniuse feature IDs
const CSS_TO_CANIUSE: Record<string, string> = {
  containerType: 'css-container-queries',
  grid: 'css-grid',
  subgrid: 'css-subgrid',
  cssVariables: 'css-variables',
  backdropFilter: 'css-backdrop-filter',
  aspectRatio: 'mdn-css_properties_aspect-ratio',
  textWrap: 'css-text-wrap-balance',
  // ... ~200 mappings
};

const JS_TO_CANIUSE: Record<string, string> = {
  structuredClone: 'mdn-api_structuredclone',
  IntersectionObserver: 'intersectionobserver',
  ResizeObserver: 'resizeobserver',
  SharedArrayBuffer: 'sharedarraybuffer',
  WeakRef: 'mdn-javascript_builtins_weakref',
  // ... ~100 mappings
};
```

### 3. Compute Feature-Age Profile

```typescript
interface FeatureAgeProfile {
  // Inferred version range based on feature support
  inferredBrowser: string;
  inferredVersionMin: number;
  inferredVersionMax: number;

  // Consistency scores
  featureConsistencyScore: number; // 0-1, how self-consistent the feature set is
  uaMatchScore: number; // 0-1, how well features match claimed UA

  // Anomalies
  anachronisms: Anachronism[]; // features from different eras
  impossibleCombinations: string[]; // mutually exclusive features present
}

interface Anachronism {
  feature: string;
  expectedVersion: number;
  direction: 'too_new' | 'too_old'; // feature too new or too old for inferred version
  gap: number; // version gap
}
```

### 4. Detect Spoofing Patterns

```typescript
function detectSpoofing(payload, claimedUA): SpoofSignals {
  const profile = computeFeatureAgeProfile(payload);
  const signals = [];

  // UA says Chrome 120 but features say Chrome 125
  if (Math.abs(profile.inferredVersionMin - claimedUA.version) > 3) {
    signals.push({
      type: 'version_mismatch',
      claimed: claimedUA.version,
      inferred: profile.inferredVersionMin,
      confidence: profile.featureConsistencyScore,
    });
  }

  // Features span too wide a range (normal browsers update atomically)
  const versionSpread = profile.inferredVersionMax - profile.inferredVersionMin;
  if (versionSpread > 5) {
    signals.push({
      type: 'feature_spread_anomaly',
      spread: versionSpread,
      // Legitimate reason: experimental flags. But bots often mix versions.
    });
  }

  // Has very new features but missing older expected ones
  for (const a of profile.anachronisms) {
    if (a.direction === 'too_old' && a.gap > 10) {
      signals.push({
        type: 'missing_expected_feature',
        feature: a.feature,
        gap: a.gap,
      });
    }
  }

  return signals;
}
```

## Bot Detection Signals Produced

| Signal                     | Meaning                                                  | Severity |
| -------------------------- | -------------------------------------------------------- | -------- |
| `ua_version_mismatch`      | Claimed UA version doesn't match feature set             | High     |
| `ua_engine_mismatch`       | Features match wrong engine entirely                     | Critical |
| `feature_spread_anomaly`   | Feature set spans too many versions                      | Medium   |
| `missing_expected_feature` | Missing a feature that should exist given others present | Medium   |
| `impossible_combination`   | Has features from mutually exclusive browsers            | Critical |
| `partial_support_anomaly`  | Reports full support for feature that should be partial  | Low      |

## Edge Cases & False Positive Mitigation

- **Browser flags:** Users can enable experimental features → allow small anomalies (1-2 features ahead)
- **Enterprise lockdowns:** Old browsers with backported security patches → check for known enterprise patterns
- **Brave/Vivaldi/Edge:** Chromium forks may lag Chromium proper by 1-2 versions → use engine version not browser version
- **iOS browsers:** All use WebKit regardless of name → check for WebKit feature set, not Chrome/Firefox
- **Partial support:** caniuse `"a"` (partial) means feature exists but incomplete → don't hard-fail on these

## Implementation Steps

1. [ ] Add `caniuse-lite` as server dependency (or fetch `data.json` on deploy)
2. [ ] Build the payload-attribute-to-caniuse-ID mapping table (start with CSS + JS, highest signal)
3. [ ] Implement inverted index builder with weekly refresh
4. [ ] Implement `computeFeatureAgeProfile()`
5. [ ] Implement `detectSpoofing()` with the signals above
6. [ ] Add to server response as `analysis.featureAge` alongside existing analysis
7. [ ] Log and tune false-positive thresholds against real traffic before scoring

## Relationship to Existing Work

- **MDN BCD (TODO-server-side-analysis.md #8):** Already uses `@mdn/browser-compat-data` for version detection. Caniuse overlaps but has better coverage of CSS features and older browser data. Can merge both data sources into one lookup.
- **Features module (`src/features/`):** Client already collects `cssKeys`, `windowKeys`, `jsKeys`. No client changes needed.
- **Resistance module:** `outsideFeaturesVersion` bot signal already exists server-side. This proposal enriches it with granular per-feature analysis instead of a binary yes/no.

## Estimated Effort

- Mapping table (CSS + JS): ~300 entries, mostly mechanical
- Server code: ~200 lines for index + profile + detection
- Integration: Add to existing analysis pipeline
- No client changes required — all data already in the payload
