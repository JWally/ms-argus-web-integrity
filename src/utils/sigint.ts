/**
 * Sigint Integration Module
 *
 * Integrates with ms-argus-sigint server-side fingerprinting services:
 * - TLS Fingerprint Edge (CloudFront): JA3/JA4, third-party cookies, geo/ASN
 * - TCP Probe: TCP RTT, VPN/proxy detection
 * - H2 Probe: HTTP/2 protocol fingerprinting (SETTINGS, WINDOW_UPDATE, PRIORITY frames)
 * - STUN: WebRTC IP discovery
 * - Favicon Cache: Persistent device ID via browser favicon cache
 *
 * All endpoints are configurable via domain configuration.
 */

import {
  getFaviconCacheId,
  type FaviconCacheData,
  type FaviconCacheConfig as FaviconCacheConfigInternal,
} from './favicon-cache';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Configuration for sigint endpoints */
export interface SigintConfig {
  /** Base domain for sigint services (e.g., "argus.pw") */
  baseDomain: string;
  /** Stage prefix for sub-production (e.g., "qa-", "uat-", or "" for prod) */
  stagePrefix?: string;
  /** Timeout for requests in ms (default: 5000) */
  timeout?: number;
  /** Enable third-party cookie endpoint (default: true) */
  enableCookie?: boolean;
  /** Enable TCP probe endpoint (default: true) */
  enableTcpProbe?: boolean;
  /** Enable H2 probe endpoint for HTTP/2 fingerprinting (default: true) */
  enableH2Probe?: boolean;
  /** Enable STUN for WebRTC IP discovery (default: false - requires user gesture) */
  enableStun?: boolean;
  /** Enable favicon cache fingerprinting (default: true) */
  enableFaviconCache?: boolean;
  /** Favicon cache configuration */
  faviconCache?: {
    /** Number of bits (default: 32) */
    bits?: number;
    /** Path prefix on the id subdomain (default: "/fav") */
    pathPrefix?: string;
  };
}

/** Response from TLS Fingerprint Edge (CloudFront) */
export interface TlsFingerprintResponse {
  /** Visitor ID (UUID format) */
  id: string;
  /** Whether this is a new visitor (cookie was just set) */
  new: boolean;
  /** Client IP address */
  ip: string | null;
  /** Autonomous System Number */
  asn: string | null;
  /** Country code (ISO 3166-1 alpha-2) */
  country: string | null;
  /** JA3 TLS fingerprint hash */
  ja3: string | null;
  /** JA4 TLS fingerprint (newer, more detailed) */
  ja4: string | null;
}

/** TCP connection info from kernel */
export interface TcpInfo {
  state: number;
  rtt: number;
  rttvar: number;
  snd_mss: number;
  rcv_mss: number;
  pmtu: number;
  total_retrans: number;
  snd_cwnd: number;
  rcv_space: number;
  [key: string]: number;
}

/** RTT-based proxy/VPN detection */
export interface RttFingerprint {
  /** TCP RTT in microseconds (to immediate peer) */
  tcp_rtt_us: number;
  /** TLS handshake duration in microseconds */
  tls_handshake_us: number;
  /** Time from TLS complete to first HTTP byte */
  http_first_byte_us: number;
  /** Total connection time */
  total_connection_us: number;
  /** Send MSS (reduced by VPN tunnel overhead) */
  snd_mss: number;
  /** Path MTU */
  pmtu: number;
  /** TLS/TCP ratio (elevated for proxies) */
  tls_to_tcp_ratio: number;
  /** Total/TCP ratio */
  total_to_tcp_ratio: number;
  /** Proxy likelihood score (0.0-1.0) */
  proxy_score: number;
  /** VPN likelihood score (0.0-1.0) */
  vpn_score: number;
  /** Human-readable detection signals */
  proxy_signals: string[];
}

/** HTTP/2 PRIORITY frame data */
export interface H2PriorityFrame {
  stream_id: number;
  exclusive: boolean;
  depends_on: number;
  weight: number;
}

