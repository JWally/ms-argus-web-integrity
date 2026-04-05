/**
 * Zod schemas for dev-time validation (only imported in tests)
 */

import { z } from 'zod';

const IdentifiersSchema = z.object({
  session_id: z.string(),
  evercookie_id: z.string().optional(),
  public_key: z.string().optional(),
});

const HashesSchema = z
  .object({
    stable: z.string(),
    fuzzy: z.string(),
  })
  .catchall(z.string());

const DeviceSchema = z.record(z.unknown());

const SigintSchema = z.record(z.unknown()).optional();

export const PayloadSchema = z.object({
  identifiers: IdentifiersSchema,
  hashes: HashesSchema,
  device: DeviceSchema,
  sigint: SigintSchema,
});
