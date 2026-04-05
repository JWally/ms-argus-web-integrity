/**
 * Capture baseline fingerprint before refactoring
 *
 * This script:
 * 1. Builds the current argus
 * 2. Starts the dev server
 * 3. Launches a browser with Playwright
 * 4. Waits for fingerprinting to complete
 * 5. Captures window.Fingerprint and window.Creep
 * 6. Saves to baseline.json
 */

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASELINE_FILE = path.join(__dirname, '..', 'baseline.json');
const SERVER_URL = 'http://localhost:8000';
const TIMEOUT = 60000; // 60 seconds

async function waitForServer(url, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log('Server is ready');
        return true;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Server failed to start');
}

async function captureBaseline() {
  let server = null;
  let browser = null;

  try {
    console.log('Building project...');
    // Build first
    await new Promise((resolve, reject) => {
      const build = spawn('npm', ['run', 'build'], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
      });
      build.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Build failed with code ${code}`));
      });
    });

    console.log('Starting dev server...');
    server = spawn('npm', ['start'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
    });

    // Wait for server to be ready
    await waitForServer(SERVER_URL);

    console.log('Launching browser...');
    browser = await chromium.launch({
      headless: true, // Use headless for consistent fingerprint in testing
    });

    const context = await browser.newContext({
      // Use a realistic viewport
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    console.log('Navigating to fingerprint page...');
    await page.goto(SERVER_URL, { waitUntil: 'domcontentloaded' });

    console.log('Clicking collect button...');
    await page.click('#collectBtn');

    console.log('Waiting for fingerprinting to complete...');
    // Wait for window.FingerprintResult to be defined
    await page.waitForFunction(() => window.FingerprintResult, {
      timeout: TIMEOUT,
    });

    // Give it a bit more time to ensure everything is captured
    await page.waitForTimeout(2000);

    console.log('Capturing fingerprint data...');
    const baseline = await page.evaluate(() => {
      // Deep clone to ensure we get plain objects
      const fp = window.FingerprintResult;
      return {
        loose: JSON.parse(JSON.stringify(fp.loose)),
        stable: JSON.parse(JSON.stringify(fp.stable)),
        capturedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
      };
    });

    // Save baseline
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
    console.log(`Baseline saved to ${BASELINE_FILE}`);

    // Print summary
    console.log('\n=== Baseline Summary ===');
    console.log(`Captured at: ${baseline.capturedAt}`);
    console.log(`User Agent: ${baseline.userAgent}`);
    console.log(
      `Loose fingerprint sections: ${Object.keys(baseline.loose).length}`,
    );
    console.log(
      `Stable fingerprint sections: ${Object.keys(baseline.stable).filter((k) => baseline.stable[k] !== undefined).length}`,
    );

    // List the sections
    console.log('\nLoose fingerprint sections:');
    Object.keys(baseline.loose).forEach((key) => {
      const value = baseline.loose[key];
      const hasHash = value && value.$hash;
      console.log(
        `  - ${key}${hasHash ? ` (hash: ${value.$hash.slice(0, 8)}...)` : ''}`,
      );
    });
  } catch (error) {
    console.error('Error capturing baseline:', error);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
    if (server) {
      server.kill();
    }
  }
}

captureBaseline();
