import { chromium } from "playwright";
const LOADER = "https://static-integrity-dev-jw.argus.pw/argus-loader.iife.js";
const CPI = "argus_cpi_test_b9UX4lEWFto8KHIeYlw5L4";
const HOST = `<!doctype html><html><body>
<script>
// Install localStorage interceptor BEFORE the SDK loads — so we catch
// every setItem call in either main frame or any future iframe.
window.__lsLog = [];
const origSet = Storage.prototype.setItem;
Storage.prototype.setItem = function(k, v) {
  window.__lsLog.push({ where: 'main', k, v: typeof v === 'string' ? v.slice(0, 60) + (v.length > 60 ? '...(' + v.length + ')' : '') : typeof v });
  return origSet.call(this, k, v);
};
// Patch into srcdoc iframes created via createElement('iframe')
const origCreate = document.createElement.bind(document);
document.createElement = function(tag) {
  const el = origCreate(tag);
  if ((tag + '').toLowerCase() === 'iframe') {
    el.addEventListener('load', () => {
      try {
        const cw = el.contentWindow;
        if (!cw) return;
        const innerProto = cw.Storage && cw.Storage.prototype;
        if (innerProto && innerProto.setItem !== Storage.prototype.setItem) {
          const innerOrig = innerProto.setItem;
          innerProto.setItem = function(k, v) {
            window.__lsLog.push({ where: 'iframe', k, v: typeof v === 'string' ? v.slice(0, 60) + (v.length > 60 ? '...(' + v.length + ')' : '') : typeof v });
            return innerOrig.call(this, k, v);
          };
          window.__lsLog.push({ where: 'meta', msg: 'hooked iframe Storage' });
        }
      } catch (e) {
        window.__lsLog.push({ where: 'meta', err: 'hook failed: ' + e.message });
      }
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
const log = await page.evaluate(() => window.__lsLog || []);
console.log("\n=== captured localStorage.setItem calls ===");
for (const e of log) console.log(JSON.stringify(e));
const finalCache = await page.evaluate(() => { try { return localStorage.getItem("cache"); } catch { return "THREW"; } });
console.log("\nfinal main-frame localStorage('cache'):", finalCache ? finalCache.slice(0, 60) + " (len=" + finalCache.length + ")" : "(empty)");
await browser.close();
