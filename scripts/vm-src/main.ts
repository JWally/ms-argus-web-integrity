// Argus-Web VM detection program — compiled to bytecode at build time.
// Written in the JS subset supported by the compiler (see scripts/compiler/).
// Must stay under 48 GP registers (reuse variables, avoid deep nesting).
//
// API IDs match ArgusVmBridge in src/vm/bridge.ts.
// Async APIs use __api_call_async; sync use __api_call / __api_get.
//
// Flow:
//   1. Async sigint probe fetches (TLS, TCP, H2 — tokens stored)
//   2. ECDH keygen → assemble device → encrypt payload → POST → session_id
//   3. Return { sessionId }
//
// HISTORY (2026-04-13): The vm:* signal generation steps were stripped.
// Server-side analyzers (worker, timezone, ip-consistency, ja4-ua) cover
// the cross-validation those signals were trying to express.
//
// HISTORY (harden-jsvm): The vm_hash / vm_signals / tampered wire fields
// were deleted — server never read them. Replaced by a real cryptographic
// integrity binding via persistent ECDSA crypto-id (device_identity).
//
// HISTORY (vm-pristine-vault): The device.* sub-object is now composed
// here in bytecode from 19 slice gets (0x50-0x62). Previously the bridge
// built the entire payload from a single ctx.getPayload thunk — one hook
// leaked everything. Now bytecode assembles device itself; bridge only
// provides individual unlabeled slices via ApiBridge.prototype.get.

let tmp = 0;
let i = 0;
const vm = {};

// ── 1. Async sigint probe fetches ─────────────────────────────────────
// These run in parallel at the bridge level; VM executes them sequentially
// but the bridge makes real fetch() calls. Tokens are opaque strings.
let tlsResult = __api_call_async(0x40);
let tcpToken = __api_call_async(0x41);
let h2Token = __api_call_async(0x42);

// ── 2. ECDH encrypt + POST ────────────────────────────────────────────
let serverPubKey = __api_get(0x14);
let sessionId = '';
let publicKeyB64 = '';

if (serverPubKey.length > 0) {
  // Generate ephemeral ECDH key pair (pristine iframe crypto)
  tmp = __api_call_async(0x30);
  publicKeyB64 = __api_call_async(0x31, tmp.publicKey);

  // Compose device object from individual slices (vm-pristine-vault).
  // Order matches IntegrityResult and the prior ctx.getPayload composition,
  // which keeps the assembled JSON byte-stable across the refactor — important
  // for any server-side device_identity verifier (sig is over JSON).
  let device = {
    css: __api_get(0x50),
    engine: __api_get(0x51),
    math: __api_get(0x52),
    headless: __api_get(0x53),
    lies: __api_get(0x54),
    trash: __api_get(0x55),
    shielding: __api_get(0x56),
    incognito: __api_get(0x57),
    intl: __api_get(0x58),
    navigator: __api_get(0x59),
    screen: __api_get(0x5a),
    status: __api_get(0x5b),
    timezone: __api_get(0x5c),
    timing: __api_get(0x5d),
    cssMedia: __api_get(0x5e),
    webrtc: __api_get(0x5f),
    windowPrefixes: __api_get(0x60),
    workerScope: __api_get(0x61),
    errors: __api_get(0x62),
  };

  // Build payload JSON. Args: (device, tlsResult, tcpToken, h2Token).
  // Async because the handler awaits the persistent ECDSA keypair (from
  // IndexedDB) to sign the payload; see bridge.ts GET_PAYLOAD_JSON.
  let payloadJSON = __api_call_async(0x13, device, tlsResult, tcpToken, h2Token);
  device = 0;

  if (payloadJSON.length > 0) {
    // ── XOR scramble payload before ECDH encryption ──────────────
    // Fibonacci-modulated sessionToken derivation. The algorithm is the secret,
    // not a static key. Server derives the same key from X-Argus-Session header.
    // Runs inside VM bytecode so hooking the ECDH bridge call only sees garbage.
    let token = __api_get(0x1e);
    let fib0 = 1;
    let fib1 = 1;
    let scrambled = '';
    i = 0;
    while (i < payloadJSON.length) {
      let t = token.charCodeAt(i % token.length);
      let f = fib1 % 256;
      scrambled = scrambled + String.fromCharCode(payloadJSON.charCodeAt(i) ^ (t ^ f));
      let fib2 = fib0 + fib1;
      fib0 = fib1;
      fib1 = fib2;
      if (fib1 > 1000000) { fib0 = 1; fib1 = 1; }
      i = i + 1;
    }
    token = 0;

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
  sessionId: sessionId,
  publicKeyB64: publicKeyB64,
  vm: vm,
};
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- VM return value
result;
