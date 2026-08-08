import { describe, expect, it } from 'vitest';
import {
  buildProxyPayload,
  readProbeHandshake,
  type ProxyProbeResult,
} from './payload';

describe('proxy_v1 payload', () => {
  it('keeps only network evidence and the lightweight client id', () => {
    const payload = buildProxyPayload({
      sessionId: 'session-1',
      clientUuid: 'client-1',
      webrtc: { iceCandidates: { sigintCandidates: [] } },
      tlsResult: { data: { ip: '203.0.113.5' }, error: null, durationMs: 10 },
      tcpToken: 'tcp-token',
      h2Token: 'h2-token',
    });

    expect(payload).toEqual({
      product: 'proxy_v1',
      identifiers: { session_id: 'session-1' },
      hashes: { stable: 'proxy_v1', fuzzy: 'proxy_v1' },
      device: {
        client_uuid: 'client-1',
        webrtc: { iceCandidates: { sigintCandidates: [] } },
      },
      sigintTls: JSON.stringify({
        data: { ip: '203.0.113.5' },
        error: null,
        durationMs: 10,
      }),
      sigintTcpToken: 'tcp-token',
      sigintH2Token: 'h2-token',
    });
  });

  it('extracts the token and ECDH key from the h2 handshake', () => {
    const body = btoa(JSON.stringify({ vh: 'server-key' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const probe = {
      token: 'h2-token',
      'x-api-version-hash': `x.${body}.y`,
    } as ProxyProbeResult;
    expect(readProbeHandshake(probe)).toEqual({
      token: 'h2-token',
      serverPublicKey: 'server-key',
    });
  });
});
