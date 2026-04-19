/**
 * WebRTC constants.
 */

export const DEFAULT_STUN_SERVERS = [
  'stun:dev-jw-stun.argus.pw:3478',
];

let customStunServers: string[] | null = null;

export function setCustomStunServers(servers: string[]): void {
  customStunServers = servers;
}

export function clearCustomStunServers(): void {
  customStunServers = null;
}

export function getStunServers(): string[] {
  return customStunServers || DEFAULT_STUN_SERVERS;
}

export function getRtcConfig(): RTCConfiguration {
  return {
    iceCandidatePoolSize: 1,
    iceServers: [{ urls: getStunServers() }],
  };
}

/**
 * Known ICE candidate foundation values mapped to interface types.
 * The foundation is a stable hash of {candidate type + base IP + protocol}.
 */
export const KNOWN_FOUNDATIONS: Record<string, string> = {
  '842163049': 'public interface',
  '2268587630': 'WireGuard',
};

/** Timeout for ICE candidate gathering (ms). 2s covers cellular CGNAT
 *  cold-start (first UDP packet to a new destination establishing NAT
 *  state), which exceeds the prior 1s window on carriers like AT&T
 *  Mobility. Warm NAT state persists ~30-120s after first success. */
export const ICE_GATHER_TIMEOUT = 2_000;
