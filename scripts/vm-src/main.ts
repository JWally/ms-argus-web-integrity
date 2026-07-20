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

// ── HMAC chain over device slices ────────────────────────────────────
//
// Defends against cleartext-MITM on the SDK payload. An attacker who hooks
// `subtle.encrypt` or the bridge slice getters can see the cleartext and
// substitute any slice (lies, headless, navigator…) before encryption.
// To make a substitution the server accepts, they must also recompute
// `device.mac`. To do that they must know:
//
//   (a) BUILD_SALT below — 8 bytes, rotates per release
//   (b) the key derivation: which session-bound values feed in + in what
//       fixed order with what separator
//   (c) the slice absorb order (rotate per release)
//   (d) the canonical stringify (the bytecode walker above)
//
// All four live inside the bytecode. RE cost: days per release.
//
// ── KEY DERIVATION (this design) ─────────────────────────────────────
// Earlier revisions used a 32-byte hardcoded MAC_SECRET. That left a
// suspicious "random-looking" blob in the constant pool — a Google-able
// tell. Replaced with a TOKEN-DERIVED key:
//
//   material = sessionToken || \0 || sigintTls || \0 || sigintTcpToken
//              || \0 || sigintH2Token || \0 || devicePubkey
//              (empty parts omitted, both sides apply the same skip rule)
//   key      = HMAC(BUILD_SALT, material)
//   mac      = HMAC(key, absorb-chain-over-device)
//
// Bonus property the hardcoded version didn't have: the MAC is now
// bound to the session's actual server-issued tokens. An attacker who
// swaps sigintTls (e.g. to substitute a different IP's CF blob) breaks
// the MAC even if they leave the device block intact.
//
// SERVER COMPANION: see ms-argus-api defense/hmac-chain branch (TODO).
// Same BUILD_SALT, same skip rule, same order. Mismatch → tier-100
// device_tampering.
//
// BUILD_SALT: 8 random bytes. Rotate per release. Must match server.
let BUILD_SALT = [0x9c, 0x2f, 0xa1, 0x7b, 0x4e, 0xd3, 0x68, 0x05];

// MD5 round constants — floor(2^32 * abs(sin(i+1))) for i in 0..63
// (RFC 1321). MD5 is used here in HMAC mode where Wang-style collision
// attacks don't apply: the attacker can't produce a valid MAC for a
// substituted device block without knowing the secret key, and HMAC-MD5
// has no known practical break (RFC 6151 §2). Implementation-wise it
// halves the bytecode-register pressure vs SHA-256 (4 state words vs 8,
// no message schedule expansion).
let MD5_T = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
  0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
  0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
  0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
  0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
  0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

// MD5 per-step shift amounts (4 sequences of 4, each repeated 4 times).
let MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
];

// One 512-bit MD5 compression step. Pulled out of md5() so the inner
// while loop's locals (F, k, temp, t, s, rot) don't share the parent
// scope's register pool. Returns [A,B,C,D] deltas (caller adds them to
// the running state).
function md5Compress(A, B, C, D, M) {
  let i = 0;
  let F = 0;
  let k = 0;
  let temp = 0;
  let t = 0;
  let s = 0;
  let rot = 0;
  while (i < 64) {
    if (i < 16) {
      F = ((B & C) | (~B & D)) >>> 0;
      k = i;
    } else if (i < 32) {
      F = ((B & D) | (C & ~D)) >>> 0;
      k = (1 + 5 * i) % 16;
    } else if (i < 48) {
      F = (B ^ C ^ D) >>> 0;
      k = (5 + 3 * i) % 16;
    } else {
      F = (C ^ (B | ~D)) >>> 0;
      k = (7 * i) % 16;
    }
    temp = D;
    D = C;
    C = B;
    t = (A + F + MD5_T[i] + M[k]) >>> 0;
    s = MD5_S[i];
    rot = ((t << s) | (t >>> (32 - s))) >>> 0;
    B = (B + rot) >>> 0;
    A = temp;
    i = i + 1;
  }
  let r = [];
  r[0] = A;
  r[1] = B;
  r[2] = C;
  r[3] = D;
  return r;
}

