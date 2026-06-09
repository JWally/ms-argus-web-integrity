import { chromium } from "playwright";
const HOST = `<!doctype html><html><body>
<script>
window.testRun = async function() {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('srcdoc', '<!doctype html><html><body><script>try{localStorage.setItem("cache","FROM_IFRAME");window.parent.postMessage({iframeLs: localStorage.getItem("cache"), origin: location.origin, threw: null}, "*");}catch(e){window.parent.postMessage({iframeLs: null, origin: location.origin, threw: e.message}, "*");}</' + 'script></body></html>');
  document.body.appendChild(iframe);
  const msg = await new Promise(res => window.addEventListener("message", e => res(e.data), {once: true}));
  let mainLs;
  try { mainLs = localStorage.getItem("cache"); } catch(e) { mainLs = "THREW:"+e.message; }
  return { iframeReport: msg, mainLs };
};
</script>
</body></html>`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.route("**/host", r => r.fulfill({ contentType: "text/html", body: HOST }));
await page.goto("https://test-host.invalid/host");
const r = await page.evaluate(() => window.testRun());
console.log("iframe report (from inside iframe):", r.iframeReport);
console.log("main frame localStorage('cache') after iframe wrote:", r.mainLs);
await browser.close();
