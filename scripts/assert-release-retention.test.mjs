import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('release retention guard', () => {
  it('keeps old immutable release assets available across rotations', () => {
    expect(() =>
      execFileSync('node', ['scripts/assert-release-retention.mjs'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
