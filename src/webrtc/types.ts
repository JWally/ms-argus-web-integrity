/**
 * WebRTC Fingerprinting Types
 */

/**
 * Parsed ICE candidate information.
 */
export interface ParsedICECandidate {
  type: 'host' | 'srflx' | 'prflx' | 'relay' | string;
  address: string;
  port: number;
  protocol: 'udp' | 'tcp' | string;
  foundation: string;
  priority: number;
  category: 'private' | 'public' | 'ipv6' | 'mdns' | 'unknown';
}

/**
 * Summary of collected ICE candidates.
 */
export interface ICECandidateSummary {
  /** Count by candidate type (host/srflx/relay) */
  typeCount: Record<string, number>;
  /** Whether any private IPs were exposed (Android / raw headless behaviour) */
  hasPrivateIP: boolean;
  /** Whether mDNS obfuscation is active (absent in headless) */
  hasMDNS: boolean;
  /** Public IPv4 discovered via STUN */
  publicIP?: string;
  /** Private IPs if exposed */
  privateIPs: string[];
  /** IPv6 addresses collected */
  ipv6Addresses: string[];
  /**
   * Primary IP for cross-validation against sigint tcpProbe.client_ip / tlsFingerprint.ip.
   * Prefers public IPv4 > private IPv4 > IPv6.
   */
  primaryIP?: string;
}

/**
 * WebRTC integrity signals.
 *
 * Codec data is intentionally excluded — it's a device-fingerprinting signal,
 * not a bot/tampering signal. Headless Chrome has identical codecs to real Chrome.
 */
export interface WebRTCFingerprint {
  /** RTP header extensions from SDP — browser/OS-specific, useful for UA authenticity checks */
  extensions: string[];
  /** Raw ICE candidate foundation value (stable per interface; classified server-side) */
  foundation: string;
  /** Client-side label from KNOWN_FOUNDATIONS, if matched. Server does its own classification. */
  foundationLabel: string | null;
  /** All collected ICE candidates with IP/type analysis */
  iceCandidates: ICECandidateSummary;
}
