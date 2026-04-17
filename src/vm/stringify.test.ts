/**
 * Tests for the bytecode-native JSON walker in scripts/vm-src/main.ts.
 *
 * Two layers:
 *  1. Reference impl — a TS transcription of the walker. Exhaustive battery,
 *     checks `JSON.parse(walker(v))` deep-equals `JSON.parse(JSON.stringify(v))`
 *     for every JSON-representable input.
 *  2. Bytecode parity — compiles the same walker as a vm-src program, runs it
 *     through the MiniVM, and confirms output matches the reference impl
 *     byte-for-byte on a sample of cases. Catches compiler regressions that
 *     the logical tests can't see.
 *
 * The walker is intentionally NOT byte-identical to JSON.stringify (key order
 * is the same, but behaviour for top-level undefined / NaN / Infinity diverges:
 * walker returns 'null', JSON.stringify returns undefined / throws). Tests
 * assert the round-trip property instead of byte equality with JSON.stringify.
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../../scripts/compiler/index';
import { executeAsync } from './interpreter';
import { ApiBridge } from './bridge';

// ─────────────────────────────────────────────────────────────────────
// Reference implementation — keep in sync with scripts/vm-src/main.ts
// ─────────────────────────────────────────────────────────────────────

function hexDigit(n: number): string {
  if (n < 10) return String.fromCharCode(48 + n);
  return String.fromCharCode(87 + n);
}

function jsonEscape(s: string): string {
  let out = '"';
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 34) out += '\\"';
    else if (c === 92) out += '\\\\';
    else if (c === 10) out += '\\n';
    else if (c === 13) out += '\\r';
    else if (c === 9) out += '\\t';
    else if (c === 8) out += '\\b';
    else if (c === 12) out += '\\f';
    else if (c < 16) out += '\\u000' + hexDigit(c);
    else if (c < 32) out += '\\u001' + hexDigit(c - 16);
    else out += String.fromCharCode(c);
    i += 1;
  }
  return out + '"';
}

 
function stringify(v: any): string {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'undefined') return 'null';
  if (t === 'string') return jsonEscape(v);
  if (t === 'number') {
    if (isNaN(v)) return 'null';
    if (!isFinite(v)) return 'null';
    return String(v);
  }
  if (t === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    let out = '[';
    for (let ai = 0; ai < v.length; ai += 1) {
      if (ai > 0) out += ',';
      const item = v[ai];
      if (item === undefined) out += 'null';
      else out += stringify(item);
    }
    return out + ']';
  }
  const keys = Object.keys(v);
  let out = '{';
  let first = 1;
  for (let oi = 0; oi < keys.length; oi += 1) {
    const k = keys[oi];
    const val = v[k];
    if (val !== undefined) {
      if (first === 0) out += ',';
      out += jsonEscape(k) + ':' + stringify(val);
      first = 0;
    }
  }
  return out + '}';
}

// ─────────────────────────────────────────────────────────────────────
// Test battery
// ─────────────────────────────────────────────────────────────────────

interface Case {
  name: string;
  input: unknown;
  /** skipRoundTrip: case diverges from JSON.stringify (top-level undef / NaN). */
  skipRoundTrip?: boolean;
}

const ctrlChars = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('');

const deepArray: unknown = (() => {
  let cur: unknown = 42;
  for (let i = 0; i < 50; i += 1) cur = [cur];
  return cur;
})();

const deepObject: unknown = (() => {
  let cur: unknown = { leaf: true };
  for (let i = 0; i < 50; i += 1) cur = { nested: cur };
  return cur;
})();

const realPayload = {
  identifiers: { session_id: '11111111-2222-3333-4444-555555555555' },
  device: {
    css: { browser: 'chrome', features: [1, 2, 3] },
    navigator: { userAgent: 'Mozilla/5.0', hardwareConcurrency: 8, emoji: '🖥️' },
    timing: [0.1, 0.2, 0.3],
    lies: {},
    nested: { deep: { value: null, arr: [1, null, undefined, 'x'] } },
  },
  meta: { durationMs: 123.456, version: '1.2.3' },
  sigintTls: 't13d1516h2_deadbeef',
  device_identity: { pubkey: 'AAA=', sig: 'BBB=' },
};

