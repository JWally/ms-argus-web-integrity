import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { sriSha384 } from './worker-sri.mjs';
import { readFileSync } from 'node:fs';

const distDir = process.argv[2] || 'dist';

const files = [
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