/** HTTP/2 protocol fingerprint from h2-probe */
export interface Http2Fingerprint {
  /** SETTINGS frame values in order received (e.g., "MAX_CONCURRENT_STREAMS:100") */
  settings_order: string[];
  /** HEADER_TABLE_SIZE setting value */
  header_table_size?: number;
  /** ENABLE_PUSH setting value */
  enable_push?: number;
  /** MAX_CONCURRENT_STREAMS setting value */
  max_concurrent_streams?: number;
  /** INITIAL_WINDOW_SIZE setting value */
  initial_window_size?: number;
  /** MAX_FRAME_SIZE setting value */
  max_frame_size?: number;
  /** MAX_HEADER_LIST_SIZE setting value */
  max_header_list_size?: number;
  /** Connection-level WINDOW_UPDATE value */
  window_update?: number;
  /** PRIORITY frames sent by client */
  priority_frames?: H2PriorityFrame[];
  /** Computed fingerprint string (Akamai-style: "SETTINGS|WINDOW_UPDATE|PRIORITIES") */
  fingerprint: string;
  /** Protocol version (h2) */
  protocol: string;
}

/**
 * Response from H2 Probe service (legacy plaintext format).
 * New deployments return ProbeTokenResponse instead.
 */
export interface H2ProbeResponse {
  h2_fingerprint: Http2Fingerprint | null;
  client_ip: string;
  domain: string;
  error?: string;
}

/**
 * Encrypted probe response returned by ms-argus-sigint when SIGINT_AES_KEY is configured.
 * The client cannot decrypt this — it is passed through opaquely to the API for server-side
 * decryption. Format: base64(nonce[12] || ciphertext || gcm_tag[16]).
 */
export interface EncryptedProbeResponse {
  v: number;
  data: string;
}

/**
 * Token response returned by tcp-probe and h2-probe.
 * The probe stores the full fingerprint in DynamoDB keyed by this token and returns
 * only the token to the client. The client forwards it to ms-argus-api, which
 * verifies the HMAC and fetches the fingerprint server-side.
 * Format: {nonce_hex}.{expiry_ms}.{hmac_hex} — 90-second TTL.
 */
export interface ProbeTokenResponse {
  token: string;
  /** JWT-shaped field carrying the server's ECDH public key in the "vh" claim. */
  'x-api-version-hash'?: string;
}

/**
 * Extract the server's raw ECDH public key from the h2-probe's JWT-shaped
 * x-api-version-hash field. Returns null if the field is absent or malformed.
 */
export function extractEcdhPubkeyFromVersionHash(
  versionHash: string,
): string | null {
  try {
    const parts = versionHash.split('.');
    if (parts.length !== 3) return null;
    // Base64url → base64 → JSON
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64)) as Record<string, unknown>;
    return typeof payload['vh'] === 'string' ? payload['vh'] : null;
  } catch {
    return null;
  }
}

/** Client Hints captured by TCP Probe */
export interface ClientHints {
  ua?: string;
  ua_mobile?: string;
  ua_platform?: string;
  ua_platform_version?: string;
  ua_arch?: string;
  ua_bitness?: string;
  ua_model?: string;
  device_memory?: string;
  downlink?: string;
  ect?: string;
  network_rtt?: string;
}

/**
 * Response from TCP Probe service (legacy plaintext format).
 * New deployments return ProbeTokenResponse instead.
 */
export interface TcpProbeResponse {
  tcp_info: TcpInfo | null;
  rtt_fingerprint: RttFingerprint | null;
  /** @deprecated HTTP/2 fingerprinting moved to dedicated h2-probe service. Always null. */
  http2_fingerprint: null;
  client_hints: ClientHints | null;
  user_agent: string;
  client_ip: string;
  domain: string;
}

/** WebRTC STUN result */
export interface StunResult {
  /** Local IP address (private) */
  localIp: string | null;
  /** Reflexive IP address (public, as seen by STUN server) */
  reflexiveIp: string | null;
  /** Whether NAT was detected */
  natDetected: boolean;
  /** STUN server used */
  stunServer: string;
}

