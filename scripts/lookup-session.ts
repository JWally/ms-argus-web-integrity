#!/usr/bin/env tsx
/**
 * Dump the headless / worker / lies / analysis breakdown for a session.
 *
 * Usage:
 *   npx tsx scripts/lookup-session.ts <argusSessionId>
 */

import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const sessionId = process.argv[2];
if (!sessionId) {
  console.error('usage: npx tsx scripts/lookup-session.ts <argusSessionId>');
  process.exit(1);
}

const stage = process.env.ARGUS_E2E_STAGE ?? 'dev-jw';
const region = process.env.AWS_REGION ?? 'us-east-1';

const ddb = new DynamoDBClient({ region });

(async () => {
  const resp = await ddb.send(
    new GetItemCommand({
      TableName: `ms-argus-api-${stage}-integrity-results`,
      Key: { session_id: { S: sessionId } },
    }),
  );
  if (!resp.Item) {
    console.error(`no record for session ${sessionId}`);
    process.exit(1);
  }
  const rec = unmarshall(resp.Item);
  const dev = rec.device as any;
  const ana = rec.analysis as any;

  const headless = dev.headless?.likeHeadless ?? {};
  const headlessTrue = Object.entries(headless).filter(([, v]) => v === true);
  const headlessFalse = Object.entries(headless).filter(([, v]) => v === false);

  const hardTrue = Object.entries(dev.headless?.headless ?? {}).filter(
    ([, v]) => v === true,
  );
  const stealthTrue = Object.entries(dev.headless?.stealth ?? {}).filter(
    ([, v]) => v === true,
  );

  console.log('='.repeat(70));
  console.log(`Session:   ${sessionId}`);
  console.log(`UA:        ${dev.navigator?.userAgent}`);
  console.log(`Screen:    ${dev.screen?.width}x${dev.screen?.height}`);
  console.log(
    `Engine:    ${dev.engine?.jsEngine} / ${dev.engine?.layoutEngine}`,
  );
  console.log('='.repeat(70));

  console.log('\nLikeHeadless soft signals:');
  console.log(`  ${headless['noMimeTypes'] !== undefined ? Object.keys(headless).length : 0} total, ${headlessTrue.length} firing`);
  console.log(`  rating: ${dev.headless?.likeHeadlessRating}`);
  if (headlessTrue.length > 0) {
    console.log('  FIRING:');
    for (const [k] of headlessTrue) console.log(`    - ${k}`);
  }
  if (headlessFalse.length > 0) {
    console.log('  clean:');
    for (const [k] of headlessFalse) console.log(`    - ${k}`);
  }

  console.log('\nHard headless signals:');
  console.log(`  rating: ${dev.headless?.headlessRating}`);
  if (hardTrue.length > 0) {
    console.log('  FIRING:');
    for (const [k] of hardTrue) console.log(`    - ${k}`);
  } else {
    console.log('  none firing');
  }

  console.log('\nStealth signals:');
  console.log(`  rating: ${dev.headless?.stealthRating}`);
  if (stealthTrue.length > 0) {
    console.log('  FIRING:');
    for (const [k] of stealthTrue) console.log(`    - ${k}`);
  } else {
    console.log('  none firing');
  }

  console.log('\nLies scanner:');
  console.log(`  totalLies: ${dev.lies?.totalLies ?? 0}`);
  const lieKeys = Object.keys(dev.lies?.data ?? {});
  if (lieKeys.length > 0) {
    console.log('  flagged properties:');
    for (const k of lieKeys.slice(0, 15)) console.log(`    - ${k}`);
    if (lieKeys.length > 15) console.log(`    ... and ${lieKeys.length - 15} more`);
  }

  console.log('\nWorker scope analysis:');
  console.log(`  lied: ${ana.worker?.lied}`);
  console.log(`  divergences: ${ana.worker?.divergences?.length ?? 0}`);
  if ((ana.worker?.signals ?? []).length > 0) {
    console.log('  signals:');
    for (const s of ana.worker.signals) {
      console.log(`    - ${s.code} (${s.severity}): ${s.evidence}`);
    }
  }

  console.log('\nJA4 / UA cross-check:');
  console.log(
    `  ja4=${ana.ja4_ua?.ja4_browser_family}  h2=${ana.ja4_ua?.h2_browser_family}  ua=${ana.ja4_ua?.ua_browser_family}`,
  );
  console.log(
    `  signals: ${(ana.ja4_ua?.signals ?? []).map((s: any) => s.code).join(', ') || '(none)'}`,
  );

  console.log('\nIP consistency:');
  console.log(
    `  api=${ana.ip?.ips?.api}  tls=${ana.ip?.ips?.tls}  tcp=${ana.ip?.ips?.tcp}  webrtc=${ana.ip?.ips?.webrtc}`,
  );
  console.log(`  asn: ${ana.ip?.asn?.category} (${ana.ip?.asn?.org ?? 'unknown org'})`);

  console.log('\nTimezone:');
  console.log(
    `  client: ${dev.timezone?.location}  offset=${dev.timezone?.offset}`,
  );
  console.log(
    `  server says CF geo: ${ana.timezone?.cfTimezone ?? 'unknown'}`,
  );
  console.log(`  lied: ${ana.timezone?.lied}`);
})();
