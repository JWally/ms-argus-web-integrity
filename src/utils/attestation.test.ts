import { describe, expect, it } from 'vitest';
import { buildEnvelope } from './attestation';

function decodeEnvelope(envelope: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(envelope, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}

describe('buildEnvelope', () => {
  it('signs the exact Argus scan id alongside caller payload', () => {
    const { envelope } = buildEnvelope(
      {
        purpose: 'argus-pair-v1',
        payload: { role: 'host', challengeId: 'checkout-1' },
        ttlSeconds: 120,
      },
      'device-key-1',
      1_700_000_000,
      'argus-scan-1',
    );

    expect(decodeEnvelope(envelope)).toMatchObject({
      v: 1,
      purpose: 'argus-pair-v1',
      payload: { role: 'host', challengeId: 'checkout-1' },
      scanSessionId: 'argus-scan-1',
      iat: 1_700_000_000,
      exp: 1_700_000_120,
      keyId: 'device-key-1',
    });
  });

  it('omits scan binding only for legacy callers that do not have a scan id', () => {
    const { envelope } = buildEnvelope(
      { purpose: 'merchant-assertion-v1', payload: { orderId: 'order-1' } },
      'device-key-1',
      1_700_000_000,
    );

    expect(decodeEnvelope(envelope)).not.toHaveProperty('scanSessionId');
  });
});
