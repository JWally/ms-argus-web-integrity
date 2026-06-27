#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const source = readFileSync('lib/constructs/static-site.ts', 'utf8');

function fail(message) {
  console.error(`manifest-cors: ${message}`);
  process.exit(1);
}

const jsonBehavior = source.match(/'\*\.json':\s*\{[\s\S]*?\n\s*\}/);
if (!jsonBehavior) {
  fail('missing CloudFront behavior for JSON manifests');
}
if (!jsonBehavior[0].includes('responseHeadersPolicy: corsResponseHeadersPolicy')) {
  fail('JSON manifest behavior must attach CORS response headers');
}
if (!jsonBehavior[0].includes('cachePolicy: htmlCachePolicy')) {
  fail('JSON manifest behavior must avoid long-lived static asset caching');
}

console.log('manifest-cors: ok');
