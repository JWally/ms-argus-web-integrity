import { describe, expect, it } from 'vitest';
import contract from '../../contracts/integrity-collect/v1/transport.json';
import {
  buildIntegrityCollectRequest,
  INTEGRITY_TRANSPORT_VERSION,
} from './integrity-collect-request';

const endpoint = `https://api.example.test${contract.path}`;

describe('integrity collect request contract', () => {
  it('emits the provider contract current version and required envelope', () => {
    const encrypted = Uint8Array.from([1, 2, 3, 4]);

    const request = buildIntegrityCollectRequest({
      endpoint,
      encrypted,
      clientPublicKey: 'client-public-key',
      sessionToken: 'session-token',
      cpi: 'argus_cpi_test_contract12345',
    });

    expect(INTEGRITY_TRANSPORT_VERSION).toBe(contract.current_client_version);
    expect(request.url).toBe(endpoint);
    expect(request.init.method).toBe(contract.method);
    expect(request.init.credentials).toBe('include');
    expect(request.init.headers).toMatchObject({
      'Content-Type': contract.content_type,
      'X-Argus-Origin': 'client-public-key',
      'X-Argus-Session': 'session-token',
      'X-Argus-V': contract.current_client_version,
      'X-Argus-Cpi': 'argus_cpi_test_contract12345',
    });
    expect(
      contract.required_headers.every(
        (header) => header in request.init.headers,
      ),
    ).toBe(true);
    expect(Array.from(new Uint8Array(request.init.body))).toEqual([1, 2, 3, 4]);
  });

  it('omits the optional CPI header when no CPI is bound', () => {
    const request = buildIntegrityCollectRequest({
      endpoint,
      encrypted: Uint8Array.from([5]),
      clientPublicKey: 'client-public-key',
      sessionToken: 'session-token',
      cpi: null,
    });

    expect(request.init.headers).not.toHaveProperty('X-Argus-Cpi');
  });

  it('copies only the encrypted view instead of its entire backing buffer', () => {
    const backing = Uint8Array.from([99, 1, 2, 3, 88]);

    const request = buildIntegrityCollectRequest({
      endpoint,
      encrypted: backing.subarray(1, 4),
      clientPublicKey: 'client-public-key',
      sessionToken: 'session-token',
      cpi: null,
    });

    expect(Array.from(new Uint8Array(request.init.body))).toEqual([1, 2, 3]);
  });

  it.each([
    ['client public key', { clientPublicKey: '' }],
    ['session token', { sessionToken: '' }],
  ])('rejects a missing %s before fetch', (_name, override) => {
    expect(() =>
      buildIntegrityCollectRequest({
        endpoint,
        encrypted: Uint8Array.from([1]),
        clientPublicKey: 'client-public-key',
        sessionToken: 'session-token',
        cpi: null,
        ...override,
      }),
    ).toThrow(/required/i);
  });
});
