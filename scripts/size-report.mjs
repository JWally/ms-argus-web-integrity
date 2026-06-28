#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';

const NORMAL_PATH = [
  'dist/argus-bootstrap.v1.iife.js',
  'dist/argus-loader.iife.js',
  'dist/argus-integrity-iframe.iife.js',
  'dist/argus-integrity-worker.iife.js',
];

const fmt = (n) => n.toLocaleString('en-US');

let totalRaw = 0;
let totalGzip = 0;

console.log('| Artifact | Raw bytes | Gzip bytes |');
console.log('|---|---:|---:|');

for (const file of NORMAL_PATH) {
  const raw = statSync(file).size;
  const gzip = gzipSync(readFileSync(file)).length;
  totalRaw += raw;
  totalGzip += gzip;
  console.log(`| \`${file.replace('dist/', '')}\` | ${fmt(raw)} | ${fmt(gzip)} |`);
}

console.log(`| **Normal path total** | **${fmt(totalRaw)}** | **${fmt(totalGzip)}** |`);