/** Combined sigint data */
export interface SigintData {
  /** TLS fingerprint data from CloudFront edge */
  tlsFingerprint: TlsFingerprintResponse | null;
  /** TCP probe data: token (current), encrypted blob (legacy encrypted), or plaintext (legacy) */
  tcpProbe:
    | TcpProbeResponse
    | EncryptedProbeResponse
    | ProbeTokenResponse
    | null;
  /** H2 probe data: token (current), encrypted blob (legacy encrypted), or plaintext (legacy) */
  h2Probe: H2ProbeResponse | EncryptedProbeResponse | ProbeTokenResponse | null;
  /** STUN/WebRTC data */
  stun: StunResult | null;
  /** Favicon cache device ID */
  faviconCache: FaviconCacheData | null;
  /** Collection timing */
  timing: {
    tlsFingerprintMs: number | null;
    tcpProbeMs: number | null;
    h2ProbeMs: number | null;
    stunMs: number | null;
    faviconCacheMs: number | null;
    totalMs: number;
  };
  /** Any errors that occurred */
  errors: string[];
}

/* ------------------------------------------------------------------ */
/*  Default Configuration                                              */
/* ------------------------------------------------------------------ */

const DEFAULT_CONFIG: Required<SigintConfig> = {
  baseDomain: 'argus.pw',
  stagePrefix: '',
  timeout: 7000,
  enableCookie: true,
  enableTcpProbe: true,
  enableH2Probe: true,
  enableStun: false,
  enableFaviconCache: true,
  faviconCache: {
    bits: 32,
    pathPrefix: '/fav',
  },
};

/* ------------------------------------------------------------------ */
/*  URL Builders                                                       */
/* ------------------------------------------------------------------ */

/** Construct a full URL from config, subdomain, and path. */
function buildEndpoint(
  config: Required<SigintConfig>,
  subdomain: string,
  path = '/',
): string {
  const fullSubdomain = `${config.stagePrefix}${subdomain}`;
  return `https://${fullSubdomain}.${config.baseDomain}${path}`;
}

/**
 * Get the TLS fingerprint endpoint URL for the given sigint configuration.
 *
 * @param config - Sigint configuration specifying domain and stage
 * @returns Fully-qualified HTTPS URL for the TLS fingerprint service
 */
export function getTlsFingerprintEndpoint(config: SigintConfig): string {
  const merged = { ...DEFAULT_CONFIG, ...config };
  return buildEndpoint(merged, 'id');
}

/**
 * Get the TCP probe endpoint URL for the given sigint configuration.
 *
 * @param config - Sigint configuration specifying domain and stage
 * @returns Fully-qualified HTTPS URL for the TCP probe service
 */
export function getTcpProbeEndpoint(config: SigintConfig): string {
  const merged = { ...DEFAULT_CONFIG, ...config };
  return buildEndpoint(merged, 'tcp-probe');
}

/**
 * Get the H2 probe endpoint URL for the given sigint configuration.
 *
 * @param config - Sigint configuration specifying domain and stage
 * @returns Fully-qualified HTTPS URL for the H2 probe service
 */
export function getH2ProbeEndpoint(config: SigintConfig): string {
  const merged = { ...DEFAULT_CONFIG, ...config };
  return buildEndpoint(merged, 'h2');
}

/**
 * Get the STUN server URI for WebRTC ICE candidate gathering.
 *
 * @param config - Sigint configuration specifying domain and stage
 * @returns STUN URI in the format `stun:<subdomain>.<domain>:3478`
 */
export function getStunServerUri(config: SigintConfig): string {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const subdomain = `${merged.stagePrefix}stun`;
  return `stun:${subdomain}.${merged.baseDomain}:3478`;
}

/**
 * Get the favicon cache base URL for integration with favicon-cache.ts.
 *
 * @param config - Sigint configuration specifying domain, stage, and favicon options
 * @returns Fully-qualified HTTPS URL pointing to the favicon cache path on the id subdomain
 */
export function getFaviconCacheEndpoint(config: SigintConfig): string {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const pathPrefix = merged.faviconCache?.pathPrefix || '/fav';
  // Favicon cache is served from the same domain as TLS fingerprint (id subdomain)
  return buildEndpoint(merged, 'id', pathPrefix + '/');
}

