import { chromium } from "playwright";
import { execSync } from "node:child_process";

const LOADER = "https://static-integrity-dev-jw.argus.pw/argus-loader.iife.js";
const CPI = "argus_cpi_test_b9UX4lEWFto8KHIeYlw5L4";
const TABLE = "ms-argus-api-dev-jw-integrity-results-v2";

function fetchRowDevicePage(sessionId) {
  const cmd = [
    "aws", "dynamodb", "get-item",
    "--region", "us-east-1",
    "--table-name", TABLE,
    "--key", JSON.stringify({ cpi: { S: CPI }, session_id: { S: sessionId } }),
    "--projection-expression", "meta.#p, request_headers.headers.origin, request_headers.headers.referer",
    "--expression-attribute-names", JSON.stringify({ "#p": "page" }),
    "--output", "json",
  ].map((s) => `'${s.replace(/'/g, "'\\''")}'`).join(" ");
  const out = execSync(cmd, { encoding: "utf-8" });
  const item = JSON.parse(out)?.Item ?? {};
  const meta = item.meta?.M ?? {};
  const page = meta.page?.M ?? null;
  const rh = item.request_headers?.M?.headers?.M ?? {};
  return {
    metaPage: page ? Object.fromEntries(Object.entries(page).map(([k, v]) => [k, v.S ?? v.BOOL ?? v.L?.map(x => x.S) ?? null])) : null,
    origin: rh.origin?.S ?? null,
    referer: rh.referer?.S ?? null,
  };
}

const TEST_PAGE_URL = "https://shop.example.com/checkout/step-3?cart=abc123";
const TEST_PAGE_TITLE = "Checkout · Example Shop";

const HOST = `<!doctype html><html><body>
<script src="${LOADER}"></script>
<script>
window.runArgus = async function() {
  return await window.argus.run({
    cpi: ${JSON.stringify(CPI)},
    page: ${JSON.stringify(TEST_PAGE_URL)},
    pageTitle: ${JSON.stringify(TEST_PAGE_TITLE)},
  });
};
window.runArgusNoPage = async function() {
  return await window.argus.run({ cpi: ${JSON.stringify(CPI)} });
};
</script>
</body></html>`;

const browser = await chromium.launch({ headless: true });

for (const [label, runner] of [
  ["with merchant page", "runArgus"],
  ["WITHOUT merchant page (auto-only)", "runArgusNoPage"],
]) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route("**/host", (r) => r.fulfill({ contentType: "text/html", body: HOST }));
  await page.goto("https://test-host.invalid/host");
  await page.waitForFunction(() => !!window.argus, { timeout: 20000 });
  const r = await page.evaluate((fn) => window[fn](), runner);
  console.log(`\n=== ${label} ===`);
  console.log("argusSessionId:", r.argusSessionId);
  await new Promise((res) => setTimeout(res, 1500));
  const dh = fetchRowDevicePage(r.argusSessionId);
  console.log("meta.page:", JSON.stringify(dh.metaPage, null, 2));
  console.log("request_headers.origin:", dh.origin);
  console.log("request_headers.referer:", dh.referer);
  await ctx.close();
}

await browser.close();
