# Argus

Browser fingerprinting library for fraud detection and device identification. Collects stable, high-entropy signals across 30+ fingerprinting modules to generate unique device identifiers.

## Quick Start

```typescript
import collectFingerprint from 'argus';

const result = await collectFingerprint();

// Access different hash types
console.log(result.hashes.stable);  // Stable device hash
console.log(result.hashes.fuzzy);   // Fuzzy matching hash
console.log(result.hashes.loose);   // Full fingerprint hash

// Bot detection signals
console.log(result.botSignals.isHeadless);
console.log(result.botSignals.hasLies);
console.log(result.botSignals.lieCount);
```

## Installation

```bash
npm install argus
```

## Architecture

```
src/
├── fingerprint.ts       # Main orchestrator - runs all modules in parallel
├── index.ts             # Public API exports
├── [modules]/           # Individual fingerprinting modules (see below)
├── errors/              # Error capture and normalization
└── utils/               # Shared utilities (crypto, evercookie, sigint)

lib/
├── constructs/          # CDK constructs for deployment
├── stacks/              # CDK stack definitions
└── pipeline/            # CI/CD pipeline

rust/
└── wasm-fingerprint/    # WASM module for hardware fingerprinting
```

---

## Output Format

```typescript
interface FingerprintResult {
  loose: Record<string, any>;      // Full raw fingerprint data
  stable: Record<string, any>;     // Filtered/hardened for production
  hashes: {
    loose: string;                 // Hash of full fingerprint
    stable: string;                // Hash of stable fingerprint
    fuzzy: string;                 // Fuzzy matching hash
    deviceOfTimezone: string;      // Device + timezone composite
  };
  botSignals: {
    botHash: string;
    badBot: string | undefined;
    isHeadless: boolean;
    hasLies: boolean;
    lieCount: number;
    stealthSignals: Record<string, boolean>;
    likelyResidentialProxy: boolean;
    engineMismatch: boolean;
    isPrivate: boolean;
  };
  meta: {
    timestamp: number;
    durationMs: number;
    version: string;
  };
}
```

---

## Fingerprinting Modules

### Audio (`src/audio/`)

Creates an AudioContext and analyzes the audio processing pipeline. Audio processing varies by hardware audio chipset, driver version, and browser implementation.

### Canvas 2D (`src/canvas/`)

Renders text, emoji, and graphics to a 2D canvas. GPU, graphics driver, font rendering, and anti-aliasing all affect output.

### WebGL (`src/webgl/`)

Queries WebGL context for renderer info, extensions, and parameters. GPU model is highly identifying.

### WebGPU Compute (`src/webgpu-compute/`)

Runs compute shader to detect GPU computational characteristics. Returns `{supported: false}` on unsupported browsers.

### Fonts (`src/fonts/`)

Detects installed fonts by measuring text rendering width. Tests ~200 common fonts.

### Screen (`src/screen/`)

Collects screen resolution, color depth, pixel ratio, and orientation.

### Navigator (`src/navigator/`)

Collects browser/OS information including User-Agent Client Hints, hardware concurrency, device memory, and touch capabilities.

### CSS (`src/css/`)

Detects CSS feature support, computed style values, and vendor prefixes.

### CSS Media (`src/cssmedia/`)

Queries media features: color-scheme, reduced-motion, color-gamut, forced-colors, etc.

### Timezone (`src/timezone/`)

Captures timezone with cross-validation between APIs to detect spoofing.

### Intl (`src/intl/`)

Probes Intl API for locale-specific formatting variations.

### Timing (`src/timing/`)

Collects timing data for server-side clock skew analysis. Each device's crystal oscillator has unique drift characteristics.

### WASM Benchmarks (`src/wasm/`)

Runs CPU/memory benchmarks via WebAssembly for hardware fingerprinting:
- CPU/FPU performance
- JIT warmup curves
- Memory ceiling and growth patterns
- SIMD support and performance
- JS-WASM boundary overhead
- Worker performance ratios