/**
 * Build the favicon cache configuration object for use with favicon-cache.ts.
 *
 * @param config - Sigint configuration specifying domain, stage, and favicon options
 * @returns Object containing baseUrl, bit count, and probe path for favicon cache operations
 */
export function getFaviconCacheConfig(config: SigintConfig): {
  baseUrl: string;
  bits: number;
  probePath: string;
} {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const faviconConfig = merged.faviconCache || DEFAULT_CONFIG.faviconCache;
  return {
    baseUrl: buildEndpoint(merged, 'id', ''),
    bits: faviconConfig.bits || 32,
    probePath: (faviconConfig.pathPrefix || '/fav') + '/',
  };
}

/* ------------------------------------------------------------------ */
/*  Fetch Helpers                                                      */
/* ------------------------------------------------------------------ */

/** Fetch JSON from a URL with an AbortController-based timeout. */
async function fetchWithTimeout<T>(
  url: string,
  timeout: number,
  options: RequestInit = {},
): Promise<{ data: T | null; error: string | null; durationMs: number }> {
  const start = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Note: credentials: 'include' requires server to return specific origin, not '*'
    // If server returns Access-Control-Allow-Origin: *, use 'same-origin' instead
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      credentials: 'omit', // Omit cookies to allow wildcard CORS (server fix needed for cookie support)
    });

    clearTimeout(timeoutId);
    const durationMs = performance.now() - start;

    if (!response.ok) {
      return {
        data: null,
        error: `HTTP ${response.status}: ${response.statusText}`,
        durationMs,
      };
    }

    const data = (await response.json()) as T;
    return { data, error: null, durationMs };
  } catch (err) {
    clearTimeout(timeoutId);
    const durationMs = performance.now() - start;

    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        return { data: null, error: `Timeout after ${timeout}ms`, durationMs };
      }
      return { data: null, error: err.message, durationMs };
    }
    return { data: null, error: String(err), durationMs };
  }
}

/* ------------------------------------------------------------------ */
/*  Individual Collectors                                              */
/* ------------------------------------------------------------------ */

/**
 * Fetch TLS fingerprint data from the CloudFront edge endpoint.
 *
 * The endpoint returns `text/plain` in a signed format: `base64(json).signature_hex`.
 * We decode the base64 payload and ignore the signature (server-side verification only).
 *
 * @param config - Sigint configuration for endpoint resolution and timeout
 * @returns Object containing TLS fingerprint data, any error message, and request duration in ms
 */
export async function fetchTlsFingerprint(config: SigintConfig): Promise<{
  data: TlsFingerprintResponse | null;
  error: string | null;
  durationMs: number;
}> {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const url = getTlsFingerprintEndpoint(config);
  const start = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), merged.timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
    });
    clearTimeout(timeoutId);
    const durationMs = performance.now() - start;

    if (!response.ok) {
      return {
        data: null,
        error: `HTTP ${response.status}: ${response.statusText}`,
        durationMs,
      };
    }

    const text = await response.text();
    // Response format: base64(json).signature_hex — split on last '.' to get payload
    const dotIdx = text.lastIndexOf('.');
    const b64 = dotIdx !== -1 ? text.slice(0, dotIdx) : text;
    let json: string;
    try {
      json = atob(b64);
    } catch {
      return {
        data: null,
        error: 'TLS fingerprint response: base64 decode failed',
        durationMs,
      };
    }
    try {
      const data = JSON.parse(json) as TlsFingerprintResponse;
      return { data, error: null, durationMs };
    } catch {
      return {
        data: null,
        error: 'TLS fingerprint response: JSON parse failed',
        durationMs,
      };
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const durationMs = performance.now() - start;
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        return {
          data: null,
          error: `Timeout after ${merged.timeout}ms`,
          durationMs,
        };
      }
      return { data: null, error: err.message, durationMs };
    }
    return { data: null, error: String(err), durationMs };
  }
}

/** Number of parallel TCP probe requests to make for median calculation */
const TCP_PROBE_SAMPLE_COUNT = 5;

/**
 * Calculate the median of an array of numbers.
 * Returns NaN for empty arrays.
 */