// MD5 of a byte array (numbers 0-255). Returns 16-byte digest array.
function md5(bytes) {
  // Initial state (RFC 1321 §3.3, little-endian word view).
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  // Pre-processing: append 0x80, then zeros, then 64-bit LE bit length.
  let origLen = bytes.length;
  let bitLen = origLen * 8;
  let padded = [];
  let pi = 0;
  while (pi < origLen) {
    padded[pi] = bytes[pi];
    pi = pi + 1;
  }
  padded[pi] = 0x80;
  pi = pi + 1;
  while (pi % 64 !== 56) {
    padded[pi] = 0;
    pi = pi + 1;
  }
  // 64-bit LE bit length. JS-safe up to 2^53; high 32 bits zero for our
  // payload sizes (well under 2^32 bits).
  padded[pi + 0] = bitLen & 0xff;
  padded[pi + 1] = (bitLen >>> 8) & 0xff;
  padded[pi + 2] = (bitLen >>> 16) & 0xff;
  padded[pi + 3] = (bitLen >>> 24) & 0xff;
  padded[pi + 4] = 0;
  padded[pi + 5] = 0;
  padded[pi + 6] = 0;
  padded[pi + 7] = 0;
  pi = pi + 8;

  // Process each 512-bit chunk.
  let chunkStart = 0;
  while (chunkStart < pi) {
    // Build 16-word LE message block.
    let M = [];
    let mi = 0;
    while (mi < 16) {
      let mb0 = padded[chunkStart + mi * 4 + 0];
      let mb1 = padded[chunkStart + mi * 4 + 1];
      let mb2 = padded[chunkStart + mi * 4 + 2];
      let mb3 = padded[chunkStart + mi * 4 + 3];
      M[mi] = (mb0 | (mb1 << 8) | (mb2 << 16) | (mb3 << 24)) >>> 0;
      mi = mi + 1;
    }

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    let abcd = md5Compress(A, B, C, D, M);
    a0 = (a0 + abcd[0]) >>> 0;
    b0 = (b0 + abcd[1]) >>> 0;
    c0 = (c0 + abcd[2]) >>> 0;
    d0 = (d0 + abcd[3]) >>> 0;
    chunkStart = chunkStart + 64;
  }

  // Output: 4 × 32-bit little-endian → 16 bytes.
  let out = [];
  let state = [a0, b0, c0, d0];
  let oi = 0;
  while (oi < 4) {
    let hv = state[oi];
    out[oi * 4 + 0] = hv & 0xff;
    out[oi * 4 + 1] = (hv >>> 8) & 0xff;
    out[oi * 4 + 2] = (hv >>> 16) & 0xff;
    out[oi * 4 + 3] = (hv >>> 24) & 0xff;
    oi = oi + 1;
  }
  return out;
}

// HMAC-MD5(key, msg). Standard RFC 2104 construction. Block size B = 64
// (MD5). Key > B bytes is replaced by md5(key) (16 bytes).
function hmacMd5(key, msg) {
  let k = [];
  let ki = 0;
  if (key.length > 64) {
    let kh = md5(key);
    while (ki < 16) {
      k[ki] = kh[ki];
      ki = ki + 1;
    }
  } else {
    while (ki < key.length) {
      k[ki] = key[ki];
      ki = ki + 1;
    }
  }
  while (ki < 64) {
    k[ki] = 0;
    ki = ki + 1;
  }
  let ipad = [];
  let opad = [];
  let pi = 0;
  while (pi < 64) {
    ipad[pi] = k[pi] ^ 0x36;
    opad[pi] = k[pi] ^ 0x5c;
    pi = pi + 1;
  }
  let inner = [];
  let ii = 0;
  while (ii < 64) {
    inner[ii] = ipad[ii];
    ii = ii + 1;
  }
  let mi = 0;
  while (mi < msg.length) {
    inner[64 + mi] = msg[mi];
    mi = mi + 1;
  }
  let innerHash = md5(inner);
  let outer = [];
  let oi = 0;
  while (oi < 64) {
    outer[oi] = opad[oi];
    oi = oi + 1;
  }
  let ohi = 0;
  while (ohi < 16) {
    outer[64 + ohi] = innerHash[ohi];
    ohi = ohi + 1;
  }
  return md5(outer);
}

// strBytes was inlined into computeDeviceMac to free a function-register
// slot (the bytecode register budget is tight). String → byte array via
// per-char `s.charCodeAt(i) & 0xff` is now done inline at the one call
// site that needed it.

// Append a slice's (sliceId 4-byte BE || stringify(value) bytes) to the
// running absorb buffer. The buffer is HMAC'd at the end. Per-slice
// length-prefix isn't needed because stringify is self-delimiting (each
// chunk is a complete JSON value) — but the sliceId is critical so an
// attacker can't shuffle slices and still match the MAC.
function macAbsorb(buf, sliceId, value) {
  let len = buf.length;
  buf[len + 0] = (sliceId >>> 24) & 0xff;
  buf[len + 1] = (sliceId >>> 16) & 0xff;
  buf[len + 2] = (sliceId >>> 8) & 0xff;
  buf[len + 3] = sliceId & 0xff;
  let j = stringify(value);
  let ji = 0;
  let base = len + 4;
  while (ji < j.length) {
    buf[base + ji] = j.charCodeAt(ji) & 0xff;
    ji = ji + 1;
  }
}

// Byte array → lowercase hex string. Used to encode device.mac for the wire.
function bytesToHex(b) {
  let out = '';
  let bi = 0;
  while (bi < b.length) {
    let byte = b[bi];
    out = out + hexDigit((byte >>> 4) & 0xf) + hexDigit(byte & 0xf);
    bi = bi + 1;
  }
  return out;
}

