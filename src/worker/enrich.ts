/**
 * Scope enrichment — derives OS, engine, version, and device fields
 * from raw worker or main-thread scope data.
 */

import { getOS, getUserAgentPlatform, decryptUserAgent } from '../utils/helpers';

export interface EnrichedFields {
  system: string;
  device: string;
  userAgentVersion: string;
  userAgentDataVersion: string;
  userAgentEngine: string | undefined;
}

/**
 * Derives system, device, engine, and version fields from a scope's
 * userAgent and userAgentData. Called once per scope instead of inline 3x.
 */
export function enrichScope(scope: { userAgent: string; userAgentData?: Record<string, unknown> }): EnrichedFields {
  const { userAgent } = scope;
  const system = getOS(userAgent);
  const device = getUserAgentPlatform({ userAgent });
  const decrypted = decryptUserAgent({ ua: userAgent, os: system, isBrave: false });
  const extractVersion = (x: string) => (/\d+/.exec(x) || [])[0] || '';
  return {
    system,
    device,
    userAgentVersion: extractVersion(decrypted),
    userAgentDataVersion: extractVersion(
      scope.userAgentData ? (scope.userAgentData.uaFullVersion as string) || '' : '',
    ),
    userAgentEngine:
      /safari/i.test(decrypted) || /iphone|ipad/i.test(userAgent) ? 'JavaScriptCore'
      : /firefox/i.test(userAgent) ? 'SpiderMonkey'
      : /chrome/i.test(userAgent) ? 'V8'
      : undefined,
  };
}