### WebRTC (`src/webrtc/`)

Collects WebRTC device information and STUN binding results.

### Worker Scope (`src/worker/`)

Collects fingerprint from Web Worker context. Compares with main thread to detect spoofing.

### Document (`src/document/`)

Probes HTML element behavior and properties for browser detection.

### Window Features (`src/window/`)

Detects available window properties and functions.

### Math (`src/math/`)

Tests Math function precision for JS engine and FPU variations.

### Speech (`src/speech/`)

Collects available speech synthesis voices.

### SVG (`src/svg/`)

Tests SVG rendering and filter capabilities.

### DOM Rect (`src/domrect/`)

Measures element bounding rectangles for subpixel rendering detection.

### Resistance (`src/resistance/`)

Detects anti-fingerprinting measures (Brave, Firefox RFP, extensions).

### Headless (`src/headless/`)

Detects headless/automated browser environments.

### Inconsistencies (`src/inconsistencies/`)

Cross-validates signals to detect spoofing across APIs.

### Media (`src/media/`)

Collects supported media types and codecs.

### Engine (`src/engine/`)

Detects JavaScript engine via console error patterns.

### Proxy Detection (`src/proxy/`)

Detects likely residential proxy usage.

### Incognito Detection (`src/incognito/`)

Detects private/incognito browsing mode.

### Lies Detection (`src/lies/`)

Tracks API tampering and inconsistencies across all modules.

### Features (`src/features/`)

Detects browser engine via feature support patterns.

---

## Persistence Mechanisms

### Evercookie

Multi-storage persistent device identifier that survives cookie clears.

```typescript
import { getEvercookieId, clearEvercookieId } from 'argus';

const { id, mechanisms } = await getEvercookieId();
console.log(id);         // Persistent device ID
console.log(mechanisms); // Which storage mechanisms succeeded
```

### CryptoID

Persistent ECDSA key pair for device identity stored in IndexedDB.

```typescript
import { getCryptoId, signWithCryptoId } from 'argus';

const { publicKey, privateKey } = await getCryptoId();
const signature = await signWithCryptoId(data);
```

### Favicon Cache

Uses browser favicon cache for additional persistence.

```typescript
import { getFaviconCacheId } from 'argus';

const { id } = await getFaviconCacheId();
```

---

## Server-Side Integration (Sigint)

Collects server-side fingerprinting data including TLS fingerprints (JA3/JA4), TCP RTT, and STUN results.

```typescript
import { collectSigintData } from 'argus';

const sigint = await collectSigintData({
  baseDomain: 'your-domain.com',
  // ... config
});

console.log(sigint.tls);       // JA3/JA4 fingerprints
console.log(sigint.tcp);       // TCP RTT data
console.log(sigint.stun);      // STUN binding results
```

### Unified Load Function

For iframe-based collection with optional sigint:

```typescript
import { load } from 'argus';

const result = await load({
  enableSigint: true,
  sigint: { baseDomain: 'your-domain.com' }
});

console.log(result.fingerprint);
console.log(result.sigint);
console.log(result.timing);
```

---

## Development

```bash
# Install dependencies
npm install

# Development server with hot reload
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Build WASM module (requires Rust/wasm-pack)
npm run build:wasm

# Build everything
npm run build:all

# Lint and format
npm run lint
npm run format
```

### CDK Deployment

```bash
# Synthesize CloudFormation
npm run cdk:synth

# Deploy
npm run cdk:deploy

# Show diff
npm run cdk:diff
```

---

## Performance

Target: < 1 second total collection time. All modules run in parallel.

| Module | Typical Time |
|--------|--------------|
| Audio | ~100ms |
| Canvas | ~50ms |
| WebGL | ~30ms |
| Fonts | ~200ms |
| WASM | ~100-300ms |
| **Total** | **~300-600ms** |

---

## License

MIT
