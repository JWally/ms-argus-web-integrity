/**
 * VM-only entry point.
 *
 * Exports only the VM execution path — collection runs entirely through
 * the bytecode interpreter. This is what the production bundle looks like
 * to an attacker: no readable JS collection logic, just the VM runtime
 * feeding opaque bytecode.
 */
export { runVmDetection } from './vm/argus-vm';
export type { ArgusVmResult } from './vm/argus-vm';
