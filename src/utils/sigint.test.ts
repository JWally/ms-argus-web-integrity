import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  collectSigintData,
  fetchTlsFingerprint,
  fetchTcpProbe,
  fetchH2Probe,
  performStunBinding,
  parseSigintConfigFromUrl,
  getTlsFingerprintEndpoint,
  getTcpProbeEndpoint,
  getH2ProbeEndpoint,
  getStunServerUri,
  getProxyScore,
  getTlsHash,
  getThirdPartyCookieId,
  getH2Fingerprint,
  type SigintConfig,
  type SigintData,
  type EncryptedProbeResponse,
} from './sigint';

describe('sigint URL builders', () => {
  it('builds TLS fingerprint endpoint with default config', () => {
    const config: SigintConfig = { baseDomain: 'argus.pw' };
    const url = getTlsFingerprintEndpoint(config);
    expect(url).toBe('https://id.argus.pw/');
  });

  it('builds TLS fingerprint endpoint with stage prefix', () => {
    const config: SigintConfig = { baseDomain: 'argus.pw', stagePrefix: 'qa-' };
    const url = getTlsFingerprintEndpoint(config);
    expect(url).toBe('https://qa-id.argus.pw/');
  });

  it('builds TCP probe endpoint with default config', () => {
    const config: SigintConfig = { baseDomain: 'argus.pw' };
    const url = getTcpProbeEndpoint(config);
    expect(url).toBe('https://tcp-probe.argus.pw/');
  });

  it('builds TCP probe endpoint with stage prefix', () => {
    const config: SigintConfig = {
      baseDomain: 'argus.pw',
      stagePrefix: 'uat-',
    };
    const url = getTcpProbeEndpoint(config);
    expect(url).toBe('https://uat-tcp-probe.argus.pw/');
  });

  it('builds H2 probe endpoint with default config', () => {
    const config: SigintConfig = { baseDomain: 'argus.pw' };
    const url = getH2ProbeEndpoint(config);
    expect(url).toBe('https://h2.argus.pw/');
  });

  it('builds H2 probe endpoint with stage prefix', () => {
    const config: SigintConfig = {
      baseDomain: 'argus.pw',
      stagePrefix: 'dev-jw-',
    };
    const url = getH2ProbeEndpoint(config);
    expect(url).toBe('https://dev-jw-h2.argus.pw/');
  });

  it('builds STUN server URI with default config', () => {
    const config: SigintConfig = { baseDomain: 'argus.pw' };
    const uri = getStunServerUri(config);
    expect(uri).toBe('stun:stun.argus.pw:3478');
  });

  it('builds STUN server URI with stage prefix', () => {
    const config: SigintConfig = { baseDomain: 'argus.pw', stagePrefix: 'qa-' };
    const uri = getStunServerUri(config);
    expect(uri).toBe('stun:qa-stun.argus.pw:3478');
  });
});

describe('parseSigintConfigFromUrl', () => {
  it('parses sigintDomain from URL', () => {
    const url = new URL('https://example.com/script.js?sigintDomain=custom.io');
    const config = parseSigintConfigFromUrl(url);
    expect(config.baseDomain).toBe('custom.io');
  });

  it('parses sigintStage from URL', () => {
    const url = new URL('https://example.com/script.js?sigintStage=qa-');
    const config = parseSigintConfigFromUrl(url);
    expect(config.stagePrefix).toBe('qa-');
  });

  it('parses empty stage prefix', () => {
    const url = new URL('https://example.com/script.js?sigintStage=');
    const config = parseSigintConfigFromUrl(url);
    expect(config.stagePrefix).toBe('');
  });

  it('parses sigintTimeout from URL', () => {
    const url = new URL('https://example.com/script.js?sigintTimeout=3000');
    const config = parseSigintConfigFromUrl(url);
    expect(config.timeout).toBe(3000);
  });

  it('parses sigintCookie=false from URL', () => {
    const url = new URL('https://example.com/script.js?sigintCookie=false');
    const config = parseSigintConfigFromUrl(url);
    expect(config.enableCookie).toBe(false);
  });

  it('parses sigintCookie=true from URL', () => {
    const url = new URL('https://example.com/script.js?sigintCookie=true');
    const config = parseSigintConfigFromUrl(url);
    expect(config.enableCookie).toBe(true);
  });

  it('parses sigintTcpProbe=false from URL', () => {
    const url = new URL('https://example.com/script.js?sigintTcpProbe=false');
    const config = parseSigintConfigFromUrl(url);
    expect(config.enableTcpProbe).toBe(false);
  });

  it('parses sigintH2Probe=false from URL', () => {
    const url = new URL('https://example.com/script.js?sigintH2Probe=false');
    const config = parseSigintConfigFromUrl(url);
    expect(config.enableH2Probe).toBe(false);
  });

  it('parses sigintStun=true from URL', () => {
    const url = new URL('https://example.com/script.js?sigintStun=true');
    const config = parseSigintConfigFromUrl(url);
    expect(config.enableStun).toBe(true);
  });

  it('parses multiple params from URL', () => {
    const url = new URL(
      'https://example.com/script.js?sigintDomain=foo.io&sigintStage=uat-&sigintTimeout=8000&sigintStun=true',
    );
    const config = parseSigintConfigFromUrl(url);
    expect(config.baseDomain).toBe('foo.io');
    expect(config.stagePrefix).toBe('uat-');
    expect(config.timeout).toBe(8000);
    expect(config.enableStun).toBe(true);
  });

  it('works with string URL', () => {
    const config = parseSigintConfigFromUrl(
      'https://example.com/script.js?sigintDomain=test.io',
    );
    expect(config.baseDomain).toBe('test.io');
  });
});