// Walk the device object in a fixed (bytecode-private) order, absorb each
// slice into a buffer prefixed by its 4-byte BE slice ID, then HMAC the
// whole buffer under a key derived from session-bound material.
//
// Why a function and not inline at the call site: the call site already
// uses ~30 registers; the bytecode compiler caps GP regs at 48. Pulling
// the chain into a function isolates its locals.
function computeDeviceMac(device, sessionToken, tls, tcp, h2, devicePub) {
  let buf = [];
  macAbsorb(buf, 0x50, device.css);
  macAbsorb(buf, 0x51, device.engine);
  macAbsorb(buf, 0x52, device.math);
  macAbsorb(buf, 0x53, device.headless);
  macAbsorb(buf, 0x54, device.lies);
  macAbsorb(buf, 0x55, device.trash);
  macAbsorb(buf, 0x56, device.shielding);
  macAbsorb(buf, 0x57, device.incognito);
  macAbsorb(buf, 0x58, device.intl);
  macAbsorb(buf, 0x59, device.navigator);
  macAbsorb(buf, 0x5a, device.screen);
  macAbsorb(buf, 0x5b, device.status);
  macAbsorb(buf, 0x5c, device.timezone);
  macAbsorb(buf, 0x5d, device.timing);
  macAbsorb(buf, 0x5e, device.cssMedia);
  macAbsorb(buf, 0x5f, device.webrtc);
  macAbsorb(buf, 0x60, device.windowPrefixes);
  macAbsorb(buf, 0x61, device.workerScope);
  macAbsorb(buf, 0x62, device.errors);
  macAbsorb(buf, 0x63, device.canvas);
  macAbsorb(buf, 0x64, device.audio);
  macAbsorb(buf, 0x65, device.fonts);
  macAbsorb(buf, 0x66, device.worker_attest);
  // Build key material inline. Fixed (bytecode-private) order:
  // sessionToken, sigintTls, sigintTcpToken, sigintH2Token, devicePubkey.
  // Empty parts skipped; \0 separator (none of these contain raw null).
  let s = sessionToken;
  if (tls.length > 0) {
    s = s + String.fromCharCode(0) + tls;
  }
  if (tcp.length > 0) {
    s = s + String.fromCharCode(0) + tcp;
  }
  if (h2.length > 0) {
    s = s + String.fromCharCode(0) + h2;
  }
  if (devicePub.length > 0) {
    s = s + String.fromCharCode(0) + devicePub;
  }
  // Inline strBytes(s) → byte array via per-char charCodeAt + mask.
  let sb = [];
  let sbi = 0;
  while (sbi < s.length) {
    sb[sbi] = s.charCodeAt(sbi) & 0xff;
    sbi = sbi + 1;
  }
  let key = hmacMd5(BUILD_SALT, sb);
  return bytesToHex(hmacMd5(key, buf));
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

// ── 1b. Device identity: sign the current payload-bound input ─────────
// Persistent ECDSA pubkey survives the session (IndexedDB, non-extractable).
// Server verifies h2Token|stableHash|fuzzyHash, proving we hold the private
// key, made a fresh H2 probe, and signed the device hash carried on this
// submission. The current collector has no fuzzy hash, so that field is the
// empty string on both sides of the contract.
let meta = __api_get(0x11);
let devicePubkey = __api_call_async(0x1f);
let deviceSig = '';
if (h2Token.length > 0 && devicePubkey.length > 0) {
  deviceSig = __api_call_async(0x33, h2Token + '|' + meta.compositeHash + '|');
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
    canvas: __api_get(0x63),
    audio: __api_get(0x64),
    fonts: __api_get(0x65),
    worker_attest: __api_get(0x66),
  };

  // ── MAC chain: absorb each slice → HMAC under a token-derived key.
  // The key material is built from sessionToken + sigintTls + sigintTcpToken
  // + sigintH2Token + devicePubkey — all session-bound, server has the same.
  // Binds the MAC not just to the device block but to the specific tokens
  // this session received; swapping any token breaks the MAC.
  // ── MAC chain: absorb each slice → HMAC under a token-derived key.
  // See computeDeviceMac for full algorithm + key derivation.
  device.mac = computeDeviceMac(
    device,
    __api_get(0x1e),
    tlsResult,
    tcpToken,
    h2Token,
    devicePubkey,
  );

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
  let payload = {
    identifiers: identifiers,
    hashes: { stable: meta.compositeHash, fuzzy: '' },
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

  // Server-managed client-carried state. Read sync from localStorage via
  // bridge 0x21 — '' on first visit or storage unavailable. Bridge
  // POST_PAYLOAD writes the response's `cache` back to localStorage as
  // a side effect on success, so the next submission picks up the
  // updated value automatically. Field name on the wire is bland by
  // design — see helpers/payload-schema in ms-argus-api.
  let cacheValue = __api_get(0x21);
  if (cacheValue.length > 0) {
    payload.cache = cacheValue;
  }
  cacheValue = 0;

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
