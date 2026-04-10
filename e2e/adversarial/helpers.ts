import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import type { Page as PuppeteerPage } from 'puppeteer';

export const BASE_URL = 'http://localhost:9100';
export const API_BASE = 'https://api-dev-jw.argus.pw';
export const API_KEY =
  process.env.INTEGRITY_API_KEY ??
  'ak_integrity_e06efb721ca47390a521bf7934c82c540fd3416f0e515a733e73d2a0c89c10a9';

/**
 * Run the integrity flow on a Puppeteer page and return the parsed result.
 */
export async function runIntegrityPuppeteer(page: PuppeteerPage) {
  await page.goto(`${BASE_URL}/test-integrity.html`, { waitUntil: 'networkidle0' });

  // Wait for idle status
  await page.waitForSelector('#status');
  const initialStatus = await page.$eval('#status', (el) => el.textContent);
  if (initialStatus !== 'idle') throw new Error(`Expected idle, got ${initialStatus}`);

  // Run integrity flow
  await page.evaluate(() => (window as any).__runIntegrity());

  // Wait for completion
  await page.waitForFunction(
    () => document.getElementById('status')?.textContent !== 'running',
    { timeout: 30_000 },
  );

  const status = await page.$eval('#status', (el) => el.textContent);
  const resultText = await page.$eval('#result', (el) => el.textContent);

  if (status === 'error') {
    throw new Error(`Integrity flow errored: ${resultText}`);
  }

  return JSON.parse(resultText!);
}

/**
 * Verify a session exists on the server and return the server data.
 */
export async function verifyServerSession(
  sessionId: string,
  request: APIRequestContext,
) {
  const url = `${API_BASE}/v1/integrity-session/${sessionId}`;
  const resp = await request.get(url, {
    headers: { 'X-Api-Key': API_KEY },
  });

  expect(resp.status(), `Server returned ${resp.status()} for session ${sessionId}`).toBe(200);
  return resp.json();
}