const cases: Case[] = [
  // Primitives
  { name: 'null', input: null },
  { name: 'true', input: true },
  { name: 'false', input: false },
  { name: 'zero', input: 0 },
  { name: 'negative zero', input: -0 },
  { name: 'positive int', input: 42 },
  { name: 'negative int', input: -42 },
  { name: 'small positive int', input: 1 },
  { name: 'large int', input: Number.MAX_SAFE_INTEGER },
  { name: 'pi', input: 3.141592653589793 },
  { name: 'negative float', input: -2.718281828 },
  { name: 'tiny positive', input: Number.MIN_VALUE },
  { name: 'scientific large', input: 1e20 },
  { name: 'scientific small', input: 1e-20 },
  { name: 'float with repeating decimals', input: 0.1 + 0.2 }, // 0.30000000000000004
  { name: 'NaN (top-level)', input: NaN, skipRoundTrip: true },
  { name: 'Infinity (top-level)', input: Infinity, skipRoundTrip: true },
  { name: 'negative Infinity (top-level)', input: -Infinity, skipRoundTrip: true },
  { name: 'undefined (top-level)', input: undefined, skipRoundTrip: true },

  // Strings
  { name: 'empty string', input: '' },
  { name: 'simple string', input: 'hello world' },
  { name: 'string with space', input: '  leading and trailing  ' },
  { name: 'string with double quote', input: 'he said "hi"' },
  { name: 'string with backslash', input: 'C:\\path\\to\\file' },
  { name: 'string with newline', input: 'line1\nline2' },
  { name: 'string with tab', input: 'a\tb\tc' },
  { name: 'string with CR', input: 'a\rb' },
  { name: 'string with backspace', input: 'a\bb' },
  { name: 'string with formfeed', input: 'a\fb' },
  { name: 'string with all control chars 0x00..0x1F', input: ctrlChars },
  { name: 'string with DEL 0x7F (not escaped)', input: '\x7f' },
  { name: 'string with forward slash (not escaped)', input: 'https://example.com/a/b' },
  { name: 'Chinese characters', input: '你好世界' },
  { name: 'Japanese characters', input: 'こんにちは' },
  { name: 'Arabic (RTL)', input: 'مرحبا بالعالم' },
  { name: 'Hebrew (RTL)', input: 'שלום עולם' },
  { name: 'Cyrillic', input: 'Привет мир' },
  { name: 'emoji (surrogate pairs)', input: '🔥💎🚀' },
  { name: 'mixed unicode', input: 'Hello 世界 🌍 مرحبا' },
  { name: 'high codepoint (U+FFFF)', input: '\uffff' },
  { name: 'low surrogate half (unpaired)', input: '\uD800' },
  { name: 'combining marks', input: 'e\u0301' }, // é as e + combining acute
  { name: 'newline + quote + backslash combo', input: 'a"\nb\\c' },
  { name: 'long string', input: 'x'.repeat(2000) },

  // Arrays
  { name: 'empty array', input: [] },
  { name: 'array with one int', input: [1] },
  { name: 'array of mixed primitives', input: [1, 'a', true, false, null] },
  { name: 'array with undefined (→ null)', input: [1, undefined, 3] },
  { name: 'array with NaN/Infinity (→ null)', input: [1, NaN, Infinity, -Infinity, 2] },
  { name: 'nested arrays', input: [[1, 2], [3, 4], [[5]]] },
  { name: 'array of objects', input: [{ a: 1 }, { b: 2 }] },
  { name: 'sparse array (holes → null)', input: [1, , 3] }, // eslint-disable-line no-sparse-arrays
  { name: 'deeply nested array (50 levels)', input: deepArray },
  { name: 'large array (1000 items)', input: Array.from({ length: 1000 }, (_, i) => i) },

  // Objects
  { name: 'empty object', input: {} },
  { name: 'single-key object', input: { a: 1 } },
  { name: 'multi-key object', input: { a: 1, b: 'two', c: true, d: null } },
  { name: 'object with undefined (key omitted)', input: { a: 1, b: undefined, c: 3 } },
  { name: 'object with NaN/Infinity (→ null)', input: { a: NaN, b: Infinity } },
  { name: 'object with empty string key', input: { '': 'empty' } },
  { name: 'object with quote in key', input: { 'a"b': 1 } },
  { name: 'object with backslash in key', input: { 'a\\b': 1 } },
  { name: 'object with newline in key', input: { 'a\nb': 1 } },
  { name: 'object with unicode key', input: { 你好: 'hi', '🔥': 'fire' } },
  { name: 'object with numeric-looking key', input: { '0': 'z', '1': 'o', '10': 't' } },
  { name: 'deeply nested object (50 levels)', input: deepObject },

  // Combined
  { name: 'real fingerprint payload shape', input: realPayload },
  { name: 'mixed: array of objects of arrays', input: [{ a: [1, 2, { b: [3, 4] }] }] },
  { name: 'object containing every type', input: {
    s: 'str', n: 42, f: 3.14, t: true, fa: false, nu: null,
    un: undefined, na: NaN, inf: Infinity,
    arr: [1, 2, 3], obj: { nested: true }, emp: [], emo: {},
  } },
];

