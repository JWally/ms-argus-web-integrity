/** Proxy-only iframe entry. Collects server-bound network evidence and submits
 * the same encrypted v3 transport used by the full integrity product. */
import getWebRTCData from '../webrtc';
import { getClientUuid } from '../utils/get-client-uuid';
import { getPristineRefs } from '../utils/pristine-iframe';
import {
  fetchH2Probe,
  fetchTcpProbe,
  fetchTlsFingerprint,
  type ProbeTokenResponse,
  type SigintConfig,
} from '../utils/sigint';
import { submitIntegrityPayload } from '../transport/integrity-collect-client';
import {
  buildProxyPayload,
  readProbeHandshake,
  type ProxyProbeResult,
} from './payload';
import { encryptProxyPayload } from './transport';

declare const __ARGUS_API_BASE__: string;
declare const __ARGUS_SIGINT_BASE_DOMAIN__: string;
declare const __ARGUS_SIGINT_STAGE_PREFIX__: string;

const API_BASE = __ARGUS_API_BASE__;
const SIGINT_CONFIG: SigintConfig = {
  baseDomain: __ARGUS_SIGINT_BASE_DOMAIN__,
  stagePrefix: __ARGUS_SIGINT_STAGE_PREFIX__,
};
const SCRIPT_SRC =
  (document.currentScript as HTMLScriptElement | null)?.src ?? '';
const SCRIPT_PARAMS = (() => {
  try {
    return new URL(SCRIPT_SRC).searchParams;
  } catch {
    return new URLSearchParams('');
  }
})();

function postBack(msg: Record<string, unknown>): void {
  const send = (
    window as Window & {
      __argusPostBack?: (value: Record<string, unknown>) => void;
    }
  ).__argusPostBack;
  if (typeof send === 'function') {
    send(msg);
    return;
  }
  window.parent.postMessage(msg, '*');
}

function tokenFrom(result: unknown): string {
  return result &&
    typeof result === 'object' &&
    typeof (result as ProbeTokenResponse).token === 'string'
    ? (result as ProbeTokenResponse).token
    : '';
}

async function main(): Promise<void> {
  if (window.parent === window) {
    throw new Error('argus-proxy: must run inside a child iframe');
  }
  const runId = SCRIPT_PARAMS.get('runId') ?? '';
  const merchantSessionId = SCRIPT_PARAMS.get('sessionId');
  const cpi = SCRIPT_PARAMS.get('cpi');
  if (!runId || !cpi || !API_BASE) {
    throw new Error('argus-proxy: missing runId, cpi, or API configuration');
  }

  const [tls, tcp, h2, webrtc, clientUuid] = await Promise.all([
    fetchTlsFingerprint(SIGINT_CONFIG),
    fetchTcpProbe(SIGINT_CONFIG),
    fetchH2Probe(SIGINT_CONFIG),
    getWebRTCData(),
    getClientUuid(),
  ]);
  const handshake = readProbeHandshake(h2.data as ProxyProbeResult | null);
  const tcpToken = tokenFrom(tcp.data);
  if (!handshake || !tcpToken || !tls.data) {
    throw new Error('argus-proxy: required probe unavailable');
  }

  const pristine = getPristineRefs();
  const sessionId = pristine.randomUUID();
  const sessionToken = pristine.randomUUID().replace(/-/g, '');
  const payload = buildProxyPayload({
    sessionId,
    clientUuid: clientUuid.id,
    webrtc,
    tlsResult: tls,
    tcpToken,
    h2Token: handshake.token,
  });
  const sealed = await encryptProxyPayload({
    payloadJson: pristine.stringify(payload),
    sessionToken,
    serverPublicKey: handshake.serverPublicKey,
  });
  let submissionError = '';
  const result = await submitIntegrityPayload({
    endpoint: `${API_BASE}/v1/integrity-collect`,
    encrypted: sealed.encrypted,
    clientPublicKey: sealed.clientPublicKey,
    sessionToken,
    cpi,
    onSubmissionError: (detail) => {
      submissionError = detail;
    },
  });
  if (!result) throw new Error(submissionError || 'submission_failed');
  postBack({
    argusDone: true,
    runId,
    result: {
      argusSessionId: result,
      sessionId: merchantSessionId,
    },
  });
}

main().catch((error) => {
  postBack({
    argusDone: false,
    runId: SCRIPT_PARAMS.get('runId') ?? '',
    error: (error as Error)?.message ?? 'unknown',
  });
});
