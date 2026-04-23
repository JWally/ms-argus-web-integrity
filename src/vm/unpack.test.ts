import { describe, it, expect } from 'vitest';
import { pack, unpack, BUCKET_MS, SKEW, SALT_LEN, KEY_LEN } from './unpack';

/** A plaintext bytecode-shaped buffer: [magic 0x41424d56][version=2][flags=0][256B opcodeMap][...]. */
function mkBytecode(): Uint8Array {
  const buf = new Uint8Array(8 + 256 + 64);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x41424d56, false); // magic "ABMV"
  view.setUint16(4, 2, false);
  view.setUint16(6, 0, false);
  for (let i = 0; i < 256; i++) buf[8 + i] = i;
  for (let i = 0; i < 64; i++) buf[8 + 256 + i] = i * 3;
  return buf;
}

function mkKey(seed: number): Uint8Array {
  const out = new Uint8Array(KEY_LEN);
  for (let i = 0; i < KEY_LEN; i++) out[i] = (seed * (i + 7)) & 0xff;
  return out;
}

function mkSalt(seed: number): Uint8Array {
  const out = new Uint8Array(SALT_LEN);
  for (let i = 0; i < SALT_LEN; i++) out[i] = (seed * (i + 11)) & 0xff;
  return out;
}

describe('unpack', () => {
  const now = Date.UTC(2026, 3, 23);
  const bucket = Math.floor(now / BUCKET_MS);

  it('round-trips bytecode at the build bucket', async () => {
    const src = mkBytecode();
    const blob = await pack(src, { realKey: mkKey(1), salt: mkSalt(2), bucket });
    const b64 = Buffer.from(blob).toString('base64');
    const out = await unpack(b64, now);
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual(Array.from(src));
  });

  it('accepts clients within ±SKEW buckets', async () => {
    const src = mkBytecode();
    const blob = await pack(src, { realKey: mkKey(3), salt: mkSalt(4), bucket });
    const b64 = Buffer.from(blob).toString('base64');
    for (let d = -SKEW; d <= SKEW; d++) {
      const out = await unpack(b64, now + d * BUCKET_MS);
      expect(out, `skew=${d}`).not.toBeNull();
    }
  });

  it('rejects clients outside ±SKEW buckets', async () => {
    const src = mkBytecode();
    const blob = await pack(src, { realKey: mkKey(5), salt: mkSalt(6), bucket });
    const b64 = Buffer.from(blob).toString('base64');
    expect(await unpack(b64, now + (SKEW + 1) * BUCKET_MS)).toBeNull();
    expect(await unpack(b64, now - (SKEW + 1) * BUCKET_MS)).toBeNull();
  });

  it('rejects a tampered blob (flipped salt byte changes derived key)', async () => {
    const src = mkBytecode();
    const blob = await pack(src, { realKey: mkKey(7), salt: mkSalt(8), bucket });
    // Flip a salt byte: embed_mask changes → real_key changes → magic fails
    blob[0] ^= 0xff;
    const b64 = Buffer.from(blob).toString('base64');
    const out = await unpack(b64, now);
    expect(out).toBeNull();
  });

  it('rejects a tampered blob (flipped stored_key byte at position 0)', async () => {
    // Note: magic validation only covers plain[0..3]. Because the 32-byte key
    // is cycled, a stored_key byte at offset K invalidates plain bytes only at
    // positions where (i % 32) === K. So this test flips stored_key[0] —
    // which lands on magic byte 0 — not a byte at an offset that doesn't
    // intersect the magic range.
    const src = mkBytecode();
    const blob = await pack(src, { realKey: mkKey(9), salt: mkSalt(10), bucket });
    blob[blob.length - KEY_LEN] ^= 0xff;
    const b64 = Buffer.from(blob).toString('base64');
    const out = await unpack(b64, now);
    expect(out).toBeNull();
  });

  it('rejects a tampered blob (flipped magic byte of scrambled bytecode)', async () => {
    const src = mkBytecode();
    const blob = await pack(src, { realKey: mkKey(11), salt: mkSalt(12), bucket });
    // The scrambled bytecode starts at offset SALT_LEN (8); first 4 bytes
    // carry the magic. Flipping one of those bytes makes magic check fail.
    blob[SALT_LEN] ^= 0xff;
    const b64 = Buffer.from(blob).toString('base64');
    const out = await unpack(b64, now);
    expect(out).toBeNull();
  });

  it('different salts / keys produce different blobs', async () => {
    const src = mkBytecode();
    const b1 = await pack(src, { realKey: mkKey(1), salt: mkSalt(1), bucket });
    const b2 = await pack(src, { realKey: mkKey(2), salt: mkSalt(2), bucket });
    expect(Buffer.from(b1).equals(Buffer.from(b2))).toBe(false);
  });

  it('rejects blobs that are too small to hold wrapper', async () => {
    const tiny = Buffer.from(new Uint8Array(16)).toString('base64');
    expect(await unpack(tiny, now)).toBeNull();
  });
});