function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Fetch TCP probe data including RTT fingerprint.
 *
 * Makes multiple parallel requests and returns the response with the median
 * TLS/TCP ratio for more robust proxy detection. The median filters out
 * outliers caused by network variance.
 *
 * @param config - Sigint configuration for endpoint resolution and timeout
 * @returns Object containing TCP probe data, any error message, and request duration in ms
 */
function isEncryptedProbeResponse(
  data: unknown,
): data is EncryptedProbeResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>).v === 'number' &&
    typeof (data as Record<string, unknown>).data === 'string'
  );
}

function isProbeTokenResponse(data: unknown): data is ProbeTokenResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>).token === 'string'
  );
}

export async function fetchTcpProbe(config: SigintConfig): Promise<{
  data: TcpProbeResponse | EncryptedProbeResponse | ProbeTokenResponse | null;
  error: string | null;
  durationMs: number;
}> {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const url = getTcpProbeEndpoint(config);
  const start = performance.now();

  // Probe a single request first to detect response format
  const probe = await fetchWithTimeout<
    TcpProbeResponse | EncryptedProbeResponse | ProbeTokenResponse
  >(url, merged.timeout);

  // Token response: probe stores fingerprint server-side, forward token to API
  if (probe.data !== null && isProbeTokenResponse(probe.data)) {
    return {
      data: probe.data,
      error: null,
      durationMs: performance.now() - start,
    };
  }

  // Encrypted response: pass through opaquely
  if (probe.data !== null && isEncryptedProbeResponse(probe.data)) {
    return {
      data: probe.data,
      error: null,
      durationMs: performance.now() - start,
    };
  }

  // Legacy plaintext response: make multiple parallel requests for median calculation
  const requests = Array.from({ length: TCP_PROBE_SAMPLE_COUNT - 1 }, () =>
    fetchWithTimeout<TcpProbeResponse>(url, merged.timeout),
  );
  const rest = await Promise.all(requests);
  const durationMs = performance.now() - start;

  // Filter valid plaintext responses with ratio data
  const allResults = [probe, ...rest];

  // If any retry returned an encrypted/token response, use it
  for (const r of allResults) {
    if (r.data !== null && isProbeTokenResponse(r.data)) {
      return { data: r.data, error: null, durationMs };
    }
    if (r.data !== null && isEncryptedProbeResponse(r.data)) {
      return { data: r.data, error: null, durationMs };
    }
  }
  const validResults = allResults.filter(
    (r): r is typeof r & { data: TcpProbeResponse } =>
      r.data !== null &&
      !isEncryptedProbeResponse(r.data) &&
      !isProbeTokenResponse(r.data) &&
      (r.data as TcpProbeResponse).rtt_fingerprint !== null &&
      typeof (r.data as TcpProbeResponse).rtt_fingerprint!.tls_to_tcp_ratio ===
        'number' &&
      !isNaN((r.data as TcpProbeResponse).rtt_fingerprint!.tls_to_tcp_ratio),
  );

  if (validResults.length === 0) {
    const firstError = allResults.find((r) => r.error !== null);
    return {
      data: null,
      error: firstError?.error || 'All TCP probe requests failed',
      durationMs,
    };
  }

  // Return the result closest to the median ratio
  const ratios = validResults.map(
    (r) => r.data!.rtt_fingerprint!.tls_to_tcp_ratio,
  );
  const medianRatio = median(ratios);

  let closestResult = validResults[0];
  let closestDiff = Math.abs(
    closestResult.data!.rtt_fingerprint!.tls_to_tcp_ratio - medianRatio,
  );

  for (const result of validResults) {
    const diff = Math.abs(
      result.data!.rtt_fingerprint!.tls_to_tcp_ratio - medianRatio,
    );
    if (diff < closestDiff) {
      closestDiff = diff;
      closestResult = result;
    }
  }

  return { data: closestResult.data, error: null, durationMs };
}

/**
 * Fetch H2 probe data including HTTP/2 protocol fingerprint.
 *
 * @param config - Sigint configuration for endpoint resolution and timeout
 * @returns Object containing H2 probe data, any error message, and request duration in ms
 */
