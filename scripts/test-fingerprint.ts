#!/usr/bin/env npx tsx
/**
 * Test Fingerprinting and Lie Detection
 *
 * Tests:
 * 1. Normal fingerprint collection
 * 2. Spoofed user agent to trigger lies
 * 3. Checks if disparities are detected
 */

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:8000';

interface FingerprintResult {
  fingerprint: any;
  lies: any;
  trash: any;
}

async function collectFingerprint(
  userAgent?: string,
  label?: string
): Promise<FingerprintResult | null> {
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: userAgent,
    });

    const page = await context.newPage();

    // Navigate to the test page
    await page.goto(BASE_URL);

    // Wait for fingerprint to complete
    await page.waitForSelector('#fingerprint-data', { timeout: 30000 }).catch(() => null);

    // Try to get the fingerprint result from the page
    const result = await page.evaluate(() => {
      // Check if Argus is available
      if (typeof (window as any).Argus !== 'undefined') {
        return (window as any).Argus;
      }

      // Try to extract from page content
      const fpElement = document.querySelector('#fingerprint-data');
      if (fpElement) {
        try {
          return JSON.parse(fpElement.textContent || '{}');
        } catch {
          return null;
        }
      }

      return null;
    });

    // Get any console errors/warnings
    const logs: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        logs.push(`${msg.type()}: ${msg.text()}`);
      }
    });

    // Also try to call the fingerprint function directly
    const directResult = await page.evaluate(async () => {
      try {
        // Wait a bit for the script to load
        await new Promise((r) => setTimeout(r, 2000));

        // Try to access the fingerprint
        if (typeof (window as any).collectFingerprint === 'function') {
          return await (window as any).collectFingerprint();
        }

        // Check if it's already collected
        const container = document.querySelector('.fingerprint-container');
        if (container) {
          // Extract key info from the DOM
          const liesSection = document.querySelector('.lies-detected');
          const trashSection = document.querySelector('.trash-detected');

          return {
            hasLies: liesSection?.textContent?.includes('true') || false,
            liesContent: liesSection?.textContent || '',
            trashContent: trashSection?.textContent || '',
          };
        }

        return null;
      } catch (e) {
        return { error: String(e) };
      }
    });

    console.log(`\n=== ${label || 'Fingerprint'} ===`);
    if (userAgent) {
      console.log(`User-Agent: ${userAgent.substring(0, 60)}...`);
    }

    // Wait for page to fully load and process
    await page.waitForTimeout(3000);

    // Get the page content to check for lies
    const pageContent = await page.content();

    // Check for lie indicators in the page
    const hasLieIndicators =
      pageContent.includes('lied') ||
      pageContent.includes('lies') ||
      pageContent.includes('trash');

    // Try to get fingerprint data from the global scope
    const fpData = await page.evaluate(() => {
      // Look for fingerprint data in various places
      const w = window as any;

      // Check for common patterns
      if (w.fp) return { source: 'window.fp', data: w.fp };
      if (w.fingerprint) return { source: 'window.fingerprint', data: w.fingerprint };
      if (w.argusResult) return { source: 'window.argusResult', data: w.argusResult };

      // Look for data in DOM
      const pre = document.querySelector('pre');
      if (pre) {
        try {
          return { source: 'pre element', data: JSON.parse(pre.textContent || '{}') };
        } catch {
          return { source: 'pre element (raw)', data: pre.textContent?.substring(0, 500) };
        }
      }

      // Look for specific elements
      const hashEl = document.querySelector('[data-hash]');
      if (hashEl) {
        return { source: 'hash element', data: hashEl.getAttribute('data-hash') };
      }

      return null;
    });

    if (fpData) {
      console.log(`Source: ${fpData.source}`);
      if (typeof fpData.data === 'object') {
        // Look for lies in the data
        const findLies = (obj: any, path = ''): string[] => {
          const lies: string[] = [];
          if (!obj || typeof obj !== 'object') return lies;

          for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;
            if (key === 'lied' && value === true) {
              lies.push(currentPath);
            }
            if (key === 'lies' && value) {
              lies.push(`${currentPath}: ${JSON.stringify(value)}`);
            }
            if (typeof value === 'object') {
              lies.push(...findLies(value, currentPath));
            }
          }
          return lies;
        };

        const detectedLies = findLies(fpData.data);
        if (detectedLies.length > 0) {
          console.log('LIES DETECTED:');
          detectedLies.forEach((lie) => console.log(`  - ${lie}`));
        } else {
          console.log('No lies detected');
        }
      }
    }

    if (directResult) {
      console.log('Direct result:', JSON.stringify(directResult, null, 2).substring(0, 500));
    }

    return { fingerprint: fpData, lies: null, trash: null };
  } catch (error) {
    console.error('Error:', error);
    return null;
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('=== Argus Fingerprint & Lie Detection Test ===\n');

  // Test 1: Normal fingerprint
  console.log('Test 1: Normal browser (no spoofing)');
  await collectFingerprint(undefined, 'Normal Browser');

  // Test 2: Spoofed user agent - claim to be newer Chrome
  console.log('\n' + '='.repeat(60));
  console.log('Test 2: Spoofed User-Agent (Chrome 130 on old engine)');
  await collectFingerprint(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Spoofed Chrome 130'
  );

  // Test 3: Firefox user agent on Chromium
  console.log('\n' + '='.repeat(60));
  console.log('Test 3: Firefox User-Agent on Chromium engine');
  await collectFingerprint(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Firefox UA on Chromium'
  );

  // Test 4: Very old Chrome version
  console.log('\n' + '='.repeat(60));
  console.log('Test 4: Old Chrome 50 User-Agent');
  await collectFingerprint(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/50.0.2661.102 Safari/537.36',
    'Old Chrome 50'
  );

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
