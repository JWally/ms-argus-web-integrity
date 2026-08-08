export interface ProxyProbeResult {
  token: string;
  'x-api-version-hash'?: string;
}

export interface ProxyTlsResult {
  data: unknown;
  error: string | null;
  durationMs: number;
}

export interface ProxyPayloadInput {
  sessionId: string;
  clientUuid: string;
  webrtc: unknown;
  tlsResult: ProxyTlsResult;
  tcpToken: string;
  h2Token: string;
}

function decodeVersionHash(value: string): string | null {
  try {
    const parts = value.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const parsed = getPristineRefs().parse(atob(b64)) as Record<
      string,
      unknown
    >;
    return typeof parsed.vh === 'string' && parsed.vh.length > 0
      ? parsed.vh
      : null;
  } catch {
    return null;
  }
}

export function readProbeHandshake(probe: ProxyProbeResult | null): {
  token: string;
  serverPublicKey: string;
} | null {
  if (!probe?.token || !probe['x-api-version-hash']) return null;
  const serverPublicKey = decodeVersionHash(probe['x-api-version-hash']);
  return serverPublicKey ? { token: probe.token, serverPublicKey } : null;
}

export function buildProxyPayload(input: ProxyPayloadInput) {
  return {
    product: 'proxy_v1' as const,
    identifiers: { session_id: input.sessionId },
    hashes: { stable: 'proxy_v1', fuzzy: 'proxy_v1' },
    device: {
      client_uuid: input.clientUuid,
      webrtc: input.webrtc,
    },
    sigintTls: getPristineRefs().stringify(input.tlsResult),
    sigintTcpToken: input.tcpToken,
    sigintH2Token: input.h2Token,
  };
}
import { getPristineRefs } from '../utils/pristine-iframe';
