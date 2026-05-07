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
//
// HISTORY (bytecode-native-stringify): The payload JSON is now serialized
// in bytecode via a recursive walker (stringify/jsonEscape/hexDigit below).
// Previously the bridge's GET_PAYLOAD_JSON (0x13) did JSON.stringify in JS,
// giving attackers a chokepoint to substitute clean-baseline payloads via
// window.JSON.stringify hooks. No JS-level stringify call is on the
// payload path anymore — relies on OBJ_KEYS (0x64) / IS_ARRAY (0x66) opcodes.

// ── JSON serialization helpers ───────────────────────────────────────
// Recursive walker producing a valid JSON string from a JS value. Output
// is not byte-identical to JSON.stringify (e.g. undefined→null in arrays,
// key ordering) — byte-stability isn't required since the server parses
// semantically. Rules followed:
//   - null/undefined → 'null' (undefined in object keys → key omitted)
//   - numbers: NaN/±Infinity → 'null'; otherwise String(n)
//   - strings: double-quoted with \" \\ \n \r \t \b \f \u00XX escapes
//   - arrays/objects: recursive; object keys enumerated via Object.keys
function hexDigit(n) {
  if (n < 10) {
    return String.fromCharCode(48 + n);
  }
  return String.fromCharCode(87 + n);
}

function jsonEscape(s) {
  let out = '"';
  let i = 0;
  while (i < s.length) {
    let c = s.charCodeAt(i);
    if (c === 34) {
      out = out + '\\"';
    } else if (c === 92) {
      out = out + '\\\\';
    } else if (c === 10) {
      out = out + '\\n';
    } else if (c === 13) {
      out = out + '\\r';
    } else if (c === 9) {
      out = out + '\\t';
    } else if (c === 8) {
      out = out + '\\b';
    } else if (c === 12) {
      out = out + '\\f';
    } else if (c < 16) {
      out = out + '\\u000' + hexDigit(c);
    } else if (c < 32) {
      out = out + '\\u001' + hexDigit(c - 16);
    } else {
      out = out + String.fromCharCode(c);
    }
    i = i + 1;
  }
  return out + '"';
}

function stringify(v) {
  if (v === null) {
    return 'null';
  }
  let t = typeof v;
  if (t === 'undefined') {
    return 'null';
  }
  if (t === 'string') {
    return jsonEscape(v);
  }
  if (t === 'number') {
    // Non-finite guard (NaN, ±Infinity) in one expression:
    //   finite n  → n * 0 === 0
    //   NaN       → NaN * 0 === NaN  !== 0
    //   ±Infinity → ±Inf * 0 === NaN !== 0
    // Avoids isNaN/isFinite, which aren't wired in the shipped opcode table.
    if (v * 0 !== 0) {
      return 'null';
    }
    return String(v);
  }
  if (t === 'boolean') {
    if (v) {
      return 'true';
    }
    return 'false';
  }
  if (Array.isArray(v)) {
    let arrOut = '[';
    let ai = 0;
    while (ai < v.length) {
      if (ai > 0) {
        arrOut = arrOut + ',';
      }
      let item = v[ai];
      if (item === undefined) {
        arrOut = arrOut + 'null';
      } else {
        arrOut = arrOut + stringify(item);
      }
      ai = ai + 1;
    }
    return arrOut + ']';
  }
  let keys = Object.keys(v);
  let objOut = '{';
  let first = 1;
  let oi = 0;
  while (oi < keys.length) {
    let k = keys[oi];
    let val = v[k];
    if (val !== undefined) {
      if (first === 0) {
        objOut = objOut + ',';
      }
      objOut = objOut + jsonEscape(k) + ':' + stringify(val);
      first = 0;
    }
    oi = oi + 1;
  }
  return objOut + '}';
}

let tmp = 0;
let i = 0;
const vm = {};

// ── Anti-debug timing ─────────────────────────────────────────────────
// Samples pristine performance.now (via 0x70) at key checkpoints. Real
// execution on any device completes in well under these thresholds; only
// an interactive debugger (breakpoint, step-through, console paused)
// inflates them enough to flip a bit. Fields:
//   0x01  total bytecode runtime > 30s (breakpoint observed mid-execution)
//   0x02  stringify+scramble block > 500ms (stepping through payload build)
//   0x04  pre-stringify assembly > 500ms (debugger paused during device compose)
// The sum goes into payload.tamper_bits; 0 means "no timing anomaly seen."
let tamperBits = 0;
let tEntry = __api_get(0x70);

// ── 1. Async sigint probe fetches ─────────────────────────────────────
// These run in parallel at the bridge level; VM executes them sequentially
// but the bridge makes real fetch() calls. Tokens are opaque strings.
let tlsResult = __api_call_async(0x40);
let tcpToken = __api_call_async(0x41);
let h2Token = __api_call_async(0x42);
// PAT (Apple Private Access Token) probe — '' on any failure or non-Apple.
let patToken = __api_call_async(0x44);
// PAT diagnostic — JSON string {status, ok, hasToken, err?} from what the
// JS-level fetch() actually saw. Forensic only; not server-trusted.
let patDiag = __api_call_async(0x45);

