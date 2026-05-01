/**
 * WebRTC integrity signals.
 *
 * Collects signals useful for bot/tampering detection:
 *
 * - **RTP extensions**: Browser/OS-specific; mismatch with User-Agent is a spoofing signal.
 * - **ICE candidate analysis**: hasMDNS=false indicates headless/non-browser environment.
 *   Raw private IP exposure (no mDNS obfuscation) is a headless signal.
 *   publicIP/primaryIP cross-validates against sigint-observed IP to detect proxies/VPNs.
 * - **Foundation**: Stable per network interface; KNOWN_FOUNDATIONS catches WireGuard.
 *
 * RTCPeerConnection prototype tampering is caught separately by the lies scanner.
 * Codec data is intentionally excluded — headless Chrome has identical codecs to real Chrome.
 */

import {
  getRtcConfig,
  KNOWN_FOUNDATIONS,
  ICE_GATHER_TIMEOUT,
} from './constants';
import type {
  WebRTCFingerprint,
  ParsedICECandidate,
  ICECandidateSummary,
  SigintCandidate,
} from './types';

const PRIVATE_IP_PATTERN = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/;
const IPV6_PATTERN = /^[a-f0-9:]+$/i;
const MDNS_PATTERN = /\.local$/i;

function categorizeIP(address: string): ParsedICECandidate['category'] {
  if (!address) return 'unknown';
  if (MDNS_PATTERN.test(address)) return 'mdns';
  if (PRIVATE_IP_PATTERN.test(address)) return 'private';
  if (IPV6_PATTERN.test(address)) return 'ipv6';
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)) return 'public';
  return 'unknown';
}

function parseICECandidate(candidateStr: string): ParsedICECandidate | null {
  if (!candidateStr) return null;
  const match = candidateStr.match(
    /candidate:(\S+)\s+\d+\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+typ\s+(\S+)/i,
  );
  if (!match) return null;
  const [, foundation, protocol, priority, address, port, type] = match;
  return {
    foundation,
    protocol: protocol.toLowerCase() as 'udp' | 'tcp',
    priority: parseInt(priority, 10),
    address,
    port: parseInt(port, 10),
    type: type as ParsedICECandidate['type'],
    category: categorizeIP(address),
  };
}

function summarizeICECandidates(
  candidates: ParsedICECandidate[],
): ICECandidateSummary {
  const typeCount: Record<string, number> = {};
  const publicIPs: string[] = [];
  const privateIPs: string[] = [];
  const ipv6Addresses: string[] = [];
  const sigintCandidates: SigintCandidate[] = [];
  const seenSigint = new Set<string>();
  let hasMDNS = false;

  for (const c of candidates) {
    typeCount[c.type] = (typeCount[c.type] || 0) + 1;
    if (c.category === 'public') {
      if (!publicIPs.includes(c.address)) publicIPs.push(c.address);
    } else if (c.category === 'private') {
      if (!privateIPs.includes(c.address)) privateIPs.push(c.address);
    } else if (c.category === 'ipv6') {
      if (!ipv6Addresses.includes(c.address)) ipv6Addresses.push(c.address);
    } else if (c.category === 'mdns') {
      hasMDNS = true;
    }
    if (c.type === 'srflx') {
      const key = `${c.address}:${c.port}`;
      if (!seenSigint.has(key)) {
        seenSigint.add(key);
        sigintCandidates.push({ address: c.address, port: c.port });
      }
    }
  }

  const primaryIP = publicIPs[0] || privateIPs[0] || ipv6Addresses[0];

  return {
    typeCount,
    hasPrivateIP: privateIPs.length > 0,
    hasMDNS,
    publicIP: publicIPs[0],
    privateIPs,
    ipv6Addresses,
    primaryIP,
    sigintCandidates,
  };
}

function getExtensions(sdp: string): string[] {
  const extensions = (('' + sdp).match(/extmap:\d+ [^\n|\r]+/g) || []).map(
    (x) => x.replace(/extmap:[^\s]+ /, ''),
  );
  return [...new Set(extensions)].sort();
}

export default async function getWebRTCData(): Promise<WebRTCFingerprint | null> {
  return new Promise(async (resolve) => {
    if (!window.RTCPeerConnection) return resolve(null);

    const connection = new RTCPeerConnection(getRtcConfig());
    connection.createDataChannel('');

    const offer = await connection.createOffer({
      offerToReceiveAudio: 1,
      offerToReceiveVideo: 1,
    } as unknown as RTCOfferOptions);
    connection.setLocalDescription(offer);
    const sdp = offer.sdp || '';

    const extensions = getExtensions(sdp);
    const collectedCandidates: ParsedICECandidate[] = [];
    let firstFoundation = '';

    const finalize = () => {
      connection.removeEventListener('icecandidate', onCandidate);
      connection.close();

      if (!sdp) return resolve(null);

      return resolve({
        extensions,
        foundation: firstFoundation,
        foundationLabel: KNOWN_FOUNDATIONS[firstFoundation] || null,
        iceCandidates: summarizeICECandidates(collectedCandidates),
      });
    };

    const timeout = setTimeout(finalize, ICE_GATHER_TIMEOUT);

    const onCandidate = (event: RTCPeerConnectionIceEvent) => {
      const { candidate } = event.candidate || {};
      if (!candidate) {
        clearTimeout(timeout);
        finalize();
        return;
      }
      const parsed = parseICECandidate(candidate);
      if (parsed) {
        collectedCandidates.push(parsed);
        if (!firstFoundation) firstFoundation = parsed.foundation;
      }
    };

    connection.addEventListener('icecandidate', onCandidate);
  });
}
