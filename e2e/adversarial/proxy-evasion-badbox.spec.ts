import { test, expect } from '@playwright/test';
import puppeteer from 'puppeteer';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { runIntegrityPuppeteer, fetchAdversarialRecord } from './helpers';

/**
 * Same shape as proxy-evasion-dallas.spec.ts, but routes through the
 * bad-box reverse-SOCKS5 tunnel instead of SOAX. Egress is the operator's
 * residential IP via chisel ↔ C2 EC2 ↔ docker container at home.
 *
 * Setup it does itself:
 *   - Reads ms-argus-bad-box-dev-jw stack outputs
 *   - Picks newest active tunnel from the DDB registry
 *   - Spawns an SSM port-forward C2:<remote_port> → localhost:<local_port>
 *   - Launches puppeteer with --proxy-server=socks5://127.0.0.1:<local_port>
 *
 * No timezone spoofing — operator's machine TZ already matches their home
 * exit IP. No WebRTC spoofing — chisel is TCP-only so STUN/UDP egresses
 * direct from the puppeteer host (same machine, same residential IP).
 */

const BADBOX_STACK = process.env.BADBOX_STACK || 'ms-argus-bad-box-dev-jw';
const REGION = process.env.AWS_REGION || 'us-east-1';

function awsJson<T = unknown>(args: string[]): T {
  return JSON.parse(execFileSync('aws', args, { encoding: 'utf8' })) as T;
}

interface CfnOutput { OutputKey: string; OutputValue: string }
function out(outputs: CfnOutput[], key: string): string {
  const v = outputs.find((o) => o.OutputKey === key)?.OutputValue;
  if (!v) throw new Error(`missing stack output ${key}`);
  return v;
}

async function waitForPort(host: string, port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.createConnection({ host, port });
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => { s.destroy(); resolve(false); });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`port ${host}:${port} never opened`);
}

