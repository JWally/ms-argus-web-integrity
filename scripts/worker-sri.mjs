import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function sriSha384(bytes) {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/worker-sri.mjs <worker-bundle>');
    process.exit(2);
  }
  process.stdout.write(sriSha384(readFileSync(file)));
}
