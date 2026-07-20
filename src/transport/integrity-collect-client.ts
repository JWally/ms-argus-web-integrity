import {
  buildIntegrityCollectRequest,
  type IntegrityCollectRequestInput,
} from './integrity-collect-request';

export interface IntegrityCollectSubmissionInput
  extends IntegrityCollectRequestInput {
  fetchImpl?: typeof fetch;
  onSubmissionError?: (detail: string) => void;
  onCacheUpdate?: (newCache: string) => void;
}

function reportError(
  callback: IntegrityCollectSubmissionInput['onSubmissionError'],
  detail: string,
): void {
  try {
    callback?.(detail);
  } catch {
    // Diagnostics must never replace the submission outcome.
  }
}

function forwardCache(
  callback: IntegrityCollectSubmissionInput['onCacheUpdate'],
  cache: unknown,
): void {
  if (
    typeof cache !== 'string' ||
    cache.length === 0 ||
    cache.length >= 16_384
  ) {
    return;
  }
  try {
    callback?.(cache);
  } catch {
    // The worker/iframe handoff is best-effort; preserve the session result.
  }
}

async function readSubmissionResponse(
  response: Response,
  input: IntegrityCollectSubmissionInput,
): Promise<string> {
  const json = (await response.json()) as Record<string, unknown>;
  const sessionId = typeof json.session_id === 'string' ? json.session_id : '';
  if (!sessionId)
    reportError(input.onSubmissionError, 'no_session_id_in_response');
  forwardCache(input.onCacheUpdate, json.cache);
  return sessionId;
}

/** Submit an already encrypted payload without exposing VM plaintext. */
export async function submitIntegrityPayload(
  input: IntegrityCollectSubmissionInput,
): Promise<string> {
  try {
    const request = buildIntegrityCollectRequest(input);
    const response = await (input.fetchImpl ?? globalThis.fetch)(
      request.url,
      request.init,
    );
    if (!response.ok) {
      reportError(
        input.onSubmissionError,
        `http_${response.status}_${response.statusText || 'error'}`,
      );
      return '';
    }
    return await readSubmissionResponse(response, input);
  } catch (error) {
    reportError(
      input.onSubmissionError,
      `fetch_threw: ${(error as Error)?.message ?? 'unknown'}`,
    );
    return '';
  }
}
