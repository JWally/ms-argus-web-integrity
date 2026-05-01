/**
 * Bytecode unpacker — recovers plaintext bytecode from a packed blob.
 *
 * The packed blob layout (produced by scripts/compile-vm.ts):
 *
 *   [salt  SALT_LEN B] [scrambled bytecode N B] [stored_key KEY_LEN B]
 *
 * Real key recovery:
 *   embed_mask  = SHA-256("argus-vm-k-" || salt).slice(0, KEY_LEN)
 *   real_key    = stored_key XOR embed_mask
 *
 * Effective key (time-bucketed):
 *   time_mask   = SHA-256("argus-vm-t-" || bucket_u64_BE).slice(0, KEY_LEN)
 *   effective   = real_key XOR time_mask
 *   plaintext   = scrambled XOR effective
 *
 * The build picks bucket = floor(buildTime / BUCKET_MS) and scrambles with
 * that bucket's effective key. At load time we try the current bucket plus
 * ±SKEW neighbors and accept the first candidate whose decoded magic matches.
 *
 * If all buckets fail, the blob is stale — re-deploy.
 *
 * Expected plaintext magic: 0x41424D56 ("ABMV"), matches src/vm/format.ts.
 */

export const SALT_LEN = 8;
export const KEY_LEN = 32;
/** One bucket = 24 hours. Re-deploy every ~7 days so ±SKEW window stays open. */
export const BUCKET_MS = 24 * 60 * 60 * 1000;
/** ±SKEW bucket tolerance at the client. Window width = (2*SKEW + 1) buckets. */
export const SKEW = 3;

const MAGIC = 0x41424d56;
const te = new TextEncoder();

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function bucketToBytes(bucket: number): Uint8Array {
  // 8-byte big-endian encoding — use BigInt for precision
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, BigInt(bucket), false);
  return buf;
}

async function sha256(input: Uint8Array): Promise<Uint8Array> {
  const h = await crypto.subtle.digest('SHA-256', input as BufferSource);
  return new Uint8Array(h);
}

export async function deriveEmbedMask(salt: Uint8Array): Promise<Uint8Array> {
  const h = await sha256(concatBytes(te.encode('argus-vm-k-'), salt));
  return h.subarray(0, KEY_LEN);
}

export async function deriveTimeMask(bucket: number): Promise<Uint8Array> {
  const h = await sha256(
    concatBytes(te.encode('argus-vm-t-'), bucketToBytes(bucket)),
  );
  return h.subarray(0, KEY_LEN);
}

function xor(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Unpack a packed VM_BYTECODE string into plaintext bytecode.
 * Returns null if every candidate bucket fails magic verification.
 */
export async function unpack(
  b64: string,
  nowMs: number = Date.now(),
): Promise<Uint8Array | null> {
  const blob = base64ToBytes(b64);
  if (blob.length < SALT_LEN + KEY_LEN + 8) return null;

  const salt = blob.subarray(0, SALT_LEN);
  const scrambled = blob.subarray(SALT_LEN, blob.length - KEY_LEN);
  const storedKey = blob.subarray(blob.length - KEY_LEN);

  const embedMask = await deriveEmbedMask(salt);
  const realKey = xor(storedKey, embedMask);

  const nowBucket = Math.floor(nowMs / BUCKET_MS);
  // Try current bucket first, then widen outward.
  const order: number[] = [nowBucket];
  for (let d = 1; d <= SKEW; d++) order.push(nowBucket - d, nowBucket + d);

  for (const b of order) {
    const timeMask = await deriveTimeMask(b);
    const effective = xor(realKey, timeMask);
    const plain = xor(scrambled, effective);
    const magic = new DataView(plain.buffer, plain.byteOffset, 4).getUint32(0);
    if (magic === MAGIC) return plain;
  }
  return null;
}

/**
 * Build-side companion: assemble a packed blob given raw bytecode + a
 * build-time bucket. Returns the blob bytes (NOT base64). compile-vm.ts
 * uses this.
 */
export async function pack(
  bytecode: Uint8Array,
  opts: { realKey: Uint8Array; salt: Uint8Array; bucket: number },
): Promise<Uint8Array> {
  const { realKey, salt, bucket } = opts;
  if (realKey.length !== KEY_LEN) throw new Error('realKey must be KEY_LEN');
  if (salt.length !== SALT_LEN) throw new Error('salt must be SALT_LEN');

  const timeMask = await deriveTimeMask(bucket);
  const effective = xor(realKey, timeMask);
  const scrambled = xor(bytecode, effective);

  const embedMask = await deriveEmbedMask(salt);
  const storedKey = xor(realKey, embedMask);

  const out = new Uint8Array(salt.length + scrambled.length + storedKey.length);
  out.set(salt, 0);
  out.set(scrambled, salt.length);
  out.set(storedKey, salt.length + scrambled.length);
  return out;
}
