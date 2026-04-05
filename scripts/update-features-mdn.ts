#!/usr/bin/env npx tsx
/**
 * Update Features Data from MDN Browser Compatibility Data
 *
 * Fetches feature availability data from:
 * - MDN BCD: https://github.com/mdn/browser-compat-data
 *
 * This provides comprehensive version-by-version feature data for all browsers
 * without requiring local browser installations.
 *
 * Usage:
 *   npm run update:features
 *
 * The script:
 * 1. Fetches MDN BCD data
 * 2. Extracts Window, CSS, and API features per browser version
 * 3. Updates features-stable.json and features-engine-maps.json
 */

import * as fs from 'fs';
import * as path from 'path';

const MDN_BCD_URL = 'https://unpkg.com/@mdn/browser-compat-data@latest/data.json';

interface BcdSupport {
  version_added?: string | boolean;
  version_removed?: string;
}

interface BcdEntry {
  __compat?: {
    support?: {
      chrome?: BcdSupport | BcdSupport[];
      firefox?: BcdSupport | BcdSupport[];
    };
  };
  [key: string]: unknown;
}

interface VersionFeatures {
  [version: string]: string[];
}

interface EngineMaps {
  blink: { js: VersionFeatures; css: VersionFeatures; win: VersionFeatures };
  gecko: { js: VersionFeatures; css: VersionFeatures; win: VersionFeatures };
}

// ============================================================================
// Fetch MDN BCD Data
// ============================================================================

interface BcdData {
  __meta: { version: string; timestamp: string };
  api: BcdEntry;
  css: { properties: BcdEntry };
  javascript: { builtins: BcdEntry };
}

async function fetchBcdData(): Promise<BcdData> {
  console.log('  Fetching MDN BCD data.json...');

  const response = await fetch(MDN_BCD_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${MDN_BCD_URL}: ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// Extract Version Data
// ============================================================================

function getVersionAdded(support: BcdSupport | BcdSupport[] | undefined): string | null {
  if (!support) return null;

  const entry = Array.isArray(support) ? support[0] : support;
  if (typeof entry.version_added === 'string') {
    // Handle versions like "79" or "≤79"
    return entry.version_added.replace(/[≤<>]/g, '');
  }
  return null;
}

function extractFeatures(
  data: BcdEntry,
  prefix: string,
  browser: 'chrome' | 'firefox'
): Map<string, string> {
  const features = new Map<string, string>();

  function walk(obj: BcdEntry, path: string) {
    if (obj.__compat?.support) {
      const version = getVersionAdded(obj.__compat.support[browser]);
      if (version && !isNaN(parseInt(version))) {
        features.set(path, version);
      }
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key === '__compat') continue;
      if (typeof value === 'object' && value !== null) {
        walk(value as BcdEntry, path ? `${path}.${key}` : key);
      }
    }
  }

  walk(data, prefix);
  return features;
}

function groupByVersion(features: Map<string, string>): VersionFeatures {
  const byVersion: VersionFeatures = {};

  for (const [feature, version] of features) {
    if (!byVersion[version]) {
      byVersion[version] = [];
    }
    byVersion[version].push(feature);
  }

  // Sort features within each version
  for (const version of Object.keys(byVersion)) {
    byVersion[version].sort();
  }

  return byVersion;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('=== Updating Features from MDN BCD ===\n');

  // Fetch data
  console.log('Fetching MDN Browser Compatibility Data...');
  const bcdData = await fetchBcdData();
  console.log(`  BCD version: ${bcdData.__meta.version}`);

  console.log('\nExtracting Chrome (Blink) features...');
  const chromeApi = extractFeatures(bcdData.api, '', 'chrome');
  const chromeCss = extractFeatures(bcdData.css.properties, '', 'chrome');

  console.log(`  API features: ${chromeApi.size}`);
  console.log(`  CSS features: ${chromeCss.size}`);

  console.log('\nExtracting Firefox (Gecko) features...');
  const firefoxApi = extractFeatures(bcdData.api, '', 'firefox');
  const firefoxCss = extractFeatures(bcdData.css.properties, '', 'firefox');

  console.log(`  API features: ${firefoxApi.size}`);
  console.log(`  CSS features: ${firefoxCss.size}`);

  // Group by version
  const blinkJs = groupByVersion(chromeApi);
  const blinkCss = groupByVersion(chromeCss);
  const geckoJs = groupByVersion(firefoxApi);
  const geckoCss = groupByVersion(firefoxCss);

  // Build engine maps
  const engineMaps: EngineMaps = {
    blink: {
      js: blinkJs,
      css: blinkCss,
      win: {}, // Window properties would need separate extraction
    },
    gecko: {
      js: geckoJs,
      css: geckoCss,
      win: {},
    },
  };

  // Get latest versions
  const latestChrome = Math.max(...Object.keys(blinkJs).map(Number).filter(n => !isNaN(n)));
  const latestFirefox = Math.max(...Object.keys(geckoJs).map(Number).filter(n => !isNaN(n)));

  console.log(`\nLatest Chrome version with new features: ${latestChrome}`);
  console.log(`Latest Firefox version with new features: ${latestFirefox}`);

  // Show recent additions
  console.log('\n=== Recent Chrome Additions ===');
  for (let v = latestChrome; v >= latestChrome - 2; v--) {
    const features = blinkJs[v.toString()];
    if (features) {
      console.log(`Chrome ${v}: ${features.slice(0, 5).join(', ')}${features.length > 5 ? ` (+${features.length - 5} more)` : ''}`);
    }
  }

  console.log('\n=== Recent Firefox Additions ===');
  for (let v = latestFirefox; v >= latestFirefox - 2; v--) {
    const features = geckoJs[v.toString()];
    if (features) {
      console.log(`Firefox ${v}: ${features.slice(0, 5).join(', ')}${features.length > 5 ? ` (+${features.length - 5} more)` : ''}`);
    }
  }

  // Write engine maps
  const mapsPath = path.join(__dirname, '..', 'public', 'data', 'features-engine-maps-mdn.json');
  fs.writeFileSync(mapsPath, JSON.stringify(engineMaps, null, 2));
  console.log(`\nWritten: ${mapsPath}`);

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Chrome versions tracked: ${Object.keys(blinkJs).length}`);
  console.log(`Firefox versions tracked: ${Object.keys(geckoJs).length}`);
  console.log('\nNote: This creates features-engine-maps-mdn.json for reference.');
  console.log('Manual review recommended before replacing features-engine-maps.json');
}

main().catch(console.error);
