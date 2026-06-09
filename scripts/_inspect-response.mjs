import { chromium } from "playwright";

const LOADER_URL =
  "https://static-integrity-dev-jw.argus.pw/argus-loader.iife.js";
const CPI = "argus_cpi_test_b9UX4lEWFto8KHIeYlw5L4";

const HOST_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script src="${LOADER_URL}"></script>
<script>
window.runArgus = async function() {
  if (!window.argus) throw new Error('no window.argus');
  return await window.argus.run({ cpi: ${JSON.stringify(CPI)} });
};
</script>
</body></html>`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.route("**/cache-rt-host", (route) =>
  route.fulfill({ contentType: "text/html", body: HOST_PAGE }),
);

const responses = [];
page.on("response", async (r) => {
  if (r.url().includes("/v1/integrity-collect")) {
    console.log("[net]", r.request().method(), r.status(), r.url());
    try {
      const text = await r.text();
      let body = null;
      try { body = JSON.parse(text); } catch {}
      responses.push({
        url: r.url(),
        status: r.status(),
        rawText: text,
        body,
        bodyKeys: body ? Object.keys(body) : null,
        hasCache: body ? "cache" in body : null,
        cacheLen: body && typeof body.cache === "string" ? body.cache.length : null,
        responseHeaders: r.headers(),
      });
    } catch (e) {
      responses.push({ url: r.url(), status: r.status(), error: e.message });
    }
  }
});

await page.goto("https://cache-rt-host.invalid/cache-rt-host");
await page.waitForFunction(() => !!window.argus, { timeout: 20000 });
const result = await page.evaluate(() => window.runArgus());
console.log("argusSessionId:", result?.argusSessionId);
const localCacheAfter = await page.evaluate(() => {
  try {
    return localStorage.getItem("cache") || "";
  } catch {
    return "";
  }
});
console.log("localStorage('cache') after scan:", localCacheAfter ? localCacheAfter.slice(0, 40) + "... len=" + localCacheAfter.length : "<empty>");

console.log("\n=== captured /v1/integrity-collect responses ===");
for (const r of responses) {
  console.log("status:", r.status);
  console.log("response keys:", r.bodyKeys);
  console.log("hasCache:", r.hasCache, "  cacheLen:", r.cacheLen);
  console.log("rawText preview:", (r.rawText || '').slice(0, 400));
  console.log("response content-type:", r.responseHeaders?.['content-type']);
}
await browser.close();