describe('helper functions', () => {
  describe('getProxyScore', () => {
    it('returns 0 when no tcp probe data', () => {
      const data: SigintData = {
        tlsFingerprint: null,
        tcpProbe: null,
        h2Probe: null,
        stun: null,
        faviconCache: null,
        timing: {
          tlsFingerprintMs: null,
          tcpProbeMs: null,
          h2ProbeMs: null,
          stunMs: null,
          faviconCacheMs: null,
          totalMs: 100,
        },
        errors: [],
      };
      expect(getProxyScore(data)).toBe(0);
    });

    it('returns 0 when no rtt fingerprint', () => {
      const data: SigintData = {
        tlsFingerprint: null,
        tcpProbe: {
          tcp_info: null,
          rtt_fingerprint: null,
          http2_fingerprint: null,
          client_hints: null,
          user_agent: 'test',
          client_ip: '1.2.3.4',
          domain: 'test.io',
        },
        h2Probe: null,
        stun: null,
        faviconCache: null,
        timing: {
          tlsFingerprintMs: null,
          tcpProbeMs: 100,
          h2ProbeMs: null,
          stunMs: null,
          faviconCacheMs: null,
          totalMs: 100,
        },
        errors: [],
      };
      expect(getProxyScore(data)).toBe(0);
    });

    it('returns max of proxy and vpn score', () => {
      const data: SigintData = {
        tlsFingerprint: null,
        tcpProbe: {
          tcp_info: null,
          rtt_fingerprint: {
            tcp_rtt_us: 10000,
            tls_handshake_us: 50000,
            http_first_byte_us: 5000,
            total_connection_us: 65000,
            snd_mss: 1400,
            pmtu: 1500,
            tls_to_tcp_ratio: 5.0,
            total_to_tcp_ratio: 6.5,
            proxy_score: 0.3,
            vpn_score: 0.6,
            proxy_signals: ['elevated_tls_ratio:5.0'],
          },
          http2_fingerprint: null,
          client_hints: null,
          user_agent: 'test',
          client_ip: '1.2.3.4',
          domain: 'test.io',
        },
        h2Probe: null,
        stun: null,
        faviconCache: null,
        timing: {
          tlsFingerprintMs: null,
          tcpProbeMs: 100,
          h2ProbeMs: null,
          stunMs: null,
          faviconCacheMs: null,
          totalMs: 100,
        },
        errors: [],
      };
      expect(getProxyScore(data)).toBe(0.6);
    });
  });

  describe('getTlsHash', () => {
    it('returns null when no tls fingerprint', () => {
      const data: SigintData = {
        tlsFingerprint: null,
        tcpProbe: null,
        h2Probe: null,
        stun: null,
        faviconCache: null,
        timing: {
          tlsFingerprintMs: null,
          tcpProbeMs: null,
          h2ProbeMs: null,
          stunMs: null,
          faviconCacheMs: null,
          totalMs: 100,
        },
        errors: [],
      };
      expect(getTlsHash(data)).toBe(null);
    });

    it('prefers JA4 over JA3', () => {
      const data: SigintData = {
        tlsFingerprint: {
          id: 'test-id',
          new: false,
          ip: '1.2.3.4',
          asn: '12345',
          country: 'US',
          ja3: 'ja3-hash',
          ja4: 'ja4-hash',
        },
        tcpProbe: null,
        h2Probe: null,
        stun: null,
        faviconCache: null,
        timing: {
          tlsFingerprintMs: 50,
          tcpProbeMs: null,
          h2ProbeMs: null,
          stunMs: null,
          faviconCacheMs: null,
          totalMs: 100,
        },
        errors: [],
      };
      expect(getTlsHash(data)).toBe('ja4-hash');
    });

    it('falls back to JA3 when no JA4', () => {
      const data: SigintData = {
        tlsFingerprint: {
          id: 'test-id',
          new: false,
          ip: '1.2.3.4',
          asn: '12345',
          country: 'US',
          ja3: 'ja3-hash',
          ja4: null,
        },
        tcpProbe: null,
        h2Probe: null,
        stun: null,
        faviconCache: null,
        timing: {
          tlsFingerprintMs: 50,
          tcpProbeMs: null,
          h2ProbeMs: null,
          stunMs: null,
          faviconCacheMs: null,
          totalMs: 100,
        },
        errors: [],
      };
      expect(getTlsHash(data)).toBe('ja3-hash');
    });
  });

  describe('getThirdPartyCookieId', () => {
    it('returns null when no tls fingerprint', () => {
      const data: SigintData = {
        tlsFingerprint: null,
        tcpProbe: null,
        h2Probe: null,
        stun: null,
        faviconCache: null,
        timing: {
          tlsFingerprintMs: null,
          tcpProbeMs: null,
          h2ProbeMs: null,
          stunMs: null,
          faviconCacheMs: null,
          totalMs: 100,
        },
        errors: [],
      };
      expect(getThirdPartyCookieId(data)).toBe(null);
    });

    it('returns cookie ID when available', () => {
      const data: SigintData = {
        tlsFingerprint: {
          id: 'cookie-uuid-12345',
          new: false,
          ip: '1.2.3.4',
          asn: '12345',
          country: 'US',
          ja3: 'ja3-hash',
          ja4: 'ja4-hash',
        },
        tcpProbe: null,
        h2Probe: null,
        stun: null,
        faviconCache: null,
        timing: {
          tlsFingerprintMs: 50,
          tcpProbeMs: null,
          h2ProbeMs: null,
          stunMs: null,
          faviconCacheMs: null,
          totalMs: 100,
        },
        errors: [],
      };
      expect(getThirdPartyCookieId(data)).toBe('cookie-uuid-12345');
    });
  });

  describe('getH2Fingerprint', () => {
    it('returns null when no h2 probe data', () => {
      const data: SigintData = {
        tlsFingerprint: null,
        tcpProbe: null,
        h2Probe: null,
        stun: null,
        faviconCache: null,
        timing: {
          tlsFingerprintMs: null,
          tcpProbeMs: null,
          h2ProbeMs: null,
          stunMs: null,
          faviconCacheMs: null,
          totalMs: 100,
        },
        errors: [],
      };
      expect(getH2Fingerprint(data)).toBe(null);
    });

    it('returns fingerprint when h2 probe data available', () => {
      const data: SigintData = {
        tlsFingerprint: null,
        tcpProbe: null,
        h2Probe: {
          h2_fingerprint: {
            settings_order: [
              'MAX_CONCURRENT_STREAMS:100',
              'INITIAL_WINDOW_SIZE:10485760',
            ],
            fingerprint: '100,10485760|1048510465|0',
            protocol: 'h2',
          },
          client_ip: '1.2.3.4',
          domain: 'test.io',
        },
        stun: null,
        faviconCache: null,
        timing: {
          tlsFingerprintMs: null,
          tcpProbeMs: null,
          h2ProbeMs: 50,
          stunMs: null,
          faviconCacheMs: null,
          totalMs: 100,
        },
        errors: [],
      };
      expect(getH2Fingerprint(data)).toBe('100,10485760|1048510465|0');
    });
  });
});

