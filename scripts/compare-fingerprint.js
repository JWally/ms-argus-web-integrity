/**
 * Compare new library fingerprint against baseline
 * Verifies that refactoring didn't break fingerprint collection
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const baselinePath = path.join(__dirname, '..', 'baseline.json');

// Fields that MUST match exactly (deterministic)
const MUST_MATCH = [
  'navigator.platform',
  'navigator.deviceMemory',
  'navigator.hardwareConcurrency',
  'navigator.vendor',
  'screen.width',
  'screen.height',
  'screen.colorDepth',
  'screen.pixelDepth',
  'timezone.location',
  'timezone.zone',
  'maths.data',
];

// Fields that may vary between runs
const MAY_VARY = [
  'canvas2d.mods',
  'offlineAudioContext',
  'resistance.timerPrecision',
  'meta.timestamp',
  'meta.durationMs',
];

function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

function compareFingerprints(baseline, current) {
  const results = {
    matched: [],
    mismatched: [],
    missing: [],
    newFields: [],
  };

  // Check must-match fields
  for (const fieldPath of MUST_MATCH) {
    const baselineVal = getNestedValue(baseline.loose, fieldPath);
    const currentVal = getNestedValue(current.loose, fieldPath);

    if (baselineVal === undefined && currentVal === undefined) {
      continue;
    }

    if (currentVal === undefined) {
      results.missing.push({ field: fieldPath, expected: baselineVal });
    } else if (JSON.stringify(baselineVal) !== JSON.stringify(currentVal)) {
      results.mismatched.push({
        field: fieldPath,
        expected: baselineVal,
        actual: currentVal,
      });
    } else {
      results.matched.push(fieldPath);
    }
  }

  return results;
}

async function main() {
  // Check if baseline exists
  if (!fs.existsSync(baselinePath)) {
    console.error(
      'ERROR: baseline.json not found. Run npm run baseline:capture first.',
    );
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  console.log('Loaded baseline fingerprint');

  // Launch browser with same viewport as capture
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Suppress console noise
  page.on('console', () => {});

  console.log('Starting dev server check...');

  try {
    await page.goto('http://localhost:8000/', { timeout: 5000 });
  } catch (err) {
    console.error('ERROR: Dev server not running. Start it with: npm start');
    await browser.close();
    process.exit(1);
  }

  console.log('Clicking collect button...');
  await page.click('#collectBtn');

  console.log('Waiting for fingerprint collection...');

  // Wait for fingerprint to complete
  await page.waitForFunction(() => window.FingerprintResult, {
    timeout: 30000,
  });

  const result = await page.evaluate(() => window.FingerprintResult);

  await browser.close();

  console.log('\n=== Fingerprint Comparison Results ===\n');

  // Compare
  const comparison = compareFingerprints(baseline, result);

  // Report results
  console.log(`Matched fields: ${comparison.matched.length}`);
  for (const field of comparison.matched) {
    console.log(`  ✓ ${field}`);
  }

  if (comparison.mismatched.length > 0) {
    console.log(`\nMismatched fields: ${comparison.mismatched.length}`);
    for (const { field, expected, actual } of comparison.mismatched) {
      console.log(`  ✗ ${field}`);
      console.log(`    Expected: ${JSON.stringify(expected)}`);
      console.log(`    Actual:   ${JSON.stringify(actual)}`);
    }
  }

  if (comparison.missing.length > 0) {
    console.log(`\nMissing fields: ${comparison.missing.length}`);
    for (const { field, expected } of comparison.missing) {
      console.log(`  ? ${field}: ${JSON.stringify(expected)}`);
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Total must-match fields: ${MUST_MATCH.length}`);
  console.log(`Matched: ${comparison.matched.length}`);
  console.log(`Mismatched: ${comparison.mismatched.length}`);
  console.log(`Missing: ${comparison.missing.length}`);

  // Check for critical sections in new output
  const sections = Object.keys(result.loose || {});
  console.log(`\nNew fingerprint sections (${sections.length}):`);
  console.log(`  ${sections.join(', ')}`);

  // Exit with error if mismatches
  if (comparison.mismatched.length > 0 || comparison.missing.length > 0) {
    console.log('\n⚠️  Some fields do not match baseline');
    process.exit(1);
  }

  console.log('\n✓ All deterministic fields match baseline!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
