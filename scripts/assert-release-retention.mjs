#!/usr/bin/env node
import { readFileSync } from 'node:fs';

function fail(message) {
  console.error(`release-retention: ${message}`);
  process.exit(1);
}

const staticSite = readFileSync('lib/constructs/static-site.ts', 'utf8');
const sdkRefresh = readFileSync('lib/constructs/sdk-refresh.ts', 'utf8');

if (!staticSite.includes('prune: false')) {
  fail('BucketDeployment must keep older release directories');
}
if (sdkRefresh.includes('aws s3 sync dist/') && sdkRefresh.includes('--delete')) {
  fail('nightly SDK refresh must not delete older release directories');
}

console.log('release-retention: ok');
