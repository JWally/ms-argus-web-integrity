/**
 * Opcode randomization — generates a random permutation of the 256-byte opcode space.
 *
 * Returns:
 *   - opcodeMap: canonical → randomized (used by compiler to emit shuffled bytecode)
 *   - reverseMap: randomized → canonical (embedded in bytecode for interpreter)
 *
 * The canonical opcodes (Op.MOV=0x00, Op.ADD=0x30, etc.) get mapped to random
 * positions in the 0-255 space. Each compile produces a different mapping, so
 * static analysis of the bytecode blob is useless across builds.
 */

import * as crypto from 'node:crypto';

export interface OpcodeMapping {
  /** canonical → randomized (256 entries) */
  forward: Uint8Array;
  /** randomized → canonical (256 entries, embedded in bytecode) */
  reverse: Uint8Array;
}

export function generateOpcodeMapping(): OpcodeMapping {
  // Start with identity permutation
  const forward = new Uint8Array(256);
  for (let i = 0; i < 256; i++) forward[i] = i;

  // Fisher-Yates shuffle using crypto random bytes
  const rand = crypto.randomBytes(256);
  for (let i = 255; i > 0; i--) {
    const j = rand[i] % (i + 1);
    const tmp = forward[i];
    forward[i] = forward[j];
    forward[j] = tmp;
  }

  // Build reverse map
  const reverse = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    reverse[forward[i]] = i;
  }

  return { forward, reverse };
}
