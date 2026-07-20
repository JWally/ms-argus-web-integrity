import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const limits = new Map([
  ['src/vm/bridge.ts', 724],
  ['src/utils/sigint.ts', 848],
  ['src/loader/index.ts', 712],
  ['src/index-iframe.ts', 416],
  ['src/transport/integrity-collect-request.ts', 58],
  ['src/transport/integrity-collect-client.ts', 79],
]);

function lineCount(path) {
  const source = readFileSync(
    fileURLToPath(new URL(`../${path}`, import.meta.url)),
    'utf8',
  );
  const lines = source.split('\n').length;
  return source.endsWith('\n') ? lines - 1 : lines;
}

const violations = [];
for (const [path, maximum] of limits) {
  const actual = lineCount(path);
  if (actual > maximum) {
    violations.push(`${path}: ${actual} lines exceeds ratchet ${maximum}`);
  } else {
    process.stdout.write(`${path}: ${actual}/${maximum} lines\n`);
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `Cleanup ratchet failed:\n${violations.map((violation) => `- ${violation}`).join('\n')}\n`,
  );
  process.exitCode = 1;
}