describe('collectSigintData', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns empty data when all endpoints disabled', async () => {
    const config: SigintConfig = {
      baseDomain: 'test.io',
      enableCookie: false,
      enableTcpProbe: false,
      enableH2Probe: false,
      enableStun: false,
      enableFaviconCache: false,
    };

    const result = await collectSigintData(config);

    expect(result.tlsFingerprint).toBe(null);
    expect(result.tcpProbe).toBe(null);
    expect(result.h2Probe).toBe(null);
    expect(result.stun).toBe(null);
    expect(result.errors).toHaveLength(0);
  });

  it('handles fetch errors gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);

    const config: SigintConfig = {
      baseDomain: 'test.io',
      enableCookie: true,
      enableTcpProbe: true,
      enableH2Probe: true,
      enableStun: false,
      enableFaviconCache: false,
      timeout: 1000,
    };

    const result = await collectSigintData(config);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('Network error'))).toBe(true);
  });

  it('handles successful TLS fingerprint response', async () => {
    const mockResponse = {
      id: 'test-uuid',
      new: false,
      ip: '1.2.3.4',
      asn: '12345',
      country: 'US',
      ja3: 'ja3-hash',
      ja4: 'ja4-hash',
    };

    // id endpoint returns text/plain: base64(json).signature_hex
    const signedPayload =
      btoa(JSON.stringify(mockResponse)) + '.deadbeefcafe0000';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(signedPayload),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: SigintConfig = {
      baseDomain: 'test.io',
      enableCookie: true,
      enableTcpProbe: false,
      enableH2Probe: false,
      enableStun: false,
      enableFaviconCache: false,
      timeout: 1000,
    };

    const result = await collectSigintData(config);

    expect(result.tlsFingerprint).toEqual(mockResponse);
    expect(result.timing.tlsFingerprintMs).toBeDefined();
    expect(result.errors).toHaveLength(0);
  });

  it('records timing for all requests', async () => {
    // Mock TCP probe response with valid rtt_fingerprint for median calculation
    const mockTcpProbeResponse = {
      tcp_info: { rtt: 40000 },
      rtt_fingerprint: {
        tcp_rtt_us: 40000,
        tls_handshake_us: 42000,
        http_first_byte_us: 1000,
        total_connection_us: 50000,
        snd_mss: 1448,
        pmtu: 9001,
        tls_to_tcp_ratio: 1.05,
        total_to_tcp_ratio: 1.25,
        proxy_score: 0,
        vpn_score: 0,
        proxy_signals: ['none'],
      },
      http2_fingerprint: null,
      client_hints: null,
      user_agent: 'test',
      client_ip: '1.2.3.4',
      domain: 'test.io',
    };

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      // Return TCP probe response for tcp-probe URLs, generic for others
      if (url.includes('tcp-probe')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTcpProbeResponse),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 'test' }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: SigintConfig = {
      baseDomain: 'test.io',
      enableCookie: true,
      enableTcpProbe: true,
      enableH2Probe: true,
      enableStun: false,
      enableFaviconCache: false,
      timeout: 1000,
    };

    const result = await collectSigintData(config);

    expect(result.timing.totalMs).toBeGreaterThan(0);
  });
});

