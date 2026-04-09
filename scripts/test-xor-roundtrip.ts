import { decode } from '../src/vm/decoder';
import { Op, hasOperand } from '../src/vm/opcodes';
import { VM_BYTECODE, VM_KEY } from '../src/vm/bytecode-modules';

// Decode exactly as the browser does: base64 → XOR descramble → decode
const scrambled = Uint8Array.from(atob(VM_BYTECODE), c => c.charCodeAt(0));
const key = Uint8Array.from(VM_KEY.match(/../g)!.map(h => parseInt(h, 16)));
const binary = new Uint8Array(scrambled.length);
for (let i = 0; i < scrambled.length; i++) binary[i] = scrambled[i] ^ key[i % key.length];

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
