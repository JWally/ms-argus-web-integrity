/**
 * Roundtrip smoke test: packed VM_BYTECODE → unpack → decode → walk instructions.
 *
 * Historically named "xor" because the only protection was XOR scrambling.
 * The unpack pipeline now also covers salt-based key hiding + time-bucketed
 * descramble (src/vm/unpack.ts) so this test verifies the entire chain.
 */

import { decode } from '../src/vm/decoder';
import { Op, hasOperand } from '../src/vm/opcodes';
import { VM_BYTECODE } from '../src/vm/bytecode-modules';
import { unpack } from '../src/vm/unpack';

async function main() {
const binary = await unpack(VM_BYTECODE);
if (!binary) {
  console.error('ERROR: unpack returned null — blob may be stale for the current bucket');
  process.exit(2);
}

const mod = decode(binary.buffer as ArrayBuffer);
console.log(`Version: ${mod.version}`);
console.log(`Code: ${mod.code.length} instructions`);
console.log(`Has opcodeMap: ${!!mod.opcodeMap}`);
console.log(`ApiTable: ${mod.apiTable.length} entries`);

const rmap = mod.opcodeMap!;
let errors = 0;

for (let pc = 0; pc < mod.code.length; ) {
  const word = mod.code[pc];
  const rawOp = (word >>> 24) & 0xff;
  const canonical = rmap[rawOp];
  const name = Object.entries(Op).find(([, v]) => v === canonical)?.[0];

  if (!name) {
    console.error(`  [${pc}] raw=0x${rawOp.toString(16)} → canonical=0x${canonical.toString(16)} — UNKNOWN`);
    errors++;
    pc++;
    continue;
  }

  const hasOp = hasOperand(canonical);

  if (canonical === Op.API_GET || canonical === Op.API_CALL || canonical === Op.API_CALL_ASYNC) {
    const operand = hasOp ? mod.code[pc + 1] : -1;
    const valid = operand >= 0 && operand < mod.apiTable.length;
    if (!valid) {
      console.error(`  [${pc}] ${name} operand=${operand} OUT OF RANGE (max=${mod.apiTable.length - 1})`);
      errors++;
    }
  }

  pc += hasOp ? 2 : 1;
}

console.log(errors ? `\n${errors} ERRORS` : `\nAll OK — ${mod.code.length} words clean`);
if (errors) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
