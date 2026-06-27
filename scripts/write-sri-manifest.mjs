import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { sriSha384 } from './worker-sri.mjs';
import { readFileSync } from 'node:fs';

const distDir = process.argv[2] || 'dist';
const stage = process.env.ARGUS_STAGE || 'dev-jw';
const isProd = stage === 'prod';
const staticOrigin = isProd
  ? 'https://static-integrity.argus.pw'
  : `https://static-integrity-${stage}.argus.pw`;
const keyId = process.env.ARGUS_MANIFEST_KEY_ID || 'argus-dev-jw-manifest-v1';
const defaultDevPrivateKey = {
  key_ops: ['sign'],
  ext: true,
  kty: 'EC',
  x: 'IYkp3ntcKTMMB5-J1yVZkGyIRo8CydDDRzY8vT5XX5M',
  y: '8dXgkrrMt5vU901_GSEGJkAO3Gdy5EBMkHI9XzeYuqg',
  crv: 'P-256',
  d: 'siqLb8KAkzIipRcQaB0CeRxrplomLWKVutIlMMsq_ds',
};

const files = [
  'argus-bootstrap.v1.iife.js',
  'argus-loader.iife.js',
  'argus-integrity-iframe.iife.js',
  'argus-integrity-worker.iife.js',
];

const manifest = {
  generatedAt: new Date().toISOString(),
  assets: Object.fromEntries(
    files.map((file) => [
      file,
      {
        integrity: sriSha384(readFileSync(join(distDir, file))),
      },
    ]),
  ),
};

writeFileSync(
  join(distDir, 'argus-sri.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

function bytesToBase64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function releaseSlugFromIntegrity(integrity) {
  return integrity
    .replace(/^sha384-/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
    .slice(0, 16);
}

async function signPayload(payload) {
  const privateKeyJwk = process.env.ARGUS_MANIFEST_PRIVATE_JWK
    ? JSON.parse(process.env.ARGUS_MANIFEST_PRIVATE_JWK)
    : defaultDevPrivateKey;

  if (isProd && !process.env.ARGUS_MANIFEST_PRIVATE_JWK) {
    throw new Error('ARGUS_MANIFEST_PRIVATE_JWK is required for prod builds');
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

const now = new Date();
const expiresAt = new Date(now.getTime() + 36 * 60 * 60 * 1000);
const loaderIntegrity = manifest.assets['argus-loader.iife.js'].integrity;
const releaseId = `${stage}-${releaseSlugFromIntegrity(loaderIntegrity)}`;
const releasePath = `releases/${releaseId}`;
const releaseDir = join(distDir, releasePath);
mkdirSync(releaseDir, { recursive: true });
for (const file of [
  'argus-loader.iife.js',
  'argus-integrity-iframe.iife.js',
  'argus-integrity-worker.iife.js',
]) {
  cpSync(join(distDir, file), join(releaseDir, file));
}

const releasePayload = {
  v: 1,
  keyId,
  releaseId,
  environment: stage,
  allowedOrigins: [staticOrigin],
  notBefore: now.toISOString(),
  expiresAt: expiresAt.toISOString(),
  loader: {
    url: `${staticOrigin}/${releasePath}/argus-loader.iife.js`,
    integrity: loaderIntegrity,
  },
};

writeFileSync(
  join(distDir, 'argus-manifest.json'),
  `${JSON.stringify(
    {
      payload: releasePayload,
      signature: await signPayload(releasePayload),
    },
    null,
    2,
  )}\n`,
);
