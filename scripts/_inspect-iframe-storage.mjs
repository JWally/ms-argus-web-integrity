import { chromium } from "playwright";

const LOADER_URL =
  "https://static-integrity-dev-jw.argus.pw/argus-loader.iife.js";
const CPI = "argus_cpi_test_b9UX4lEWFto8KHIeYlw5L4";

const HOST_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script src="${LOADER_URL}"></script>
<script>
window.runArgus = async function() {
  return await window.argus.run({ cpi: ${JSON.stringify(CPI)} });
};
</script>
</body></html>`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.route("**/_iframe-host", (route) =>
  route.fulfill({ contentType: "text/html", body: HOST_PAGE }),
);
await page.goto("https://test-host.invalid/_iframe-host");
await page.waitForFunction(() => !!window.argus, { timeout: 20000 });
await page.evaluate(() => window.runArgus());

// Give iframes a moment to settle and any storage writes to land.
await new Promise((r) => setTimeout(r, 500));

console.log("=== main frame ===");
console.log("origin:", await page.evaluate(() => location.origin));
console.log(
  "localStorage('cache') main:",
  await page.evaluate(() => {
    try { return localStorage.getItem("cache") || "(empty)"; }
    catch (e) { return "THREW: " + e.message; }
  }),
);

console.log("\n=== frames ===");
const frames = page.frames();
console.log("total frames:", frames.length);
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  const info = await f.evaluate(() => {
    let cache, threw;
    try { cache = localStorage.getItem("cache") || "(empty)"; }
    catch (e) { cache = null; threw = e.message; }
    return {
      origin: location.origin,
      href: location.href.slice(0, 80),
      cache,
      threw,
      lsLen: (() => { try { return localStorage.length; } catch { return -1; } })(),
    };
  }).catch(e => ({ err: e.message }));
  console.log(`frame[${i}]:`, info);
}

await browser.close();
