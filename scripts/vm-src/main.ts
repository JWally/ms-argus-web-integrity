// Argus-Web VM detection program — compiled to bytecode at build time.
// Written in the JS subset supported by the compiler (see scripts/compiler/).
// Must stay under 48 GP registers (reuse variables, avoid deep nesting).
//
// API IDs match ArgusVmBridge in src/vm/bridge.ts.
// Async APIs use __api_call_async; sync use __api_call / __api_get.
//
// Flow:
//   1. Bot detection (signals array populated)
//   2. Async sigint probe fetches (TLS, TCP, H2 — tokens stored)
//   3. Integrity hash (XOR-fold of signal count + deploy secret)
//   4. ECDH keygen → encrypt payload → POST → session_id
//   5. Return { tampered, signals, hash, sessionId }

const signals = [];
let tmp = 0;
let i = 0;

// ── 1. navigator.webdriver ────────────────────────────────────────────
tmp = __api_get(0x01);
if (tmp === true) { tmp = signals.push('vm:webdriver'); }

// ── 2. webdriver own descriptor (patched via defineProperty) ──────────
tmp = __api_get(0x08);
if (tmp === true) { tmp = signals.push('vm:webdriver_descriptor'); }

// ── 3. Phantom iframe webdriver ───────────────────────────────────────
tmp = __api_get(0x01);
if (tmp === false) {
  tmp = __api_call(0x09);
  if (tmp === true) { tmp = signals.push('vm:phantom_webdriver'); }
}

// ── 4. Window litter — bot-injected globals ───────────────────────────
let winProps = __api_call(0x02);
let litFound = false;
i = 0;
while (i < winProps.length) {
  if (litFound === false) {
    tmp = winProps[i];
    if (tmp.includes('__bot')) litFound = true;
    if (tmp.includes('__solver')) litFound = true;
    if (tmp.includes('__captcha')) litFound = true;
    if (tmp.includes('__hook')) litFound = true;
    if (tmp.includes('__pw_')) litFound = true;
    if (tmp.includes('__playwright')) litFound = true;
    if (tmp.includes('__puppeteer')) litFound = true;
    if (tmp.includes('_phantom')) litFound = true;
    if (tmp.includes('__selenium')) litFound = true;
    if (tmp.includes('__webdriver')) litFound = true;
    if (tmp.includes('__driver')) litFound = true;
  }
  i = i + 1;
}
if (litFound) { tmp = signals.push('vm:litter'); }
winProps = 0;
litFound = false;

// ── 5. Document litter — ChromeDriver cdc_ globals ───────────────────
let docProps = __api_call(0x03);
i = 0;
while (i < docProps.length) {
  if (docProps[i].includes('cdc_')) {
    tmp = signals.push('vm:cdc_global');
    i = docProps.length;
  }
  i = i + 1;
}
docProps = 0;

// ── 6. toString checks — native code? (main-thread captured) ─────────
// 0x0D = PTR_GET_COALESCED_STR, 0x0E = PTR_GET_PREDICTED_STR, 0x0F = PERF_NOW_STR
// 0x05 = NATIVE_REGEX_TEST
tmp = __api_get(0x0d);
if (tmp.length > 0 && __api_call(0x05, tmp) === false) {
  tmp = signals.push('vm:getCoalesced_patched');
}

tmp = __api_get(0x0e);
if (tmp.length > 0 && __api_call(0x05, tmp) === false) {
  tmp = signals.push('vm:getPredicted_patched');
}

tmp = __api_get(0x0f);
if (tmp.length > 0 && __api_call(0x05, tmp) === false) {
  tmp = signals.push('vm:perfNow_patched');
}

// ── 7. Cross-realm toString disagrees with main-thread toString ───────
// 0x10 = XREALM_COALESCED_STR, 0x11 = XREALM_PREDICTED_STR, 0x12 = XREALM_PERF_NOW_STR
tmp = __api_get(0x0d);
if (tmp.length > 0) {
  let xr = __api_get(0x10);
  if (xr.length > 0 && xr !== tmp) { tmp = signals.push('vm:xrealm_coalesced'); }
  xr = 0;
}

