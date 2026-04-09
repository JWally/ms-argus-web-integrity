/**
 * Test VM compile → encode → decode → execute roundtrip with opcode randomization.
 */
import * as fs from 'fs';
import { compile } from './compiler/index';
import { encode } from './compiler/encoder';
import { decode } from '../src/vm/decoder';
import { Op, hasOperand } from '../src/vm/opcodes';

const src = fs.readFileSync('scripts/vm-src/main.ts', 'utf-8')
  .replace("'__DEPLOY_SECRET__'", "'test_secret'");

const mod = compile(src);
console.log(`Compiled: ${mod.code.length} instructions`);

const binary = encode(mod);
console.log(`Encoded: ${binary.byteLength} bytes`);

const decoded = decode(binary);
console.log(`Decoded: version=${decoded.version}, code=${decoded.code.length}, opcodeMap=${!!decoded.opcodeMap}`);

// Verify all instructions can be de-randomized
const rmap = decoded.opcodeMap!;
let errors = 0;

for (let pc = 0; pc < decoded.code.length; ) {
  const word = decoded.code[pc];
  const rawOp = (word >>> 24) & 0xff;
  const canonical = rmap[rawOp];
  const name = Object.entries(Op).find(([, v]) => v === canonical)?.[0];

  if (!name) {
    console.error(`  [${pc}] raw=0x${rawOp.toString(16)} → canonical=0x${canonical.toString(16)} — UNKNOWN OPCODE`);
    errors++;
    pc++;
    continue;
  }

  const hasOp = hasOperand(canonical);
  pc += hasOp ? 2 : 1;
}

if (errors) {
  console.error(`\n${errors} unknown opcodes found!`);
  process.exit(1);
} else {
  console.log(`All ${decoded.code.length} instruction words decoded successfully`);
}
