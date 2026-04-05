#!/usr/bin/env npx ts-node
/**
 * Update Features Data
 *
 * Collects browser features using Playwright and updates:
 * - features-stable.json: Baseline features for current browser versions
 * - features-engine-maps.json: Version-by-version changes (when run with --diff)
 *
 * Usage:
 *   npx ts-node scripts/update-features.ts           # Update stable baseline
 *   npx ts-node scripts/update-features.ts --diff    # Detect changes vs existing baseline
 *
 * Requirements:
 *   npm install -D playwright
 *   npx playwright install chromium firefox
 */

import { chromium, firefox, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

interface BrowserFeatures {
  version: number;
  windowKeys: string;
  cssKeys: string;
}

interface FeaturesStable {
  Chrome?: BrowserFeatures;
  Firefox?: BrowserFeatures;
}

interface EngineMapEntry {
  js: Record<string, string[]>;
  css: Record<string, string[]>;
  win: Record<string, string[]>;
}

interface EngineMaps {
  blink: EngineMapEntry;
  gecko: EngineMapEntry;
}

// ============================================================================
// Feature Collection
// ============================================================================

async function collectFeatures(page: Page): Promise<{
  windowKeys: string[];
  cssKeys: string[];
  jsKeys: string[];
}> {
  return await page.evaluate(() => {
    // Collect window keys
    const windowKeys: string[] = [];
    const windowSeen = new Set<string>();

    for (const key of Object.getOwnPropertyNames(window)) {
      if (!windowSeen.has(key)) {
        windowSeen.add(key);
        windowKeys.push(key);
      }
    }

    let proto = Object.getPrototypeOf(window);
    while (proto && proto !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (!windowSeen.has(key)) {
          windowSeen.add(key);
          windowKeys.push(key);
        }
      }
      proto = Object.getPrototypeOf(proto);
    }

    // Collect CSS keys
    const cssKeys: string[] = [];
    const style = document.createElement('div').style;
    const cssSeen = new Set<string>();

    for (const key of Object.getOwnPropertyNames(style)) {
      if (!cssSeen.has(key) && isNaN(Number(key))) {
        cssSeen.add(key);
        cssKeys.push(key);
      }
    }

    proto = Object.getPrototypeOf(style);
    while (proto && proto !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (!cssSeen.has(key) && isNaN(Number(key))) {
          cssSeen.add(key);
          cssKeys.push(key);
        }
      }
      proto = Object.getPrototypeOf(proto);
    }

    // Collect JS API keys (Document, Element properties)
    const jsKeys: string[] = [];
    const jsSeen = new Set<string>();

    // Document properties
    for (const key of Object.getOwnPropertyNames(Document.prototype)) {
      const fullKey = `Document.${key}`;
      if (!jsSeen.has(fullKey)) {
        jsSeen.add(fullKey);
        jsKeys.push(fullKey);
      }
    }

    // Element properties
    for (const key of Object.getOwnPropertyNames(Element.prototype)) {
      const fullKey = `Element.${key}`;
      if (!jsSeen.has(fullKey)) {
        jsSeen.add(fullKey);
        jsKeys.push(fullKey);
      }
    }

    // Navigator properties
    for (const key of Object.getOwnPropertyNames(Navigator.prototype)) {
      const fullKey = `Navigator.${key}`;
      if (!jsSeen.has(fullKey)) {
        jsSeen.add(fullKey);
        jsKeys.push(fullKey);
      }
    }

    // Promise static methods
    for (const key of Object.getOwnPropertyNames(Promise)) {
      if (typeof (Promise as any)[key] === 'function' && key !== 'length' && key !== 'name') {
        const fullKey = `Promise.${key}`;
        if (!jsSeen.has(fullKey)) {
          jsSeen.add(fullKey);
          jsKeys.push(fullKey);
        }
      }
    }

    return {
      windowKeys: windowKeys.sort(),
      cssKeys: cssKeys.sort(),
      jsKeys: jsKeys.sort(),
    };
  });
}

function extractVersion(userAgent: string, browser: 'Chrome' | 'Firefox'): number {
  const pattern = browser === 'Chrome' ? /Chrome\/(\d+)/ : /Firefox\/(\d+)/;
  const match = userAgent.match(pattern);
  return match ? parseInt(match[1], 10) : 0;
}

// ============================================================================
// Browser Collection
// ============================================================================

