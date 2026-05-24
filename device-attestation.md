# Device attestation API

The SDK exposes the device's persistent ECDSA-P256 keypair (the same key
used internally for integrity-collect signing) via a structured-envelope
signing surface. Callers pass `{purpose, payload}`, get back a signed
attestation; verifiers check the signature over the envelope and unpack
the payload.

This document covers the wire format and verification logic. It is
deliberately small — the envelope format is meant to be stable across SDK
versions so verifiers don't need to track SDK internals.

## API surface (browser side)

After `argus-loader.iife.js` is loaded:

```ts
// Run integrity AND attestation in one iframe lifecycle. Recommended.
const result = await window.argus.run({
  sessionId: 'order-123',
  cpi: 'argus_cpi_...',
  attest: {
    purpose: 'argus-pair-v1',
    payload: { sessionId, nonce, peerAttestation },
    ttlSeconds: 60, // optional; default 60, max 300
  },
});
// result.attestation = { envelope, signature, publicKey, keyId }
// result.attestError = null on success, string on signing failure

// Convenience wrappers (each runs a full integrity scan under the hood):
const { publicKey, keyId } = await window.argus.getDevicePublicKey();
const attestation = await window.argus.signAssertion({
  purpose: 'merchant-acme-checkout-v1',
  payload: { orderId, totalCents },
});
```

## Envelope format

The signed envelope is a JSON object, then base64url-encoded for transport:

```ts
{
  v: 1,                  // version
  purpose: string,       // namespace tag (signed)
  payload: unknown,      // caller-supplied JSON
  iat: number,           // unix seconds, issued-at
  exp: number,           // unix seconds, expires-at (iat + ttlSeconds)
  keyId: string,         // sha256(SPKI)[0..16] in lowercase hex
}
```

The signature is `ECDSA-P256-SHA-256` over the **raw bytes of the
base64url-encoded envelope** (not the JSON). This means verifiers don't
need to canonicalize — they verify the exact bytes the client signed.

The attestation returned to the caller is:

```ts
{
  envelope: string,    // base64url(JSON(envelope-as-above))
  signature: string,   // base64(ECDSA(envelope-bytes))
  publicKey: string,   // base64(SPKI)
  keyId: string,       // sha256(SPKI)[0..16]
}
```

## Verification (server side)

Pseudocode for any verifier:

```python
def verify_attestation(att, expected_purpose, clock_skew_seconds=10):
    # 1. Decode envelope
    envelope_json = base64url_decode(att.envelope)
    env = json.loads(envelope_json)
    assert env["v"] == 1

    # 2. Check freshness
    now = int(time.time())
    assert env["iat"] - clock_skew_seconds <= now
    assert now <= env["exp"] + clock_skew_seconds

    # 3. Check purpose
    assert env["purpose"] == expected_purpose

    # 4. Check key consistency
    pub_spki = base64_decode(att.publicKey)
    derived_key_id = sha256(pub_spki).hex()[:16]
    assert derived_key_id == env["keyId"] == att.keyId

    # 5. Verify signature over the raw envelope bytes
    sig_bytes = base64_decode(att.signature)
    envelope_bytes = att.envelope.encode("utf-8")  # the base64url string itself
    public_key = load_ecdsa_p256_from_spki(pub_spki)
    public_key.verify(sig_bytes, envelope_bytes, hashes.SHA256())

    return env["payload"]
```

## Constraints

- **Payload size**: hard cap at 8 KB after JSON encoding. Reject `>8 KB`
  before signing — keeps envelopes small enough for URLs/headers.
- **Purpose length**: max 128 chars.
- **TTL**: clamped to `[1, 300]` seconds. Anything outside is silently
  pinned to the range.

## Purpose namespace convention

The `purpose` field is a free-form string but should follow a namespace
convention so verifiers in different contexts don't have to coordinate
on collision-avoidance.

- `argus-*` — reserved for Argus-operated flows. Examples:
  `argus-pair-v1` (phone-pair captcha), `argus-pubkey-export-v1` (returned
  by `getDevicePublicKey()`), etc.
- Merchant-defined purposes — prefix with `merchant-<merchant-tag>-`.
  Examples: `merchant-acme-checkout-v1`.

Versioning is encoded in the purpose itself (`-v1`, `-v2`); verifiers
should reject unknown versions rather than guessing.

## Threat model notes

- The SDK key is **non-extractable** (`crypto.subtle.generateKey(..., false, ...)`).
  XSS on the host page can call `signAssertion` to mint signatures for
  arbitrary purposes but cannot exfiltrate the private key. Treat
  attestations as proof that **something running on the origin** signed,
  not proof of human intent.
- **Cross-origin**: each origin has its own keypair (browser storage
  partitioning). Same physical user on `merchant-a.com` and
  `merchant-b.com` looks like two different devices. By design.
- **Replay**: signatures bind `purpose + iat + exp` into the envelope, so
  a signature for one purpose cannot be replayed as another, and old
  signatures fail the freshness check. Callers should still include
  server-issued nonces in `payload` for protocols that need
  pairing-level replay protection.
- **Rotation**: if the user clears site data, the next session generates
  a fresh keypair. `keyId` changes. Server-side state pinned to an old
  `keyId` should treat this as a new device.