// ─────────────────────────────────────────────────────────────────────
// Layer 1: reference impl correctness
// ─────────────────────────────────────────────────────────────────────

describe('stringify reference impl — round-trip via JSON.parse', () => {
  for (const c of cases) {
    if (c.skipRoundTrip) continue;
    it(c.name, () => {
      const out = stringify(c.input);
      // The walker output must be valid JSON
      const parsed = JSON.parse(out);
      // And must semantically equal what JSON.stringify + JSON.parse would produce.
      const expected = JSON.parse(JSON.stringify(c.input));
      expect(parsed).toEqual(expected);
    });
  }
});

describe('stringify reference impl — top-level divergence cases', () => {
  it('NaN at top level → "null"', () => {
    expect(stringify(NaN)).toBe('null');
  });
  it('Infinity at top level → "null"', () => {
    expect(stringify(Infinity)).toBe('null');
  });
  it('-Infinity at top level → "null"', () => {
    expect(stringify(-Infinity)).toBe('null');
  });
  it('undefined at top level → "null"', () => {
    expect(stringify(undefined)).toBe('null');
  });
});

describe('stringify reference impl — byte-level escape correctness', () => {
  it('escapes all 32 control chars with correct sequences', () => {
    const out = stringify(ctrlChars);
    // Each control char should become an escape sequence; no raw bytes
    // below 0x20 should appear in the output
    for (let i = 0; i < out.length; i += 1) {
      const c = out.charCodeAt(i);
      expect(c).toBeGreaterThanOrEqual(0x20);
    }
    // And the result must be valid JSON that round-trips
    expect(JSON.parse(out)).toBe(ctrlChars);
  });

  it('uses shorthand escapes where defined by the JSON spec', () => {
    expect(stringify('\n')).toBe('"\\n"');
    expect(stringify('\r')).toBe('"\\r"');
    expect(stringify('\t')).toBe('"\\t"');
    expect(stringify('\b')).toBe('"\\b"');
    expect(stringify('\f')).toBe('"\\f"');
    expect(stringify('"')).toBe('"\\""');
    expect(stringify('\\')).toBe('"\\\\"');
  });

  it('uses \\u00XX for non-shorthand control chars', () => {
    expect(stringify('\x00')).toBe('"\\u0000"');
    expect(stringify('\x01')).toBe('"\\u0001"');
    expect(stringify('\x07')).toBe('"\\u0007"'); // bell
    expect(stringify('\x0b')).toBe('"\\u000b"'); // vertical tab
    expect(stringify('\x0e')).toBe('"\\u000e"');
    expect(stringify('\x1f')).toBe('"\\u001f"');
  });

  it('does NOT escape forward slash', () => {
    expect(stringify('a/b')).toBe('"a/b"');
  });

  it('does NOT escape DEL (0x7F)', () => {
    expect(stringify('\x7f')).toBe('"\x7f"');
  });

  it('passes non-ASCII unicode through raw (matches JSON.stringify default)', () => {
    // JSON.stringify does not escape non-ASCII by default
    expect(stringify('你好')).toBe('"你好"');
    expect(stringify('🔥')).toBe('"🔥"');
  });
});

