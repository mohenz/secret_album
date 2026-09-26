"""실제 클립보드 + 키보드 Ctrl+V로 붙여넣기 업로드를 재현한다 (진단용)."""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_e2e as e2e  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

COPY_IMAGE = """async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 300; canvas.height = 200;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); ctx.fillRect(0, 0, 300, 200);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  return true;
}"""


def main():
    e2e.prepare()
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900}, bypass_csp=True, permissions=["clipboard-read", "clipboard-write"])
        page = context.new_page()
        page.on("console", lambda m: print("console:", m.type, m.text))
        page.goto(f"{e2e.BASE}/login.html")
        page.fill("#login-id", "owner.e2e")
        page.fill("#password", e2e.PASSWORD)
        page.click("button[type=submit]")
        page.wait_for_url(re.compile(r"/$"))
        page.goto(f"{e2e.BASE}/")
        page.click("text=Create album")
        page.fill("dialog input[name=name]", "Yeha")
        page.click("dialog button[type=submit]")
        page.wait_for_selector("dialog input[name=title]")
        page.fill("dialog input[name=title]", "Test")
        page.click("dialog button[type=submit]")
        page.wait_for_url(re.compile(r"album\.html"))
        page.goto(f"{e2e.BASE}/manage/upload.html")
        page.wait_for_selector("#album")
        cases = [
            ("본문 클릭 후 Ctrl+V", lambda: page.click("h1")),
            ("앨범 선택칸에서 고른 직후 Ctrl+V", lambda: (page.select_option("#album", index=1))),
            ("드롭존에 포커스 후 Ctrl+V", lambda: page.focus("#dropzone")),
            ("검색칸에 포커스 후 Ctrl+V", lambda: page.focus("#review-search")),
        ]
        for name, prepare in cases:
            page.evaluate(COPY_IMAGE)
            prepare()
            before = page.locator(".quick-status").text_content() or ""
            page.keyboard.press("Control+V")
            page.wait_for_timeout(2500)
            after = page.locator(".quick-status").text_content() or ""
            focus = page.evaluate("document.activeElement.tagName + '#' + document.activeElement.id")
            print(f"[{name}] focus={focus} status='{after}'" + (" (변화 없음)" if after == before else ""))
        browser.close()


if __name__ == "__main__":
    main()
