import { describe, it, expect } from 'vitest';

/**
 * Fibonacci-modulated XOR scramble — mirrors the VM bytecode logic in
 * scripts/vm-src/main.ts (lines 255-275).
 *
 * This is a pure reference implementation used to verify round-trip
 * consistency with the server's deriveAndUnscramble().
 */
function fibScramble(plaintext: string, sessionToken: string): string {
  let fib0 = 1;
  let fib1 = 1;
  let scrambled = '';
  for (let i = 0; i < plaintext.length; i++) {
    const t = sessionToken.charCodeAt(i % sessionToken.length);
    const f = fib1 % 256;
    scrambled += String.fromCharCode(plaintext.charCodeAt(i) ^ (t ^ f));
    const fib2 = fib0 + fib1;
    fib0 = fib1;
    fib1 = fib2;
    if (fib1 > 1000000) {
      fib0 = 1;
      fib1 = 1;
    }
  }
  return scrambled;
}

/** Server-side unscramble (Buffer-based, same as ecdh-decrypt.ts deriveAndUnscramble) */
function serverUnscramble(scrambled: string, sessionToken: string): string {
  const data = Buffer.from(scrambled, 'binary');
  const result = Buffer.alloc(data.length);
  let fib0 = 1;
  let fib1 = 1;
  for (let i = 0; i < data.length; i++) {
    const t = sessionToken.charCodeAt(i % sessionToken.length);
    const f = fib1 % 256;
    result[i] = data[i] ^ (t ^ f);
    const fib2 = fib0 + fib1;
    fib0 = fib1;
    fib1 = fib2;
    if (fib1 > 1000000) {
      fib0 = 1;
      fib1 = 1;
    }
  }
  return result.toString('binary');
}

describe('Fibonacci-modulated XOR scramble', () => {
  it('round-trips a JSON payload', () => {
    const token = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    const payload = '{"fingerprint":"abc123","vmSignals":["vm:webdriver"]}';
    const scrambled = fibScramble(payload, token);
    const recovered = serverUnscramble(scrambled, token);
    expect(recovered).toBe(payload);
  });

  it('scrambled output differs from plaintext', () => {
    const token = 'session-token';
    const payload = 'hello world';
    const scrambled = fibScramble(payload, token);
    expect(scrambled).not.toBe(payload);
  });

  it('different tokens produce different scrambled output', () => {
    const payload = '{"test":true}';
    const s1 = fibScramble(payload, 'token-aaa');
    const s2 = fibScramble(payload, 'token-bbb');
    expect(s1).not.toBe(s2);
  });

  it('Fibonacci modulation makes each byte position unique', () => {
    const token = 'A';
    const payload = 'AAAAAAAAAA';
    const scrambled = fibScramble(payload, token);
    const chars = [...scrambled].map((c) => c.charCodeAt(0));
    const unique = new Set(chars);
    // With Fibonacci modulation, we should get multiple distinct values
    // even though both token and payload are single repeated chars
    expect(unique.size).toBeGreaterThan(1);
  });

  it('handles payload longer than token (token cycles)', () => {
    const token = 'ab';
    const payload = 'x'.repeat(1000);
    const scrambled = fibScramble(payload, token);
    const recovered = serverUnscramble(scrambled, token);
    expect(recovered).toBe(payload);
  });

  it('handles Fibonacci reset across the 1M boundary', () => {
    // Fibonacci grows: 1,1,2,3,5,8,13,21,34,55,89,144,...
    // Reaches 1M around i=30 (fib(30)=1346269)
    // Verify that positions before and after reset produce correct round-trip
    const token = 'test';
    const payload = 'x'.repeat(200);
    const scrambled = fibScramble(payload, token);
    const recovered = serverUnscramble(scrambled, token);
    expect(recovered).toBe(payload);
  });

  it('produces different output than simple repeating-key XOR (v1)', () => {
    const token = 'my-session-token';
    const payload = '{"data":"value"}';

    // v2: Fibonacci-modulated
    const v2 = fibScramble(payload, token);

    // v1: simple repeating key XOR
    let v1 = '';
    for (let i = 0; i < payload.length; i++) {
      v1 += String.fromCharCode(
        payload.charCodeAt(i) ^ token.charCodeAt(i % token.length),
      );
    }

    expect(v2).not.toBe(v1);
  });

  it('matches server Buffer-based implementation byte-for-byte', () => {
    const token = 'abc123def456ghi789jkl012mno345pqr';
    const payload = JSON.stringify({
      fingerprint: { stable_hash: 'deadbeef', canvas: 'cafebabe' },
      vmSignals: ['vm:webdriver', 'vm:no_plugins'],
      tampered: true,
    });

    const clientScrambled = fibScramble(payload, token);
    // Verify server can unscramble what client scrambled
    const serverRecovered = serverUnscramble(clientScrambled, token);
    expect(serverRecovered).toBe(payload);

    // And the reverse: server-scrambled can be client-unscrambled
    // (scramble and unscramble are the same XOR operation)
    const serverScrambled = serverUnscramble(payload, token);
    const clientRecovered = fibScramble(serverScrambled, token);
    // XOR is its own inverse, but with Fibonacci the "scramble" and "unscramble"
    // use the same key stream, so scramble(scramble(x)) = x
    expect(clientRecovered).toBe(payload);
  });
});
