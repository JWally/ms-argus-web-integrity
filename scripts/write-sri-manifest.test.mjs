import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicKeyJwk = {
  key_ops: ['verify'],
  ext: true,
  kty: 'EC',
  x: 'IYkp3ntcKTMMB5-J1yVZkGyIRo8CydDDRzY8vT5XX5M',
  y: '8dXgkrrMt5vU901_GSEGJkAO3Gdy5EBMkHI9XzeYuqg',
  crv: 'P-256',
};

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );
  return Buffer.from(padded, 'base64');
}

describe('write-sri-manifest', () => {
  it('emits a signed release manifest for the current loader bytes', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'argus-sri-test-'));
    try {
      for (const file of [
        'argus-bootstrap.v1.iife.js',
        'argus-loader.iife.js',
        'argus-integrity-iframe.iife.js',
        'argus-integrity-worker.iife.js',
        'argus-proxy-loader.iife.js',
        'argus-proxy-iframe.iife.js',
      ]) {
        writeFileSync(join(dist, file), `${file}:test-bytes`);
      }

      execFileSync('node', ['scripts/write-sri-manifest.mjs', dist], {
        cwd: process.cwd(),
        env: { ...process.env, ARGUS_STAGE: 'dev-jw' },
      });

      const sri = JSON.parse(readFileSync(join(dist, 'argus-sri.json'), 'utf8'));
      const release = JSON.parse(
        readFileSync(join(dist, 'argus-manifest.json'), 'utf8'),
      );

      expect(sri.assets['argus-bootstrap.v1.iife.js'].integrity).toMatch(
        /^sha384-/,
      );
      expect(release.payload.loader.url).toBe(
        `https://static-integrity-dev-jw.argus.pw/releases/${release.payload.releaseId}/argus-loader.iife.js`,
      );
      expect(release.payload.loader.integrity).toBe(
        sri.assets['argus-loader.iife.js'].integrity,
      );
      expect(release.payload.releaseId).toMatch(
        /^dev-jw-[A-Za-z0-9_-]{16}$/,
      );
      expect(release.payload.releaseId).not.toMatch(/[+/=]/);
      for (const file of [
        'argus-loader.iife.js',
        'argus-integrity-iframe.iife.js',
        'argus-integrity-worker.iife.js',
      ]) {
        expect(
          existsSync(join(dist, 'releases', release.payload.releaseId, file)),
        ).toBe(true);
      }

      const key = await crypto.subtle.importKey(
        'jwk',
        publicKeyJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      await expect(
        crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          key,
          base64UrlToBytes(release.signature),
          new TextEncoder().encode(JSON.stringify(release.payload)),
        ),
      ).resolves.toBe(true);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
