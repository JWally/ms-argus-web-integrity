import { describe, expect, it } from 'vitest';

import { sriSha384 } from './worker-sri.mjs';

describe('worker SRI helper', () => {
  it('returns a sha384 SRI token for bundle bytes', () => {
    expect(sriSha384('worker bytes\n')).toBe(
      'sha384-2TOowx975qnE9B16ub3ekMddCa3uAoin47iC8E5R0S/LCZ/3VZFhN5aXOkNWM1oF',
    );
  });
});
