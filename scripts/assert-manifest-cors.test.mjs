import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('manifest CORS guard', () => {
  it('keeps JSON manifests fetchable by the bootstrap', () => {
    expect(() =>
      execFileSync('node', ['scripts/assert-manifest-cors.mjs'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
