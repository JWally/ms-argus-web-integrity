/** Bytecode module — in-memory representation of a compiled unit */

export interface ApiEntry {
  apiId: number;
  nameIdx: number;
}

export interface BytecodeModule {
  version: number;
  flags: number;
  strings: string[];
  numbers: number[];
  apiTable: ApiEntry[];
  code: Uint32Array;
  /**
   * v2+: Randomized opcode mapping table (256 bytes).
   * Maps canonical opcode → randomized opcode used in the code section.
   * The interpreter builds a reverse map (randomized → canonical) at load time.
   * Absent in v1 bytecode (interpreter falls back to identity mapping).
   */
  opcodeMap?: Uint8Array;
}
