import { chromium } from "playwright";
const LOADER = "https://static-integrity-dev-jw.argus.pw/argus-loader.iife.js";
const CPI = "argus_cpi_test_b9UX4lEWFto8KHIeYlw5L4";

// Hook fetch in BOTH main frame and any iframes that get created. Capture
// every body returned from /v1/integrity-collect so we can see what the SDK
// is actually seeing.
const HOST = `<!doctype html><html><body>
<script>
window.__fetchLog = [];
function patchFetch(target, where) {
  const orig = target.fetch.bind(target);
  target.fetch = async function(url, opts) {
    const resp = await orig(url, opts);
    try {
      const u = (url && url.url) || url;
      if ((u + '').includes('/v1/integrity-collect')) {
        const clone = resp.clone();
        const text = await clone.text();
        window.__fetchLog.push({ where, url: u + '', status: resp.status, headers: { ct: resp.headers.get('content-type') }, body: text });
      }
    } catch (e) {
      window.__fetchLog.push({ where, hook_err: e.message });
    }
    return resp;
  };
}
patchFetch(window, 'main');
const origCreate = document.createElement.bind(document);
document.createElement = function(tag) {
  const el = origCreate(tag);
  if ((tag + '').toLowerCase() === 'iframe') {
    el.addEventListener('load', () => {
      try {
        const cw = el.contentWindow;
        if (cw && cw.fetch) patchFetch(cw, 'iframe');
      } catch {}
    });
  }
  return el;
};
</script>
<script src="${LOADER}"></script>
<script>
window.runArgus = async function() {
  return await window.argus.run({ cpi: ${JSON.stringify(CPI)} });
};
</script>
</body></html>`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.route("**/host", r => r.fulfill({ contentType: "text/html", body: HOST }));
await page.goto("https://test-host.invalid/host");
await page.waitForFunction(() => !!window.argus, { timeout: 20000 });
const result = await page.evaluate(() => window.runArgus());
console.log("session:", result.argusSessionId);
await new Promise(r => setTimeout(r, 500));
const log = await page.evaluate(() => window.__fetchLog || []);
console.log("\n=== captured /v1/integrity-collect fetch responses ===");
for (const e of log) console.log(JSON.stringify(e).slice(0, 2000));
await browser.close();