async function collectFromBrowser(
  browserType: 'chromium' | 'firefox',
  browserName: 'Chrome' | 'Firefox'
): Promise<{ features: BrowserFeatures; jsKeys: string[] } | null> {
  console.log(`Launching ${browserName}...`);
  let browser: Browser | null = null;

  try {
    const launcher = browserType === 'chromium' ? chromium : firefox;
    browser = await launcher.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('about:blank');

    const userAgent = await page.evaluate(() => navigator.userAgent);
    const version = extractVersion(userAgent, browserName);
    console.log(`  Version: ${version}`);

    const { windowKeys, cssKeys, jsKeys } = await collectFeatures(page);
    console.log(`  Window keys: ${windowKeys.length}`);
    console.log(`  CSS keys: ${cssKeys.length}`);
    console.log(`  JS keys: ${jsKeys.length}`);

    return {
      features: {
        version,
        windowKeys: windowKeys.join(', '),
        cssKeys: cssKeys.join(', '),
      },
      jsKeys,
    };
  } catch (error) {
    console.error(`Error collecting ${browserName} features:`, error);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// ============================================================================
// Diff Detection
// ============================================================================

function diffArrays(oldArr: string[], newArr: string[]): { added: string[]; removed: string[] } {
  const oldSet = new Set(oldArr);
  const newSet = new Set(newArr);

  const added = newArr.filter(x => !oldSet.has(x));
  const removed = oldArr.filter(x => !newSet.has(x));

  return { added, removed };
}

function loadExistingData(): { stable: FeaturesStable; engineMaps: EngineMaps } | null {
  const stablePath = path.join(__dirname, '..', 'public', 'data', 'features-stable.json');
  const mapsPath = path.join(__dirname, '..', 'public', 'data', 'features-engine-maps.json');

  try {
    const stable = JSON.parse(fs.readFileSync(stablePath, 'utf-8'));
    const engineMaps = JSON.parse(fs.readFileSync(mapsPath, 'utf-8'));
    return { stable, engineMaps };
  } catch {
    return null;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const isDiff = process.argv.includes('--diff');

  console.log('=== Updating Browser Features ===\n');

  // Load existing data for comparison
  const existing = loadExistingData();

  // Collect from browsers
  const chromeResult = await collectFromBrowser('chromium', 'Chrome');
  console.log('');
  const firefoxResult = await collectFromBrowser('firefox', 'Firefox');

  if (!chromeResult && !firefoxResult) {
    console.error('\nFailed to collect from any browser');
    process.exit(1);
  }

  // Build new stable data
  const newStable: FeaturesStable = {};
  if (chromeResult) newStable.Chrome = chromeResult.features;
  if (firefoxResult) newStable.Firefox = firefoxResult.features;

  // If --diff mode, compare and show changes
  if (isDiff && existing) {
    console.log('\n=== Changes Detected ===\n');

    if (chromeResult && existing.stable.Chrome) {
      const oldVersion = existing.stable.Chrome.version;
      const newVersion = chromeResult.features.version;

      if (newVersion > oldVersion) {
        console.log(`Chrome: ${oldVersion} -> ${newVersion}`);

        const oldWin = existing.stable.Chrome.windowKeys.split(', ');
        const newWin = chromeResult.features.windowKeys.split(', ');
        const winDiff = diffArrays(oldWin, newWin);

        const oldCss = existing.stable.Chrome.cssKeys.split(', ');
        const newCss = chromeResult.features.cssKeys.split(', ');
        const cssDiff = diffArrays(oldCss, newCss);

        if (winDiff.added.length) console.log(`  Window added: ${winDiff.added.join(', ')}`);
        if (winDiff.removed.length) console.log(`  Window removed: ${winDiff.removed.join(', ')}`);
        if (cssDiff.added.length) console.log(`  CSS added: ${cssDiff.added.join(', ')}`);
        if (cssDiff.removed.length) console.log(`  CSS removed: ${cssDiff.removed.join(', ')}`);

        // Suggest engine map updates
        if (winDiff.added.length || winDiff.removed.length || cssDiff.added.length || cssDiff.removed.length) {
          console.log(`\n  Add to features-engine-maps.json blink section:`);
          console.log(`  "${newVersion}": [`);
          for (const key of winDiff.added) console.log(`    "${key}",`);
          for (const key of winDiff.removed) console.log(`    "!${key}",`);
          console.log(`  ]`);
        }
      } else {
        console.log(`Chrome: No version change (${oldVersion})`);
      }
    }

    if (firefoxResult && existing.stable.Firefox) {
      const oldVersion = existing.stable.Firefox.version;
      const newVersion = firefoxResult.features.version;

      if (newVersion > oldVersion) {
        console.log(`\nFirefox: ${oldVersion} -> ${newVersion}`);

        const oldWin = existing.stable.Firefox.windowKeys.split(', ');
        const newWin = firefoxResult.features.windowKeys.split(', ');
        const winDiff = diffArrays(oldWin, newWin);

        const oldCss = existing.stable.Firefox.cssKeys.split(', ');
        const newCss = firefoxResult.features.cssKeys.split(', ');
        const cssDiff = diffArrays(oldCss, newCss);

        if (winDiff.added.length) console.log(`  Window added: ${winDiff.added.join(', ')}`);
        if (winDiff.removed.length) console.log(`  Window removed: ${winDiff.removed.join(', ')}`);
        if (cssDiff.added.length) console.log(`  CSS added: ${cssDiff.added.join(', ')}`);
        if (cssDiff.removed.length) console.log(`  CSS removed: ${cssDiff.removed.join(', ')}`);
      } else {
        console.log(`Firefox: No version change (${oldVersion})`);
      }
    }
  }

  // Write stable data
  const stablePath = path.join(__dirname, '..', 'public', 'data', 'features-stable.json');
  fs.writeFileSync(stablePath, JSON.stringify(newStable, null, 2));
  console.log(`\nWritten: ${stablePath}`);

  // Summary
  console.log('\n=== Summary ===');
  if (newStable.Chrome) {
    const winCount = newStable.Chrome.windowKeys.split(', ').length;
    const cssCount = newStable.Chrome.cssKeys.split(', ').length;
    console.log(`Chrome ${newStable.Chrome.version}: ${winCount} window, ${cssCount} CSS`);
  }
  if (newStable.Firefox) {
    const winCount = newStable.Firefox.windowKeys.split(', ').length;
    const cssCount = newStable.Firefox.cssKeys.split(', ').length;
    console.log(`Firefox ${newStable.Firefox.version}: ${winCount} window, ${cssCount} CSS`);
  }
}

main().catch(console.error);