tmp = __api_get(0x0e);
if (tmp.length > 0) {
  let xr = __api_get(0x11);
  if (xr.length > 0 && xr !== tmp) { tmp = signals.push('vm:xrealm_predicted'); }
  xr = 0;
}

tmp = __api_get(0x0f);
if (tmp.length > 0) {
  let xr = __api_get(0x12);
  if (xr.length > 0 && xr !== tmp) { tmp = signals.push('vm:xrealm_perfNow'); }
  xr = 0;
}

// ── 8. Plugin count — headless Chrome has 0 plugins ──────────────────
tmp = __api_get(0x06);
if (tmp === 0) { tmp = signals.push('vm:no_plugins'); }

// ── 9. Chrome object — real Chrome always has window.chrome ──────────
tmp = __api_get(0x07);
if (tmp === false) { tmp = signals.push('vm:no_chrome'); }

// ── 10. Screen taskbar — no taskbar = virtual display ────────────────
tmp = __api_get(0x0a);
if (tmp === true) { tmp = signals.push('vm:no_taskbar'); }

// ── 10.5. Timezone cross-validation ──────────────────────────────────
// Bridge captures these at construction time via pristine refs.
// A bot that patches Date.getTimezoneOffset AFTER bridge construction
// will show a mismatch between tzOffset (pristine) and tzComputed (parse-based).
let tzOffset = __api_get(0x17);
let tzComputed = __api_get(0x18);
let tzLocation = __api_get(0x19);
let tzZone = __api_get(0x1a);
if (tzOffset !== tzComputed) {
  tmp = signals.push('vm:tz_offset_mismatch');
}

// ── 10.6. Worker scope cross-validation ──────────────────────────────
// Bridge spawns fresh SharedWorker + DedicatedWorker, collects navigator
// data from each, cross-compares with main thread, runs lie detection.
// Runs independently of collectIntegrity() so we can verify parity.
// Reuse tmp to avoid allocating new registers (budget is tight).
// Build vm object first to capture tmp (wsData) before signal checks overwrite it.
// Step 13 also overwrites tmp with the ECDH keypair — vm must be built before that.
tmp = __api_call_async(0x1b);
const vm = {
  timezone: {
    offset: tzOffset,
    offsetComputed: tzComputed,
    location: tzLocation,
    zone: tzZone,
  },
  workerScope: tmp,
};
tmp = 0;
if (vm.workerScope.best.length === 0) {
  tmp = signals.push('vm:worker_unavailable');
}
if (vm.workerScope.lied === true) {
  tmp = signals.push('vm:worker_lied');
}
if (vm.workerScope.localeEntropyIsTrusty === false) {
  tmp = signals.push('vm:locale_entropy_untrusty');
}
if (vm.workerScope.localeIntlEntropyIsTrusty === false) {
  tmp = signals.push('vm:locale_intl_entropy_untrusty');
}

// ── 10.7. WebRTC cross-validation ────────────────────────────────────
// Runs getWebRTCData() fresh — independent of collectIntegrity() — so
// results can be compared for parity and tampering.
// Stored in vm.webrtc via member assignment (reuses tmp, no new register).
tmp = __api_call_async(0x1c);
vm.webrtc = tmp;
tmp = 0;
if (vm.webrtc === null) {
  tmp = signals.push('vm:webrtc_unavailable');
} else {
  if (vm.webrtc.iceCandidates.hasMDNS === false && vm.webrtc.iceCandidates.hasPrivateIP === true) {
    tmp = signals.push('vm:webrtc_raw_ip');
  }
}