describe('performStunBinding', () => {
  it('returns error when RTCPeerConnection not available', async () => {
    // In test environment, RTCPeerConnection is not available
    const config: SigintConfig = { baseDomain: 'test.io' };
    const result = await performStunBinding(config);

    // Should handle gracefully
    expect(result.error).toContain('WebRTC not available');
    expect(result.data).toBe(null);
  });
});

describe('fetchTcpProbe median calculation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns median ratio from multiple requests', async () => {
    // Create responses with varying ratios
    // Sorted: [1.0, 1.05, 1.1, 5.0, 15.0] -> median is 1.1 (middle value)
    const ratios = [1.0, 5.0, 1.1, 15.0, 1.05];
    let callIndex = 0;

    const mockFetch = vi.fn().mockImplementation(() => {
      const ratio = ratios[callIndex % ratios.length];
      callIndex++;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            tcp_info: { rtt: 40000 },
            rtt_fingerprint: {
              tcp_rtt_us: 40000,
              tls_handshake_us: Math.round(40000 * ratio),
              http_first_byte_us: 1000,
              total_connection_us: 50000,
              snd_mss: 1448,
              pmtu: 9001,
              tls_to_tcp_ratio: ratio,
              total_to_tcp_ratio: 1.25,
              proxy_score: ratio > 2 ? 0.5 : 0,
              vpn_score: 0,
              proxy_signals: ratio > 2 ? ['elevated_tls_ratio'] : ['none'],
            },
            http2_fingerprint: null,
            client_hints: null,
            user_agent: 'test',
            client_ip: '1.2.3.4',
            domain: 'test.io',
          }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: SigintConfig = { baseDomain: 'test.io', timeout: 1000 };
    const result = await fetchTcpProbe(config);

    // Should make 5 requests
    expect(mockFetch).toHaveBeenCalledTimes(5);

    // Should return the response closest to median (1.1)
    // Sorted ratios: [1.0, 1.05, 1.1, 5.0, 15.0] -> median = 1.1
    expect(result.data).not.toBe(null);
    const tcpData = result.data as import('./sigint').TcpProbeResponse;
    expect(tcpData?.rtt_fingerprint?.tls_to_tcp_ratio).toBe(1.1);
    expect(result.error).toBe(null);
  });

  it('handles all requests failing', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);

    const config: SigintConfig = { baseDomain: 'test.io', timeout: 1000 };
    const result = await fetchTcpProbe(config);

    expect(result.data).toBe(null);
    expect(result.error).toContain('Network error');
  });

  it('handles partial failures gracefully', async () => {
    let callIndex = 0;

    const mockFetch = vi.fn().mockImplementation(() => {
      callIndex++;
      // First 2 requests fail, last 3 succeed
      if (callIndex <= 2) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            tcp_info: { rtt: 40000 },
            rtt_fingerprint: {
              tcp_rtt_us: 40000,
              tls_handshake_us: 42000,
              http_first_byte_us: 1000,
              total_connection_us: 50000,
              snd_mss: 1448,
              pmtu: 9001,
              tls_to_tcp_ratio: 1.05,
              total_to_tcp_ratio: 1.25,
              proxy_score: 0,
              vpn_score: 0,
              proxy_signals: ['none'],
            },
            http2_fingerprint: null,
            client_hints: null,
            user_agent: 'test',
            client_ip: '1.2.3.4',
            domain: 'test.io',
          }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: SigintConfig = { baseDomain: 'test.io', timeout: 1000 };
    const result = await fetchTcpProbe(config);

    // Should still succeed with 3 valid responses
    expect(result.data).not.toBe(null);
    expect(result.error).toBe(null);
  });

  it('passes through encrypted response without validation', async () => {
    const encryptedBlob: EncryptedProbeResponse = {
      v: 1,
      data: 'base64ciphertext==',
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(encryptedBlob),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: SigintConfig = { baseDomain: 'test.io', timeout: 1000 };
    const result = await fetchTcpProbe(config);

    expect(result.data).toEqual(encryptedBlob);
    expect(result.error).toBe(null);
  });

  it('returns encrypted response even when some requests fail', async () => {
    const encryptedBlob: EncryptedProbeResponse = { v: 1, data: 'abc==' };
    let callIndex = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return Promise.reject(new Error('fail'));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(encryptedBlob),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: SigintConfig = { baseDomain: 'test.io', timeout: 1000 };
    const result = await fetchTcpProbe(config);

    expect(result.data).toEqual(encryptedBlob);
    expect(result.error).toBe(null);
  });
});