// ── 1b. Device identity: sign XOR'd h2 token ──────────────────────────
// Persistent ECDSA pubkey survives the session (IndexedDB, non-extractable).
// Server verifies sig over xor(h2Token, KEY) — proves we hold the private
// key AND made a real h2-probe call within its 90s TTL.
//
// The XOR layer is cheap obfuscation: a reverser hooking crypto.subtle.sign
// sees garbage bytes rather than an obviously-HMAC'd token format. The key
// is code-level, not a secret — but they'd have to reverse this bytecode
// to discover it. Must match DEVICE_IDENTITY_XOR_KEY in ms-argus-api
// (src/helpers/device-identity.ts) or server sigs won't verify.
let devicePubkey = __api_call_async(0x1f);
let deviceSig = '';
if (h2Token.length > 0 && devicePubkey.length > 0) {
  let xorKey = [
    0x5a, 0x3f, 0x91, 0x2c, 0xb7, 0x44, 0x68, 0xe1, 0xd0, 0x0a, 0x7d, 0x59,
    0x13, 0xee, 0x82, 0xbc,
  ];
  let xored = '';
  i = 0;
  while (i < h2Token.length) {
    xored = xored + String.fromCharCode(h2Token.charCodeAt(i) ^ xorKey[i % 16]);
    i = i + 1;
  }
  deviceSig = __api_call_async(0x33, xored);
  xored = 0;
  xorKey = 0;
}

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

  // Three-store client UUID (IDB + localStorage + first-party cookie).
  // Complements device_identity's ECDSA keypair: the key can't respawn
  // (non-extractable), but the UUID can — it survives single-store clears.
  // Server uses it for cross-session graph correlation. null bundle means
  // total storage failure; we elide the field in that case.
  let uuidBundle = __api_call_async(0x20);
  if (uuidBundle) {
    device.client_uuid = uuidBundle.id;
    if (uuidBundle.conflicts.length > 0) {
      device.client_uuid_conflicts = uuidBundle.conflicts;
    }
  }
  uuidBundle = 0;

  // Checkpoint: time to reach payload assembly. Debugger paused during
  // device compose or on any earlier async probe inflates this.
  let tPreStringify = __api_get(0x70);
  if (tPreStringify - tEntry > 500) {
    tamperBits = tamperBits + 4;
  }

  // Build payload in bytecode, then serialize via the local walker.
  // pubkey+sig attach as device_identity when both non-empty. Bridge provides
  // only the opaque UUID (0x10) and meta (0x11) — no payload-level JSON
  // serialization is exposed to JS-level attackers anymore.
  let identifiers = { session_id: __api_get(0x10) };
  let meta = __api_get(0x11);
  let payload = {
    identifiers: identifiers,
    device: device,
    meta: meta,
  };
  if (tlsResult.length > 0) {
    payload.sigintTls = tlsResult;
  }
  if (tcpToken.length > 0) {
    payload.sigintTcpToken = tcpToken;
  }
  if (h2Token.length > 0) {
    payload.sigintH2Token = h2Token;
  }
  if (patToken.length > 0) {
    payload.patToken = patToken;
  }
  if (patDiag.length > 0) {
    payload.patDiag = patDiag;
  }
  if (devicePubkey.length > 0) {
    if (deviceSig.length > 0) {
      payload.device_identity = { pubkey: devicePubkey, sig: deviceSig };
    }
  }

  let payloadJSON = stringify(payload);

  // Checkpoint: stringify block. A debugger stepping through the walker
  // blows past 500ms; real execution stays under 10ms even for the full
  // collected payload.
  let tAfterStringify = __api_get(0x70);
  if (tAfterStringify - tPreStringify > 500) {
    tamperBits = tamperBits + 2;
  }
  // Total VM runtime check. >30s strongly suggests a breakpoint fired at
  // some point during execution — real devices finish in ~hundreds of ms.
  if (tAfterStringify - tEntry > 30000) {
    tamperBits = tamperBits + 1;
  }

  // Attach tamper signal to payload. Two-pass: we can't splice the string
  // in-bytecode (no .substring opcode in the VM), so on the (rare) tamper
  // path we re-run stringify with tamper_bits added. Acceptable cost —
  // by definition the debugger is already slowing this session down.
  if (tamperBits > 0) {
    payload.tamper_bits = tamperBits;
    payloadJSON = stringify(payload);
  }

  device = 0;
  devicePubkey = 0;
  deviceSig = 0;
  payload = 0;
  identifiers = 0;
  meta = 0;

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
      scrambled =
        scrambled + String.fromCharCode(payloadJSON.charCodeAt(i) ^ (t ^ f));
      let fib2 = fib0 + fib1;
      fib0 = fib1;
      fib1 = fib2;
      if (fib1 > 1000000) {
        fib0 = 1;
        fib1 = 1;
      }
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
