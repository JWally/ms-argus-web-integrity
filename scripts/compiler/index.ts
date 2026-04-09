/** JS subset compiler — JavaScript source → BytecodeModule */

import * as acorn from 'acorn';
import type { BytecodeModule } from '../../src/vm/module';
import { VERSION } from '../../src/vm/format';
import { hasOperand } from '../../src/vm/opcodes';
import { CodeGenerator } from './codegen';
import { generateOpcodeMapping } from './opcode-shuffle';

export function compile(source: string): BytecodeModule {
  const ast = acorn.parse(source, {
    ecmaVersion: 2022,
    sourceType: 'script',
  });

  const gen = new CodeGenerator();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gen.compileProgram((ast as any).body);

  const code = gen.getCode();

  // v2+: randomize opcodes in the code section.
  // Only remap instruction words, not operand words (which follow 2-word instructions).
  const mapping = generateOpcodeMapping();
  for (let i = 0; i < code.length; ) {
    const word = code[i];
    const canonicalOp = (word >>> 24) & 0xff;
    const remapped = mapping.forward[canonicalOp];
    code[i] = (word & 0x00ffffff) | (remapped << 24);
    // Skip the operand word if this is a 2-word instruction
    i += hasOperand(canonicalOp) ? 2 : 1;
  }

  return {
    version: VERSION,
    flags: 0,
    strings: gen.pool.getStrings(),
    numbers: gen.pool.getNumbers(),
    apiTable: gen.apiEntries,
    code,
    opcodeMap: mapping.reverse,
  };
}