// ── 10.8. CSS Media cross-validation ─────────────────────────────────
// Bridge calls getCSSMedia() (sync) and normalizes into a flat camelCase object.
// pointer/pointerCSS: matchMedia vs CSS cross-check (mismatch = patched matchMedia).
// screenW vs reportedW: CSS query vs JS screen API (mismatch = screen API spoofed).
tmp = __api_call(0x1d);
vm.cssMedia = tmp;
tmp = 0;
if (vm.cssMedia !== null) {
  if (vm.cssMedia.pointer === 'none') {
    tmp = signals.push('vm:css_pointer_none');
  }
  if (vm.cssMedia.hasMismatch === true) {
    tmp = signals.push('vm:css_matchmedia_mismatch');
  }
  if (vm.cssMedia.screenW !== vm.cssMedia.reportedW) {
    tmp = signals.push('vm:css_screen_mismatch');
  }
}

// ── 11. Async sigint probe fetches ────────────────────────────────────
// These run in parallel at the bridge level; VM executes them sequentially
// but the bridge makes real fetch() calls. Tokens are opaque strings.
let tlsResult = __api_call_async(0x40);
let tcpToken = __api_call_async(0x41);
let h2Token = __api_call_async(0x42);

// ── 12. Integrity hash — stable fingerprint hash + signal count + deploy secret ──
// GET_STABLE_HASH (0x16) returns fingerprint.hashes.stable from the bridge context.
// Tying the hash to the stable fingerprint hash means a forged payload with a different
// stable hash will produce a mismatching vmHash — detectable server-side.
// '__DEPLOY_SECRET__' is replaced with the actual random secret at compile time.
let stableHash = __api_get(0x16);
let h = '';
h = h + stableHash;
h = h + '|';
h = h + String(signals.length);
h = h + '|';
h = h + '__DEPLOY_SECRET__';

let hv = 0;
i = 0;
while (i < h.length) {
  hv = hv * 31 + i + 1;
  i = i + 1;
}

// ── 13. ECDH encrypt + POST ───────────────────────────────────────────
let serverPubKey = __api_get(0x14);
let sessionId = '';
let publicKeyB64 = '';

if (serverPubKey.length > 0) {
  // Generate ephemeral ECDH key pair (pristine iframe crypto)
  tmp = __api_call_async(0x30);
  publicKeyB64 = __api_call_async(0x31, tmp.publicKey);

  // Build payload JSON:
  //   args: (vmHash, vmSignals, tampered, tlsResult, tcpToken, h2Token)
  let payloadJSON = __api_call(
    0x13,
    String(hv),
    signals,
    signals.length > 0,
    tlsResult,
    tcpToken,
    h2Token,
  );

  if (payloadJSON.length > 0) {
    // ── XOR scramble payload before ECDH encryption ──────────────
    // Key = sessionToken (from bridge, sent as X-Argus-Session) + deploy secret.
    // Runs inside VM bytecode so hooking the ECDH bridge call only sees garbage.
    // Server reverses with X-Argus-Session header + INTEGRITY_DEPLOY_SECRET env var.
    let xorKey = __api_get(0x1e) + '__DEPLOY_SECRET__';
    let scrambled = '';
    i = 0;
    while (i < payloadJSON.length) {
      scrambled = scrambled + String.fromCharCode(
        payloadJSON.charCodeAt(i) ^ xorKey.charCodeAt(i % xorKey.length)
      );
      i = i + 1;
    }
    xorKey = 0;

    // Encrypt with ECDH+HKDF+AES-GCM → Uint8Array [iv | ciphertext+tag]
    let encrypted = __api_call_async(
      0x32,
      tmp.privateKey,
      serverPubKey,
      scrambled,
    );
    scrambled = 0;
    // POST octet-stream to /v1/collect → session_id
    sessionId = __api_call_async(0x43, encrypted, publicKeyB64);
    encrypted = 0;
  }
  payloadJSON = 0;
}
serverPubKey = 0;
tlsResult = 0;
tcpToken = 0;
h2Token = 0;

const result = {
  tampered: signals.length > 0,
  signals: signals,
  hash: String(hv),
  sessionId: sessionId,
  publicKeyB64: publicKeyB64,
  vm: vm,
};
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- VM return value
result;