export async function fetchH2Probe(config: SigintConfig): Promise<{
  data: H2ProbeResponse | EncryptedProbeResponse | ProbeTokenResponse | null;
  error: string | null;
  durationMs: number;
}> {
  const url = getH2ProbeEndpoint(config);
  const merged = { ...DEFAULT_CONFIG, ...config };
  return fetchWithTimeout<
    H2ProbeResponse | EncryptedProbeResponse | ProbeTokenResponse
  >(url, merged.timeout);
}

/**
 * Perform a STUN binding request via WebRTC to discover local and reflexive IP addresses.
 *
 * Creates a temporary RTCPeerConnection, gathers ICE candidates, and extracts host
 * and server-reflexive candidate IPs to detect NAT presence.
 *
 * @param config - Sigint configuration for STUN server URI and timeout
 * @returns Object containing STUN result with local/reflexive IPs, any error message, and duration in ms
 */
export async function performStunBinding(config: SigintConfig): Promise<{
  data: StunResult | null;
  error: string | null;
  durationMs: number;
}> {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const stunServer = getStunServerUri(config);
  const start = performance.now();

  if (typeof RTCPeerConnection === 'undefined') {
    return {
      data: null,
      error: 'WebRTC not available',
      durationMs: performance.now() - start,
    };
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pc.close();
      resolve({
        data: null,
        error: `STUN timeout after ${merged.timeout}ms`,
        durationMs: performance.now() - start,
      });
    }, merged.timeout);

    const result: StunResult = {
      localIp: null,
      reflexiveIp: null,
      natDetected: false,
      stunServer,
    };

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: stunServer }],
    });

    const completeProbe = () => {
      clearTimeout(timeout);
      pc.close();

      result.natDetected =
        result.localIp !== null &&
        result.reflexiveIp !== null &&
        result.localIp !== result.reflexiveIp;

      resolve({
        data: result,
        error: null,
        durationMs: performance.now() - start,
      });
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        completeProbe();
        return;
      }

      const candidate = event.candidate.candidate;
      // Parse ICE candidate to extract IPs
      // Format: candidate:... typ host/srflx ... address IP ...
      const parts = candidate.split(' ');
      const typeIndex = parts.indexOf('typ');
      if (typeIndex === -1) return;

      const candidateType = parts[typeIndex + 1];
      const ipIndex = 4; // IP is typically at index 4

      if (parts[ipIndex]) {
        const ip = parts[ipIndex];
        // Skip IPv6 link-local and mDNS
        if (ip.includes(':') || ip.endsWith('.local')) return;

        if (candidateType === 'host') {
          result.localIp = ip;
        } else if (candidateType === 'srflx') {
          result.reflexiveIp = ip;
        }
      }
    };

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        completeProbe();
      }
    };

    // Create data channel to trigger ICE gathering
    pc.createDataChannel('stun-probe');

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch((err) => {
        clearTimeout(timeout);
        pc.close();
        resolve({
          data: null,
          error: `WebRTC error: ${err.message}`,
          durationMs: performance.now() - start,
        });
      });
  });
}

/* ------------------------------------------------------------------ */
/*  Main Collector                                                     */
/* ------------------------------------------------------------------ */

/** Collect the favicon cache device ID, wrapping errors and recording timing. */
async function collectFaviconCache(config: SigintConfig): Promise<{
  data: FaviconCacheData | null;
  error: string | null;
  durationMs: number;
}> {
  const start = performance.now();
  try {
    const faviconConfig = getFaviconCacheConfig(config);
    const data = await getFaviconCacheId({
      baseUrl: faviconConfig.baseUrl,
      bits: faviconConfig.bits,
      probePath: faviconConfig.probePath,
    });
    return { data, error: null, durationMs: performance.now() - start };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: performance.now() - start,
    };
  }
}

/**
 * Collect all enabled sigint signals in parallel and return the combined result.
 *
 * Runs TLS fingerprint, TCP probe, H2 probe, STUN, and favicon cache requests concurrently
 * based on configuration flags, aggregating results and errors.
 *
 * @param config - Sigint configuration controlling which collectors to run
 * @returns Combined sigint data including all responses, per-request timing, and collected errors
 */
