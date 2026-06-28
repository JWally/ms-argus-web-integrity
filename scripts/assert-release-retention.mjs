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
if (!staticSite.includes("prefix: 'releases/'")) {
  fail('S3 lifecycle must target immutable release directories');
}
if (!staticSite.includes('releaseRetention ?? Duration.days(14)')) {
  fail('release directories must have an explicit default TTL');
}
if (sdkRefresh.includes('aws s3 sync dist/') && sdkRefresh.includes('--delete')) {
  fail('nightly SDK refresh must not delete older release directories');
}
if (staticSite.includes("distributionPaths: ['/*']")) {
  fail('CDK deploy must not invalidate every CloudFront path');
}
if (sdkRefresh.includes('--paths "/*"')) {
  fail('nightly SDK refresh must not invalidate every CloudFront path');
}
if (!staticSite.includes("'/argus-manifest.json'")) {
  fail('CDK deploy must invalidate the signed manifest');
}
if (!sdkRefresh.includes('"/argus-manifest.json"')) {
  fail('nightly SDK refresh must invalidate the signed manifest');
}

console.log('release-retention: ok');
