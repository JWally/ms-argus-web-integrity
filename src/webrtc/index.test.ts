import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_STUN_SERVERS,
  getStunServers,
  setCustomStunServers,
  clearCustomStunServers,
  KNOWN_FOUNDATIONS,
  ICE_GATHER_TIMEOUT,
} from './constants';

describe('webrtc constants', () => {
  describe('DEFAULT_STUN_SERVERS', () => {
    it('points at the argus sigint STUN server', () => {
      expect(DEFAULT_STUN_SERVERS).toBeInstanceOf(Array);
      expect(DEFAULT_STUN_SERVERS.length).toBeGreaterThan(0);
      DEFAULT_STUN_SERVERS.forEach((server) => {
        expect(server).toMatch(/^stun:/);
        expect(server).toContain('argus.pw');
      });
    });
  });

  describe('custom STUN servers', () => {
    afterEach(() => {
      clearCustomStunServers();
    });

    it('uses default STUN servers by default', () => {
      expect(getStunServers()).toEqual(DEFAULT_STUN_SERVERS);
    });

    it('uses custom STUN servers when set', () => {
      const customServers = ['stun:stun.example.com:3478'];
      setCustomStunServers(customServers);
      expect(getStunServers()).toEqual(customServers);
    });

    it('reverts to defaults after clearing custom servers', () => {
      setCustomStunServers(['stun:custom.io:3478']);
      clearCustomStunServers();
      expect(getStunServers()).toEqual(DEFAULT_STUN_SERVERS);
    });
  });

  describe('KNOWN_FOUNDATIONS', () => {
    it('maps foundation hashes to interface types', () => {
      expect(KNOWN_FOUNDATIONS['842163049']).toBe('public interface');
      expect(KNOWN_FOUNDATIONS['2268587630']).toBe('WireGuard');
    });
  });

  describe('ICE_GATHER_TIMEOUT', () => {
    it('is a reasonable timeout value', () => {
      expect(ICE_GATHER_TIMEOUT).toBeGreaterThanOrEqual(1000);
      expect(ICE_GATHER_TIMEOUT).toBeLessThan(10000);
    });
  });
});

describe('IP categorization patterns', () => {
  const PRIVATE_IP_PATTERN = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/;
  const IPV6_PATTERN = /^[a-f0-9:]+$/i;
  const MDNS_PATTERN = /\.local$/i;

  describe('private IP detection', () => {
    it('matches RFC 1918 ranges', () => {
      expect(PRIVATE_IP_PATTERN.test('10.0.0.1')).toBe(true);
      expect(PRIVATE_IP_PATTERN.test('172.16.0.1')).toBe(true);
      expect(PRIVATE_IP_PATTERN.test('172.31.255.255')).toBe(true);
      expect(PRIVATE_IP_PATTERN.test('172.15.0.1')).toBe(false);
      expect(PRIVATE_IP_PATTERN.test('172.32.0.1')).toBe(false);
      expect(PRIVATE_IP_PATTERN.test('192.168.1.100')).toBe(true);
      expect(PRIVATE_IP_PATTERN.test('8.8.8.8')).toBe(false);
    });
  });

  describe('IPv6 detection', () => {
    it('matches IPv6 addresses', () => {
      expect(IPV6_PATTERN.test('::1')).toBe(true);
      expect(IPV6_PATTERN.test('fe80::1')).toBe(true);
      expect(IPV6_PATTERN.test('192.168.1.1')).toBe(false);
    });
  });

  describe('mDNS detection', () => {
    it('matches .local addresses', () => {
      expect(MDNS_PATTERN.test('abc123.local')).toBe(true);
      expect(MDNS_PATTERN.test('192.168.1.1')).toBe(false);
    });
  });
});

describe('ICE candidate parsing pattern', () => {
  const candidatePattern =
    /candidate:(\S+)\s+\d+\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+typ\s+(\S+)/i;

  it('parses host candidate', () => {
    const m =
      'candidate:842163049 1 udp 1677729535 192.168.1.100 54321 typ host generation 0'.match(
        candidatePattern,
      );
    expect(m![1]).toBe('842163049');
    expect(m![4]).toBe('192.168.1.100');
    expect(m![6]).toBe('host');
  });

  it('parses srflx (STUN) candidate', () => {
    const m =
      'candidate:123456 1 udp 100401151 203.0.113.5 8080 typ srflx raddr 192.168.1.100 rport 54321'.match(
        candidatePattern,
      );
    expect(m![4]).toBe('203.0.113.5');
    expect(m![6]).toBe('srflx');
  });

  it('parses relay candidate', () => {
    const m =
      'candidate:789 1 udp 50331903 198.51.100.3 3478 typ relay raddr 203.0.113.5 rport 8080'.match(
        candidatePattern,
      );
    expect(m![6]).toBe('relay');
  });

  it('parses mDNS obfuscated candidate', () => {
    const m =
      'candidate:842163049 1 udp 1677729535 abc123def.local 54321 typ host'.match(
        candidatePattern,
      );
    expect(m![4]).toBe('abc123def.local');
  });
});