describe('fetchH2Probe — encrypted responses', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes through encrypted h2 response as-is', async () => {
    const encryptedBlob: EncryptedProbeResponse = {
      v: 1,
      data: 'h2ciphertext==',
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(encryptedBlob),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: SigintConfig = { baseDomain: 'test.io', timeout: 1000 };
    const result = await fetchH2Probe(config);

    expect(result.data).toEqual(encryptedBlob);
    expect(result.error).toBe(null);
  });
});

describe('getProxyScore — encrypted probe', () => {
  const baseData: SigintData = {
    tlsFingerprint: null,
    tcpProbe: null,
    h2Probe: null,
    stun: null,
    faviconCache: null,
    timing: {
      tlsFingerprintMs: null,
      tcpProbeMs: null,
      h2ProbeMs: null,
      stunMs: null,
      faviconCacheMs: null,
      totalMs: 0,
    },
    errors: [],
  };

  it('returns 0 when tcpProbe is an encrypted blob', () => {
    const data: SigintData = {
      ...baseData,
      tcpProbe: { v: 1, data: 'encrypted==' },
    };
    expect(getProxyScore(data)).toBe(0);
  });
});

describe('getH2Fingerprint — encrypted probe', () => {
  const baseData: SigintData = {
    tlsFingerprint: null,
    tcpProbe: null,
    h2Probe: null,
    stun: null,
    faviconCache: null,
    timing: {
      tlsFingerprintMs: null,
      tcpProbeMs: null,
      h2ProbeMs: null,
      stunMs: null,
      faviconCacheMs: null,
      totalMs: 0,
    },
    errors: [],
  };

  it('returns null when h2Probe is an encrypted blob', () => {
    const data: SigintData = {
      ...baseData,
      h2Probe: { v: 1, data: 'encrypted==' },
    };
    expect(getH2Fingerprint(data)).toBe(null);
  });
});