export async function collectSigintData(
  config: SigintConfig,
): Promise<SigintData> {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const start = performance.now();
  const errors: string[] = [];

  // Build parallel requests based on config
  const requests: Promise<unknown>[] = [];
  const requestTypes: string[] = [];

  if (merged.enableCookie) {
    requests.push(fetchTlsFingerprint(config));
    requestTypes.push('tls');
  }

  if (merged.enableTcpProbe) {
    requests.push(fetchTcpProbe(config));
    requestTypes.push('tcp');
  }

  if (merged.enableH2Probe) {
    requests.push(fetchH2Probe(config));
    requestTypes.push('h2');
  }

  if (merged.enableStun) {
    requests.push(performStunBinding(config));
    requestTypes.push('stun');
  }

  if (merged.enableFaviconCache) {
    requests.push(collectFaviconCache(config));
    requestTypes.push('favicon');
  }

  // Execute in parallel
  const results = await Promise.all(requests);

  // Parse results
  let tlsFingerprint: TlsFingerprintResponse | null = null;
  let tlsFingerprintMs: number | null = null;
  let tcpProbe:
    | TcpProbeResponse
    | EncryptedProbeResponse
    | ProbeTokenResponse
    | null = null;
  let tcpProbeMs: number | null = null;
  let h2Probe:
    | H2ProbeResponse
    | EncryptedProbeResponse
    | ProbeTokenResponse
    | null = null;
  let h2ProbeMs: number | null = null;
  let stun: StunResult | null = null;
  let stunMs: number | null = null;
  let faviconCache: FaviconCacheData | null = null;
  let faviconCacheMs: number | null = null;

  for (let i = 0; i < results.length; i++) {
    const type = requestTypes[i];
    const result = results[i] as {
      data: unknown;
      error: string | null;
      durationMs: number;
    };

    if (result.error) {
      errors.push(`${type}: ${result.error}`);
    }

    switch (type) {
      case 'tls':
        tlsFingerprint = result.data as TlsFingerprintResponse | null;
        tlsFingerprintMs = result.durationMs;
        break;
      case 'tcp':
        tcpProbe = result.data as
          | TcpProbeResponse
          | EncryptedProbeResponse
          | ProbeTokenResponse
          | null;
        tcpProbeMs = result.durationMs;
        break;
      case 'h2':
        h2Probe = result.data as
          | H2ProbeResponse
          | EncryptedProbeResponse
          | ProbeTokenResponse
          | null;
        h2ProbeMs = result.durationMs;
        break;
      case 'stun':
        stun = result.data as StunResult | null;
        stunMs = result.durationMs;
        break;
      case 'favicon':
        faviconCache = result.data as FaviconCacheData | null;
        faviconCacheMs = result.durationMs;
        break;
    }
  }

  return {
    tlsFingerprint,
    tcpProbe,
    h2Probe,
    stun,
    faviconCache,
    timing: {
      tlsFingerprintMs,
      tcpProbeMs,
      h2ProbeMs,
      stunMs,
      faviconCacheMs,
      totalMs: performance.now() - start,
    },
    errors,
  };
}

/* ------------------------------------------------------------------ */
/*  Config Parser                                                      */
/* ------------------------------------------------------------------ */

/**
 * Parse sigint configuration from URL search parameters.
 *
 * Supported params:
 * - sigintDomain: Base domain (e.g., "argus.pw")
 * - sigintStage: Stage prefix (e.g., "qa-", "uat-")
 * - sigintTimeout: Request timeout in ms
 * - sigintCookie: Enable cookie endpoint ("true"/"false")
 * - sigintTcpProbe: Enable TCP probe ("true"/"false")
 * - sigintStun: Enable STUN ("true"/"false")
 * - sigintFavicon: Enable favicon cache ("true"/"false")
 * - sigintFaviconBits: Number of favicon bits (default: 32)
 *
 * @param url - URL string or URL object from which to extract search parameters
 * @returns Partial sigint config populated from any recognized query parameters
 */
