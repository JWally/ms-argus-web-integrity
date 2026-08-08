import { getPristineRefs } from '../utils/pristine-iframe';

const HKDF_INFO = getPristineRefs().textEncode('argus-web-v1');

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(value: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < value.length; i++) {
    binary += String.fromCharCode(value[i]);
  }
  return btoa(binary);
}

/** Same reversible string-level transform as integrity transport v3. */
export function scramblePayload(value: string, sessionToken: string): string {
  let result = '';
  let fib0 = 1;
  let fib1 = 1;
  for (let i = 0; i < value.length; i++) {
    const token = sessionToken.charCodeAt(i % sessionToken.length);
    const fib = fib1 % 256;
    result += String.fromCharCode(value.charCodeAt(i) ^ (token ^ fib));
    const fib2 = fib0 + fib1;
    fib0 = fib1;
    fib1 = fib2;
    if (fib1 > 1_000_000) {
      fib0 = 1;
      fib1 = 1;
    }
  }
  return result;
}

export async function encryptProxyPayload(input: {
  payloadJson: string;
  sessionToken: string;
  serverPublicKey: string;
}): Promise<{ encrypted: Uint8Array; clientPublicKey: string }> {
  const pristine = getPristineRefs();
  if (!pristine.subtle) throw new Error('argus-proxy: crypto unavailable');
  const subtle = pristine.subtle;
  const pair = (await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )) as CryptoKeyPair;
  const rawPublicKey = await subtle.exportKey('raw', pair.publicKey);
  const serverPublicKey = await subtle.importKey(
    'raw',
    base64ToBytes(input.serverPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedBits = await subtle.deriveBits(
    { name: 'ECDH', public: serverPublicKey },
    pair.privateKey,
    256,
  );
  const hkdfKey = await subtle.importKey('raw', sharedBits, 'HKDF', false, [
    'deriveKey',
  ]);
  const aesKey = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: pristine.textEncode(new Date().toISOString().slice(0, 10)),
      info: HKDF_INFO,
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = pristine.getRandomValues(new Uint8Array(12));
  const scrambled = scramblePayload(input.payloadJson, input.sessionToken);
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    pristine.textEncode(scrambled),
  );
  const encrypted = new Uint8Array(12 + ciphertext.byteLength);
  encrypted.set(iv);
  encrypted.set(new Uint8Array(ciphertext), 12);
  return {
    encrypted,
    clientPublicKey: bytesToBase64(new Uint8Array(rawPublicKey)),
  };
}
