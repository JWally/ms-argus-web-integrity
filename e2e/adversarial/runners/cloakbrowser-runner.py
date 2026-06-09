#!/usr/bin/env python3
"""
CloakBrowser runner for the adversarial e2e suite.

CloakBrowser is a Chromium binary fork (~58 source-level C++ stealth
patches) controlled over CDP, shipped as a Python package in
~/Dev/ms-argus-signal-lab/.venv-stealth. Launches headed, so the spec
skips when no display is present. Reads the result via the DOM autorun
channel.

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
    import cloakbrowser

    browser = await cloakbrowser.launch_async(
        headless=False,
        args=["--autoplay-policy=no-user-gesture-required"],
    )
    try:
        page = await browser.new_page()
        await page.goto(URL, wait_until="load", timeout=20000)
        await page.wait_for_selector("#argus-out[data-done='1']", timeout=45000)
        text = await page.text_content("#argus-out")
        r = json.loads(text or "{}")
        if not r.get("ok") or not r.get("argusSessionId"):
            print(f"autorun failed: {r}", file=sys.stderr)
            return 1
        print(f"ARGUS_SESSION_ID={r['argusSessionId']}")
        return 0
    finally:
        try:
            await browser.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