export function parseSigintConfigFromUrl(
  url: string | URL,
): Partial<SigintConfig> {
  const searchParams =
    typeof url === 'string' ? new URL(url).searchParams : url.searchParams;
  const config: Partial<SigintConfig> = {};

  const domain = searchParams.get('sigintDomain');
  if (domain) config.baseDomain = domain;

  const stage = searchParams.get('sigintStage');
  if (stage !== null) config.stagePrefix = stage;

  const timeout = searchParams.get('sigintTimeout');
  if (timeout) {
    const parsed = parseInt(timeout, 10);
    if (!isNaN(parsed)) config.timeout = parsed;
  }

  const cookie = searchParams.get('sigintCookie');
  if (cookie !== null) config.enableCookie = cookie !== 'false';

  const tcpProbe = searchParams.get('sigintTcpProbe');
  if (tcpProbe !== null) config.enableTcpProbe = tcpProbe !== 'false';

  const h2Probe = searchParams.get('sigintH2Probe');
  if (h2Probe !== null) config.enableH2Probe = h2Probe !== 'false';

  const stun = searchParams.get('sigintStun');
  if (stun !== null) config.enableStun = stun === 'true';

  const favicon = searchParams.get('sigintFavicon');
  if (favicon !== null) config.enableFaviconCache = favicon !== 'false';

  const faviconBits = searchParams.get('sigintFaviconBits');
  if (faviconBits) {
    const parsed = parseInt(faviconBits, 10);
    if (!isNaN(parsed)) {
      config.faviconCache = { bits: parsed };
    }
  }

  return config;
}

/* ------------------------------------------------------------------ */
/*  Convenience Exports                                                */
/* ------------------------------------------------------------------ */

/**
 * Quick check if we're likely behind a proxy or VPN.
 *
 * Returns the higher of the proxy and VPN likelihood scores from the TCP probe
 * RTT fingerprint. Only available for legacy plaintext responses — token and
 * encrypted responses require server-side lookup via ms-argus-api.
 *
 * @param data - Collected sigint data containing TCP probe results
 * @returns Score from 0.0 (unlikely) to 1.0 (very likely) indicating proxy/VPN presence
 */
export function getProxyScore(data: SigintData): number {
  if (!data.tcpProbe) return 0;
  if (
    isEncryptedProbeResponse(data.tcpProbe) ||
    isProbeTokenResponse(data.tcpProbe)
  )
    return 0;
  if (!data.tcpProbe.rtt_fingerprint) return 0;
  return Math.max(
    data.tcpProbe.rtt_fingerprint.proxy_score,
    data.tcpProbe.rtt_fingerprint.vpn_score,
  );
}

/**
 * Get the TLS fingerprint hash, preferring JA4 with a fallback to JA3.
 *
 * @param data - Collected sigint data containing TLS fingerprint results
 * @returns JA4 or JA3 hash string, or null if TLS fingerprint data is unavailable
 */
export function getTlsHash(data: SigintData): string | null {
  if (!data.tlsFingerprint) return null;
  return data.tlsFingerprint.ja4 || data.tlsFingerprint.ja3;
}

/**
 * Get the third-party cookie visitor ID from the TLS fingerprint response.
 *
 * @param data - Collected sigint data containing TLS fingerprint results
 * @returns UUID visitor ID string, or null if TLS fingerprint data is unavailable
 */
export function getThirdPartyCookieId(data: SigintData): string | null {
  return data.tlsFingerprint?.id || null;
}

/**
 * Get the persistent device ID derived from the browser's favicon cache.
 *
 * @param data - Collected sigint data containing favicon cache results
 * @returns Device ID string, or null if favicon cache data is unavailable
 */
export function getFaviconCacheDeviceId(data: SigintData): string | null {
  return data.faviconCache?.id || null;
}

/**
 * Get the HTTP/2 protocol fingerprint string.
 *
 * Only available for legacy plaintext responses — token and encrypted responses
 * require server-side lookup via ms-argus-api.
 *
 * @param data - Collected sigint data containing H2 probe results
 * @returns H2 fingerprint string (Akamai-style), or null if H2 probe data is unavailable
 */
export function getH2Fingerprint(data: SigintData): string | null {
  if (!data.h2Probe) return null;
  if (
    isEncryptedProbeResponse(data.h2Probe) ||
    isProbeTokenResponse(data.h2Probe)
  )
    return null;
  return data.h2Probe.h2_fingerprint?.fingerprint || null;
}
