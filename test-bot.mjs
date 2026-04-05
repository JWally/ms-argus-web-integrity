#!/usr/bin/env node
/**
 * Quick bot test for the demo site
 * Run with: node test-bot.mjs
 */

import { chromium } from 'playwright';

const DEMO_URL = 'https://static-dev-jw.argus.pw';

async function testWithBot() {
  console.log('Launching headless Chromium...');

  const browser = await chromium.launch({
    headless: true, // Bot mode
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`Navigating to ${DEMO_URL}...`);
  await page.goto(DEMO_URL, { waitUntil: 'networkidle' });

  console.log('Clicking "Collect Fingerprint" button...');
  await page.click('#collectBtn');

  // Wait for collection to complete (status changes from running)
  console.log('Waiting for fingerprint collection...');
  await page.waitForFunction(() => {
    const status = document.getElementById('status');
    return status && !status.classList.contains('running');
  }, { timeout: 30000 });

  // Get the result
  const result = await page.evaluate(() => {
    const fullData = document.getElementById('fullData');
    return fullData ? fullData.textContent : null;
  });

  if (result) {
    const data = JSON.parse(result);

    console.log('\n=== BOT DETECTION RESULTS ===\n');

    // Bot signals
    const bot = data.fingerprint?.botSignals;
    if (bot) {
      console.log('Bot Signals:');
      console.log(`  isBot: ${bot.isBot}`);
      console.log(`  isHeadless: ${bot.isHeadless}`);
      console.log(`  hasLies: ${bot.hasLies} (count: ${bot.lieCount})`);
      console.log(`  engineMismatch: ${bot.engineMismatch}`);
      console.log(`  badBot: ${bot.badBot || 'none'}`);
    }

    // Inconsistencies
    const inc = data.fingerprint?.inconsistencies;
    if (inc) {
      console.log('\nInconsistencies:');
      console.log(`  riskScore: ${inc.riskScore}/100`);
      console.log(`  critical: ${inc.counts?.critical || 0}`);
      console.log(`  high: ${inc.counts?.high || 0}`);
      console.log(`  medium: ${inc.counts?.medium || 0}`);

      if (inc.inconsistencies?.length > 0) {
        console.log('\n  Top issues:');
        inc.inconsistencies.slice(0, 5).forEach(i => {
          console.log(`    - [${i.severity}] ${i.category}: ${i.description}`);
        });
      }
    }

    // Headless signals
    const headless = data.fingerprint?.loose?.headless;
    if (headless) {
      console.log('\nHeadless Detection:');
      console.log(`  stealth: ${headless.stealth}`);
      console.log(`  likeHeadless: ${headless.likeHeadless}`);
      console.log(`  headlessRating: ${headless.headlessRating}`);
    }

    console.log('\nTiming:', `${data.timing?.duration?.toFixed(0)}ms`);
    console.log('\n=== END ===\n');
  } else {
    console.error('Failed to get fingerprint result');
  }

  await browser.close();
}

testWithBot().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
