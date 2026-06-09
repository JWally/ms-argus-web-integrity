import { chromium } from "playwright";
const LOADER = "https://static-integrity-dev-jw.argus.pw/argus-loader.iife.js";
const CPI = "argus_cpi_test_b9UX4lEWFto8KHIeYlw5L4";
const HOST = `<!doctype html><html><body>
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

const client = await page.context().newCDPSession(page);
await client.send("Network.enable");
const requestIdsByUrl = new Map();
const reqMethod = new Map();
client.on("Network.requestWillBeSent", (e) => {
  if (e.request.url.includes("/v1/integrity-collect")) {
    reqMethod.set(e.requestId, e.request.method);
  }
});
client.on("Network.responseReceived", (e) => {
  if (e.response.url.includes("/v1/integrity-collect")) {
    const m = reqMethod.get(e.requestId) ?? "?";
    if (m === "POST") {
      requestIdsByUrl.set(e.requestId, e.response.url);
      console.log("POST response", e.response.url, "status:", e.response.status, "contentType:", e.response.headers["content-type"]);
    }
  }
});
client.on("Network.loadingFinished", async (e) => {
  if (!requestIdsByUrl.has(e.requestId)) return;
  const url = requestIdsByUrl.get(e.requestId);
  const id = e.requestId;
  try {
    const body = await client.send("Network.getResponseBody", { requestId: id });
    const text = body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf-8") : body.body;
    console.log("BODY for", url, ":");
    console.log(text);
    try {
      const parsed = JSON.parse(text);
      console.log("parsed keys:", Object.keys(parsed));
      console.log("has cache:", "cache" in parsed, "  typeof cache:", typeof parsed.cache, "  cache length:", parsed.cache?.length);
    } catch (e) { console.log("(not JSON)"); }
  } catch (err) {
    console.log("getResponseBody failed:", err.message);
  }
});

await page.goto("https://test-host.invalid/host");
await page.waitForFunction(() => !!window.argus, { timeout: 20000 });
const result = await page.evaluate(() => window.runArgus());
console.log("argusSessionId:", result.argusSessionId);
await new Promise(r => setTimeout(r, 1500));

// Check storage on every frame
const frames = page.frames();
console.log("\n=== storage check (after scan) ===");
console.log("frames:", frames.length);
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  try {
    const v = await f.evaluate(() => { try { return localStorage.getItem("cache"); } catch { return "THREW"; } });
    console.log(`frame[${i}] (${f.url().slice(0, 60)}) cache:`, v ? `${v.slice(0, 40)}... (len=${v.length})` : "(null/empty)");
  } catch (e) { console.log(`frame[${i}] error:`, e.message); }
}

await browser.close();