test.describe('adversarial: bad-box residential SOCKS5', () => {
  let ssmProc: ChildProcess | null = null;
  let localPort = 0;
  let expectedExitIp = '';

  test.beforeAll(async () => {
    const outputs = awsJson<{ Stacks: { Outputs: CfnOutput[] }[] }>([
      'cloudformation', 'describe-stacks',
      '--region', REGION, '--stack-name', BADBOX_STACK,
      '--output', 'json',
    ]).Stacks[0].Outputs;
    const tableName = out(outputs, 'TunnelRegistryTableName');
    const instanceId = out(outputs, 'C2InstanceId');

    interface DdbItem {
      port: { N: string };
      announced_at: { N: string };
      expires_at: { N: string };
      public_ip: { S: string };
      user: { S: string };
    }
    const scan = awsJson<{ Items: DdbItem[] }>([
      'dynamodb', 'scan', '--region', REGION, '--table-name', tableName,
      '--output', 'json',
    ]);
    const now = Math.floor(Date.now() / 1000);
    const active = scan.Items
      .filter((i) => Number(i.expires_at.N) > now)
      .sort((a, b) => Number(b.announced_at.N) - Number(a.announced_at.N));
    if (!active.length) {
      throw new Error(`no active tunnels in ${tableName} — start a bad-box client`);
    }
    const tunnel = active[0];
    const remotePort = Number(tunnel.port.N);
    localPort = remotePort + 10000;
    expectedExitIp = tunnel.public_ip.S;
    console.log(
      `bad-box tunnel: user=${tunnel.user.S} egress=${expectedExitIp} ` +
      `port=${remotePort} → localhost:${localPort}`,
    );

    ssmProc = spawn('aws', [
      'ssm', 'start-session', '--region', REGION, '--target', instanceId,
      '--document-name', 'AWS-StartPortForwardingSession',
      '--parameters', JSON.stringify({
        portNumber: [String(remotePort)],
        localPortNumber: [String(localPort)],
      }),
    ], { stdio: 'ignore' });
    await waitForPort('127.0.0.1', localPort);
    console.log(`SOCKS5 reachable at localhost:${localPort}`);
  });

  test.afterAll(() => {
    if (ssmProc) try { ssmProc.kill('SIGTERM'); } catch { /* ignore */ }
  });

  test('puppeteer + bad-box residential SOCKS5', async () => {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        `--proxy-server=socks5://127.0.0.1:${localPort}`,
        '--proxy-bypass-list=localhost;127.0.0.1',
        // Refuse to hand out any UDP ICE candidates that would bypass the
        // proxy. With chisel (TCP-only) there's no proxied UDP path, so
        // WebRTC produces no host/srflx candidates at all — the API exists
        // but ICE gathering is empty. What an attacker behind a SOCKS5
        // tunnel that doesn't carry UDP would see in the wild.
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.15 Safari/537.36',
      ],
    });

    try {
      const page = await browser.newPage();

      // Belt: also nuke RTCPeerConnection in the page realm. Real attackers
      // run uBlock-style WebRTC blockers / about:flags toggles that remove
      // the API. Combined with the chromium flag above, no IP can leak.
      await page.evaluateOnNewDocument(() => {
        const w = window as unknown as Record<string, unknown>;
        delete w.RTCPeerConnection;
        delete w.webkitRTCPeerConnection;
        delete w.RTCIceCandidate;
        delete w.RTCSessionDescription;
        delete w.RTCDataChannel;
      });

      // Confirm exit IP through the tunnel matches the registered tunnel IP.
      // (localhost is bypassed; api.ipify.org goes through the proxy.)
      const ipPage = await browser.newPage();
      await ipPage.goto('https://api.ipify.org?format=json', {
        waitUntil: 'networkidle0',
        timeout: 30_000,
      });
      const ipText = await ipPage.$eval('body', (el) => el.textContent);
      const proxyIp = (JSON.parse(ipText!) as { ip: string }).ip;
      await ipPage.close();
      console.log('Proxy exit IP:', proxyIp, '(expected:', expectedExitIp + ')');
      expect(proxyIp).toBe(expectedExitIp);

      const result = await runIntegrityPuppeteer(page);
      const record = await fetchAdversarialRecord(result.argusSessionId);
      const dev = (record.device ?? {}) as Record<string, unknown>;
      const ana = (record.analysis ?? {}) as Record<string, unknown>;
      const headless = (dev.headless ?? {}) as Record<string, unknown>;
      const lies = (dev.lies ?? {}) as { totalLies?: number; data?: Record<string, unknown> };
      const worker = (ana.worker ?? {}) as Record<string, unknown>;
      const timezone = (ana.timezone ?? {}) as Record<string, unknown>;
      const ip = (ana.ip ?? {}) as Record<string, unknown>;
      const network = (ana.network ?? {}) as Record<string, unknown>;

      console.log('\n=== BAD-BOX RESIDENTIAL BOT ===');
      console.log('Session:', result.argusSessionId);
      console.log('Headless rating:', headless.likeHeadlessRating);
      console.log('Headless hard:', headless.headless);
      console.log('Stealth rating:', headless.stealthRating);
      console.log('Total lies:', lies.totalLies);
      console.log('Lies data:', lies.data ? Object.keys(lies.data) : []);
      console.log('WebRTC:', dev.webrtc);
      console.log('Client TZ:', (dev.timezone as { location?: string })?.location);

      expect(result.argusSessionId).toBeTruthy();

      console.log('\n=== SERVER ANALYSIS ===');
      console.log('Worker lied:', worker.lied);
      console.log('Worker divergences:',
        (worker.divergences as { field: string }[] | undefined)?.map((d) => d.field));
      console.log('Timezone lied:', timezone.lied);
      console.log('Timezone CF:', timezone.cfTimezone);
      console.log('Timezone client:', timezone.clientTimezone);
      console.log('IP lied:', ip.lied);
      console.log('IP probes consistent:',
        (ip.checks as { probesConsistent?: boolean } | undefined)?.probesConsistent);
      console.log('IP WebRTC matches:',
        (ip.checks as { webrtcMatchesProbes?: boolean } | undefined)?.webrtcMatchesProbes);
      console.log('IP addresses:', ip.ips);
      console.log('Network proxy_score:', network.proxy_score);
      console.log('Network vpn_score:', network.vpn_score);
      console.log('Network signals:', network.signals);

      const allSignals = [
        ...((worker.signals ?? []) as { code: string; severity: string; evidence: string }[]),
        ...((timezone.signals ?? []) as { code: string; severity: string; evidence: string }[]),
        ...((ip.signals ?? []) as { code: string; severity: string; evidence: string }[]),
        ...((network.signals ?? []) as { code: string; severity: string; evidence: string }[]),
      ];
      console.log('\n=== ALL SIGNALS ===');
      for (const s of allSignals) {
        console.log(`  ${s.code} (${s.severity}): ${s.evidence}`);
      }
      console.log(`Total signals: ${allSignals.length}`);
      console.log('Modules that flagged lied:', [
        worker.lied && 'worker',
        timezone.lied && 'timezone',
        ip.lied && 'ip',
        (((network.proxy_score as number) ?? 0) > 0 ||
          ((network.vpn_score as number) ?? 0) > 0) && 'network',
      ].filter(Boolean));

      // Same browser session + same proxy — also poll FPJS for what
      // *their* vpn/proxy/bot detectors say about this exit.
      const fpjsPage = await browser.newPage();
      interface FpjsEvent {
        products?: {
          identification?: { data?: { visitorId?: string; confidence?: { score?: number } } };
          botd?: { data?: { bot?: { result?: string; type?: string } } };
          vpn?: { data?: { result?: boolean; originCountry?: string; methods?: Record<string, boolean> } };
          proxy?: { data?: { result?: boolean } };
          tampering?: { data?: { result?: boolean; anomalyScore?: number } };
          incognito?: { data?: { result?: boolean } };
          virtualMachine?: { data?: { result?: boolean } };
          ipInfo?: {
            data?: {
              v4?: { address?: string; geolocation?: { country?: { code?: string } }; asn?: { asn?: string; name?: string } };
            };
          };
        };
      }
      const fpjsEvent = new Promise<FpjsEvent | null>((resolve) => {
        const handler = async (res: { url: () => string; text: () => Promise<string> }) => {
          if (res.url().includes('/api/fpjs/event')) {
            try { resolve(JSON.parse(await res.text()) as FpjsEvent); }
            catch { resolve(null); }
          }
        };
        fpjsPage.on('response', handler);
        setTimeout(() => resolve(null), 30_000);
      });
      console.log('\n=== /fpjs ===');
      await fpjsPage.goto('https://arcades.click/fpjs', {
        waitUntil: 'networkidle0',
        timeout: 45_000,
      });
      const fpjs = await fpjsEvent;
      if (!fpjs) {
        console.log('  no /api/fpjs/event captured');
      } else {
        const p = fpjs.products ?? {};
        console.log('  visitor_id:    ', p.identification?.data?.visitorId);
        console.log('  confidence:    ', p.identification?.data?.confidence?.score);
        console.log('  bot.result:    ', p.botd?.data?.bot?.result);
        console.log('  bot.type:      ', p.botd?.data?.bot?.type);
        console.log('  vpn.result:    ', p.vpn?.data?.result);
        console.log('  vpn.origin:    ', p.vpn?.data?.originCountry);
        console.log('  vpn.methods:   ', p.vpn?.data?.methods);
        console.log('  proxy.result:  ', p.proxy?.data?.result);
        console.log('  tampering:     ', p.tampering?.data?.result, '(score', p.tampering?.data?.anomalyScore + ')');
        console.log('  incognito:     ', p.incognito?.data?.result);
        console.log('  virtualMachine:', p.virtualMachine?.data?.result);
        console.log('  ip:            ', p.ipInfo?.data?.v4?.address);
        console.log('  ip.country:    ', p.ipInfo?.data?.v4?.geolocation?.country?.code);
        console.log('  ip.asn:        ', p.ipInfo?.data?.v4?.asn?.asn, p.ipInfo?.data?.v4?.asn?.name);
      }
    } finally {
      await browser.close();
    }
  });
});
