// Argus-Web VM detection program — compiled to bytecode at build time.
// Written in the JS subset supported by the compiler (see scripts/compiler/).
// Must stay under 48 GP registers (reuse variables, avoid deep nesting).
//
// API IDs match ArgusVmBridge in src/vm/bridge.ts.
// Async APIs use __api_call_async; sync use __api_call / __api_get.
//
// Flow:
//   1. Async sigint probe fetches (TLS, TCP, H2 — tokens stored)
//   2. Integrity hash (XOR-fold of stable_hash + 0 + h2 token)
//   3. ECDH keygen → encrypt payload → POST → session_id
//   4. Return { tampered:false, signals:[], hash, sessionId, vm:{} }
//
// HISTORY (2026-04-13): The vm:* signal generation steps (formerly steps
// 1-10.8) were stripped. Server-side analyzers (worker, timezone,
// ip-consistency, ja4-ua) cover the cross-validation those signals were
// trying to express, with TLS ground truth and ASN context the client
// can't replicate. Bridge API IDs 0x01-0x12 are still registered but no
// longer called from bytecode — kept for if/when we plumb the cross-realm
// pristine captures into the device payload as raw witness data.

const signals = [];
let tmp = 0;
let i = 0;
const vm = {};

// ── 1. Async sigint probe fetches ─────────────────────────────────────
// These run in parallel at the bridge level; VM executes them sequentially
// but the bridge makes real fetch() calls. Tokens are opaque strings.
let tlsResult = __api_call_async(0x40);
let tcpToken = __api_call_async(0x41);
let h2Token = __api_call_async(0x42);

// ── 2. Integrity hash — stable fingerprint hash + signal count + h2 token ──
// GET_STABLE_HASH (0x16) returns fingerprint.hashes.stable from the bridge context.
// Tying the hash to the stable fingerprint hash means a forged payload with a
// different stable hash will produce a mismatching vmHash — detectable server-side.
// h2Token binds the hash to this specific probe session (verified after decryption).
// signal count is always 0 now (vm:* signals removed) but the slot is preserved
// to keep the hash format stable for any server-side validators that parsed it.
let stableHash = __api_get(0x16);
let h = '';
h = h + stableHash;
h = h + '|';
h = h + String(signals.length);
h = h + '|';
h = h + h2Token;

let hv = 0;
i = 0;
while (i < h.length) {
  hv = hv * 31 + h.charCodeAt(i);
  i = i + 1;
}

// ── 3. ECDH encrypt + POST ────────────────────────────────────────────
let serverPubKey = __api_get(0x14);
let sessionId = '';
let publicKeyB64 = '';

if (serverPubKey.length > 0) {
  // Generate ephemeral ECDH key pair (pristine iframe crypto)
  tmp = __api_call_async(0x30);
  publicKeyB64 = __api_call_async(0x31, tmp.publicKey);

  // Build payload JSON:
  //   args: (vmHash, vmSignals, tampered, tlsResult, tcpToken, h2Token)
  // vmSignals is always [] and tampered is always false — server-side
  // analyzers do the actual classification work.
  let payloadJSON = __api_call(
    0x13,
    String(hv),
    signals,
    false,
    tlsResult,
    tcpToken,
    h2Token,
  );

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
  tampered: false,
  signals: signals,
  hash: String(hv),
  sessionId: sessionId,
  publicKeyB64: publicKeyB64,
  vm: vm,
};
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- VM return value
result;
