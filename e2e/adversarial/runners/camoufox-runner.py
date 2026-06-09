#!/usr/bin/env python3
"""
Camoufox runner for the adversarial e2e suite.

Camoufox is a Firefox/Marionette anti-detect fork shipped as a Python
package (lives in ~/Dev/ms-argus-bots/venv). It can't be imported into
the TS/Playwright suite, so the spec shells out here: drive the local
autorun page and print the argus session id it exposes via the DOM.

Env:
  LOADER_URL   autorun page URL with cpi/sid baked in (set by the spec)
"""
import asyncio
import json
import os
import sys

URL = os.environ.get(
    "LOADER_URL", "http://localhost:9100/test-loader-autorun.html"
)


async def main() -> int:
    from camoufox.async_api import AsyncCamoufox

    async with AsyncCamoufox(headless=True) as browser:
        page = await browser.new_page()
        await page.goto(URL, wait_until="load")
        await page.wait_for_selector("#argus-out[data-done='1']", timeout=45000)
        text = await page.text_content("#argus-out")
        r = json.loads(text or "{}")
        if not r.get("ok") or not r.get("argusSessionId"):
            print(f"autorun failed: {r}", file=sys.stderr)
            return 1
        print(f"ARGUS_SESSION_ID={r['argusSessionId']}")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
