#!/usr/bin/env python3
"""
nodriver runner for the adversarial e2e suite.

nodriver drives system Chrome over raw CDP with the minimum domains
enabled — in the signal-lab matrix it evaded every CDP-tell probe. This
runner exists so the suite documents that gap (and would surface a catch
if a future probe lands). nodriver launches headed, so it needs a
display (DISPLAY / Xvfb); the spec skips when one isn't present.

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
    import nodriver as uc

    browser = await uc.start(
        browser_args=["--autoplay-policy=no-user-gesture-required"],
    )
    try:
        tab = await browser.get(URL)
        done = None
        for _ in range(120):
            done = await tab.evaluate(
                "(document.getElementById('argus-out')||{}).getAttribute "
                "? document.getElementById('argus-out').getAttribute('data-done') "
                ": null"
            )
            if done in ("1", 1, True):
                break
            await asyncio.sleep(0.5)

        text = await tab.evaluate(
            "document.getElementById('argus-out').textContent"
        )
        r = json.loads(text) if isinstance(text, str) else {}
        if not r.get("ok") or not r.get("argusSessionId"):
            print(f"autorun failed (done={done}): {r}", file=sys.stderr)
            return 1
        print(f"ARGUS_SESSION_ID={r['argusSessionId']}")
        return 0
    finally:
        try:
            browser.stop()
            await asyncio.sleep(0.3)
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