describe('stringify reference impl — object key behaviour', () => {
  it('preserves insertion order for string keys', () => {
     
    const obj: any = {};
    obj.z = 1;
    obj.a = 2;
    obj.m = 3;
    // Our walker uses Object.keys which returns insertion order for string keys
    expect(stringify(obj)).toBe('{"z":1,"a":2,"m":3}');
  });

  it('numeric-looking keys appear in their enumeration order (integer-like first)', () => {
    // Object.keys orders integer-like keys first (ascending), then others in
    // insertion order. Walker inherits this.
     
    const obj: any = {};
    obj.b = 'b';
    obj['10'] = 'ten';
    obj['1'] = 'one';
    obj.a = 'a';
    // '1', '10' first in ascending order, then 'b', 'a'
    expect(stringify(obj)).toBe('{"1":"one","10":"ten","b":"b","a":"a"}');
  });

  it('omits keys with undefined values', () => {
    expect(stringify({ a: 1, b: undefined, c: 2 })).toBe('{"a":1,"c":2}');
  });

  it('keeps keys with null values', () => {
    expect(stringify({ a: 1, b: null, c: 2 })).toBe('{"a":1,"b":null,"c":2}');
  });

  it('emits {} for empty object and [] for empty array', () => {
    expect(stringify({})).toBe('{}');
    expect(stringify([])).toBe('[]');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Layer 2: bytecode execution parity
// ─────────────────────────────────────────────────────────────────────

// vm-src program that exposes stringify via an API_GET.
// R1 (first __api_get call's return) is the test input; the program returns
// stringify(input) in R0. Kept minimal to keep compile/exec fast per test.
const VM_TEST_SRC = `
function hexDigit(n) {
  if (n < 10) { return String.fromCharCode(48 + n); }
  return String.fromCharCode(87 + n);
}

function jsonEscape(s) {
  let out = '"';
  let i = 0;
  while (i < s.length) {
    let c = s.charCodeAt(i);
    if (c === 34) {
      out = out + '\\\\"';
    } else if (c === 92) {
      out = out + '\\\\\\\\';
    } else if (c === 10) {
      out = out + '\\\\n';
    } else if (c === 13) {
      out = out + '\\\\r';
    } else if (c === 9) {
      out = out + '\\\\t';
    } else if (c === 8) {
      out = out + '\\\\b';
    } else if (c === 12) {
      out = out + '\\\\f';
    } else if (c < 16) {
      out = out + '\\\\u000' + hexDigit(c);
    } else if (c < 32) {
      out = out + '\\\\u001' + hexDigit(c - 16);
    } else {
      out = out + String.fromCharCode(c);
    }
    i = i + 1;
  }
  return out + '"';
}

function stringify(v) {
  if (v === null) { return 'null'; }
  let t = typeof v;
  if (t === 'undefined') { return 'null'; }
  if (t === 'string') { return jsonEscape(v); }
  if (t === 'number') {
    if (v * 0 !== 0) { return 'null'; }
    return String(v);
  }
  if (t === 'boolean') {
    if (v) { return 'true'; }
    return 'false';
  }
  if (Array.isArray(v)) {
    let arrOut = '[';
    let ai = 0;
    while (ai < v.length) {
      if (ai > 0) { arrOut = arrOut + ','; }
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
      if (first === 0) { objOut = objOut + ','; }
      objOut = objOut + jsonEscape(k) + ':' + stringify(val);
      first = 0;
    }
    oi = oi + 1;
  }
  return objOut + '}';
}

let input = __api_get(0x01);
let result = stringify(input);
result;
`;

describe('bytecode stringify — parity with reference impl', () => {
  // Compile once, reuse across cases.
  const mod = compile(VM_TEST_SRC);

  // Sample representative cases across the spectrum. The full battery already
  // runs against the reference impl; here we just need enough coverage to catch
  // compiler regressions in the bytecode path.
  const sampled = cases.filter((c) => {
    const names = [
      'null', 'true', 'false', 'zero', 'positive int', 'pi',
      'scientific large', 'float with repeating decimals',
      'NaN (top-level)', 'Infinity (top-level)', 'undefined (top-level)',
      'empty string', 'simple string', 'string with double quote',
      'string with backslash', 'string with newline',
      'string with all control chars 0x00..0x1F',
      'Chinese characters', 'emoji (surrogate pairs)',
      'newline + quote + backslash combo',
      'empty array', 'array of mixed primitives', 'array with undefined (→ null)',
      'nested arrays', 'deeply nested array (50 levels)',
      'empty object', 'multi-key object', 'object with undefined (key omitted)',
      'object with quote in key', 'object with unicode key',
      'deeply nested object (50 levels)', 'real fingerprint payload shape',
      'object containing every type',
    ];
    return names.includes(c.name);
  });

  for (const c of sampled) {
    it(c.name, async () => {
      const bridge = new ApiBridge();
      bridge.register(0x01 as unknown as 0x10, { get: () => c.input });
      const { value } = await executeAsync(mod, bridge);
      expect(value).toBe(stringify(c.input));
    });
  }
});
