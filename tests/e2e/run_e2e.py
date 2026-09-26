"""화면 흐름 E2E 검사 (개발 PC 전용, 설치된 Chrome 사용).

  .\\.venv\\Scripts\\python.exe -m pip install -r requirements-dev.txt
  .\\.venv\\Scripts\\python.exe tests\\e2e\\run_e2e.py

운영 DB와 local/media는 쓰지 않는다. secret_album_test DB와 임시 저장소로
API(3151)·화면(8190)을 이 프로세스 안에서 띄우고, Worker도 스레드로 돌린다.
스크린샷은 local/e2e/에 남는다.
"""

import dataclasses
import functools
import os
import re
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from playwright.sync_api import expect, sync_playwright  # noqa: E402

from scripts.album_api import auth, database, jobs, logs  # noqa: E402
from scripts.album_api.config import Settings  # noqa: E402
from scripts.album_api.handler import SETTING_CACHE, AlbumRequestHandler  # noqa: E402
from tests.live_support import TEST_DB, _load_env, sample_jpeg  # noqa: E402
from web_server import WEB_ROOT, WebHandler  # noqa: E402

API_PORT, WEB_PORT = 3151, 8190
BASE = f"http://127.0.0.1:{WEB_PORT}"
OUT = ROOT / "local" / "e2e"
PASSWORD = "e2e-owner-password"
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)


def prepare() -> Settings:
    import psycopg
    env = _load_env()
    admin = dict(host=env.get("PGHOST", "127.0.0.1"), port=int(env.get("PGPORT", "54328")), user=env["PGUSER"], password=env["PGPASSWORD"])
    with psycopg.connect(dbname="postgres", autocommit=True, **admin) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        conn.execute(f"CREATE DATABASE {TEST_DB}")
    os.environ.update({"PGHOST": admin["host"], "PGPORT": str(admin["port"]), "PGUSER": admin["user"], "PGPASSWORD": admin["password"], "PGDATABASE": TEST_DB})
    database.configure(8)
    with database.transaction() as cursor:
        database.apply_schema(cursor)
        auth.create_user(cursor, "owner.e2e", "Owner", PASSWORD, "owner")
    settings = dataclasses.replace(
        Settings.from_environment(), media_root=Path(tempfile.mkdtemp(prefix="album_e2e_")),
        web_origins=(BASE,), api_port=API_PORT,
    )
    AlbumRequestHandler.settings = settings
    AlbumRequestHandler.login_limiter = auth.RateLimiter(per_minute=10_000)
    SETTING_CACHE.clear()
    api = logs.QuietThreadingHTTPServer(("127.0.0.1", API_PORT), AlbumRequestHandler)
    threading.Thread(target=api.serve_forever, daemon=True).start()
    WebHandler.api_port = API_PORT
    WebHandler.api_sources = f"http://127.0.0.1:{API_PORT}"
    web = logs.QuietThreadingHTTPServer(("127.0.0.1", WEB_PORT), functools.partial(WebHandler, directory=str(WEB_ROOT)))
    threading.Thread(target=web.serve_forever, daemon=True).start()

    def worker():
        while True:
            try:
                if not jobs.run_one(settings, "e2e-worker"):
                    time.sleep(0.3)
            except Exception as exc:  # noqa: BLE001
                print("worker error", exc, flush=True)
                time.sleep(1)

    threading.Thread(target=worker, daemon=True).start()
    return settings


def sample_files() -> list[Path]:
    folder = Path(tempfile.mkdtemp(prefix="album_e2e_files_"))
    sizes = [(1200, 800), (800, 1200), (1600, 900), (900, 1200), (1200, 1200), (1400, 700)]
    files = []
    for i, size in enumerate(sizes):
        path = folder / f"SEOYUN_0912_{i:04d}.jpg"
        path.write_bytes(sample_jpeg(color=(40 + i * 30, 80, 150 - i * 15), size=size, marker=100 + i))
        files.append(path)
    return files


def no_null_text(page, name: str) -> None:
    """조건부 자식이 "null"·"undefined" 글자로 화면에 나오지 않는지 확인한다."""
    text = page.evaluate("document.body.innerText")
    stray = [w for w in ("null", "undefined") if re.search(rf"(^|\s){w}(\s|$)", text)]
    check(f"{name}: null·undefined 글자 없음", not stray, ", ".join(stray))


def layout_checks(page, name: str) -> None:
    """Bloom 7.1: 모바일은 조작 요소 44px 이상, 데스크톱은 36px 이상(아이콘 버튼 40px)."""
    overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    check(f"{name}: 가로 넘침 없음", overflow <= 1, f"{overflow}px")
    no_null_text(page, name)
    mobile = page.viewport_size["width"] < 768
    minimum = 43.5 if mobile else 35.5
    small = page.evaluate(
        """() => [...document.querySelectorAll('button, a.btn, input:not([type=checkbox]):not([type=file]), select, .menu-item')]
          .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.visually-hidden, .skip-link'); })
          .filter(e => e.getBoundingClientRect().height < MIN)
          .map(e => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30))""".replace("MIN", str(minimum))
    )
    check(f"{name}: {'44' if mobile else '36'}px 미만 조작 요소 없음", not small, ", ".join(small[:6]))


def run() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    prepare()
    files = sample_files()
    console_errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        # 테스트 도구의 대기 함수가 앱의 CSP(script-src 'self')에 막히지 않도록 테스트 컨텍스트에서만 우회한다.
        context = browser.new_context(viewport={"width": 1440, "height": 900}, locale="ko-KR", bypass_csp=True)
        page = context.new_page()
        # 401(로그인 전 확인)과 409(일부러 올린 중복 사진)는 예상된 응답이다.
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" and not re.search(r"status of (401|409)", m.text) else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))
        page.set_default_timeout(15000)

        # 1. 로그인 전: 사진·모델 정보 없음, 로그인 화면으로 이동
        page.goto(f"{BASE}/pages/albums.html")
        page.wait_for_url(re.compile(r"/login\.html"))
        check("로그인 전 앱 화면 접근 → 로그인 화면", "/login.html" in page.url)
        check("로그인 화면에 사진 없음", page.locator("img").count() == 0)
        page.wait_for_selector("#login-id")
        no_null_text(page, "로그인")
        page.fill("#login-id", "owner.e2e")
        page.fill("#password", "wrong-password-1")
        page.click("button[type=submit]")
        expect(page.locator(".notice-error")).to_contain_text("Incorrect username or password")
        check("잘못된 비밀번호 안내", True)
        page.fill("#password", PASSWORD)
        page.click("button[type=submit]")

        page.wait_for_url(re.compile(r"/pages/albums\.html"))
        check("로그인 후 원래 화면으로 복귀", True)

        # 3. 빈 홈 → 모델·앨범 만들기
        page.goto(f"{BASE}/")
        page.wait_for_selector("text=No models yet")
        check("빈 홈 안내", True)
        page.click("text=Add model")
        page.fill("dialog input[name=name]", "Seoyun Han")
        page.fill("dialog input[name=stage_name]", "Seoyun")
        page.click("dialog button[type=submit]")
        page.wait_for_selector("dialog", state="detached")
        page.goto(f"{BASE}/pages/albums.html")
        page.click("text=Create album")
        page.fill("dialog input[name=title]", "Autumn Seongsu Studio")
        page.fill("dialog input[name=shot_on]", "2026-09-12")
        page.fill("dialog input[name=location]", "Seongsu-dong, Seoul")
        page.click("dialog button[type=submit]")
        page.wait_for_url(re.compile(r"/pages/album\.html\?id="))
        album_url = page.url
        album_id = album_url.split("id=")[1].split("&")[0]
        check("앨범 생성 후 앨범 화면 이동", True)

        # 4. 업로드
        page.goto(f"{BASE}/manage/upload.html?album={album_id}")
        check("퀵 업로드 2단 화면(빠른 등록·등록 확인)", page.locator("#registerPanel").count() == 1 and page.locator("#reviewPanel").count() == 1)
        check("앨범 미리 선택", page.locator("#album").input_value() == album_id)
        page.set_input_files("#files", [str(f) for f in files])
        expect(page.locator(".quick-status")).to_contain_text("Done: 6 photos saved · 0 skipped · 0 failed", timeout=60000)
        check("여러 장은 순서대로 저장 후 요약 표시", True)
        page.wait_for_function("document.querySelectorAll('.quick-review-card .badge-success').length === 2", timeout=60000)
        check("등록 확인: 최근 2장 표시·처리 완료", page.locator(".quick-review-card").count() == 2)
        check("등록 확인 개수 (2/6)", "(2/6)" in page.locator("#review-title").inner_text())
        page.set_input_files("#files", [str(files[0])])
        expect(page.locator(".quick-status")).to_contain_text("Skipped: the same photo")
        check("중복 사진 건너뜀 안내", "is-skipped" in page.locator(".quick-status").get_attribute("class"))
        # 4-1. 클립보드 이미지 붙여넣기 (Ctrl+V와 같은 paste 이벤트)
        paste_png = """(color) => {
          const canvas = document.createElement('canvas');
          canvas.width = 640; canvas.height = 400;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = color; ctx.fillRect(0, 0, 640, 400);
          return new Promise((resolve) => canvas.toBlob((blob) => {
            const data = new DataTransfer();
            data.items.add(new File([blob], 'image.png', { type: 'image/png' }));
            document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
            resolve(true);
          }, 'image/png'));
        }"""
        page.evaluate(paste_png, "#2a9d8f")
        expect(page.locator(".quick-status")).to_contain_text("Saved: clipboard-", timeout=30000)
        page.wait_for_function("document.querySelector('.quick-review-card h3')?.textContent.startsWith('clipboard-')", timeout=30000)
        check("클립보드 이미지 붙여넣기 즉시 저장", True)
        page.wait_for_function("document.querySelector('.quick-review-card .badge-success') && document.querySelector('.quick-review-card h3').textContent.startsWith('clipboard-') && document.querySelector('.quick-review-card').querySelector('.badge-success')", timeout=30000)
        check("붙여넣은 사진 처리 완료 표시 (Processing → Ready)", True)
        page.fill("#review-search", "clipboard")
        check("등록 확인 검색", page.locator(".quick-review-card").count() == 1)
        page.fill("#review-search", "")
        page.click("#reviewPanel button:has-text('Today only')")
        check("오늘 등록만 전환", page.locator("#reviewPanel button:has-text('Today only')").get_attribute("aria-pressed") == "true")
        page.evaluate("""() => { const data = new DataTransfer(); data.setData('text/plain', 'hello');
          document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }""")
        expect(page.locator(".quick-status")).to_contain_text("The clipboard has no image")
        check("이미지 없는 붙여넣기 안내", True)
        page.screenshot(path=OUT / "02-upload.png", full_page=True)

        # 5. 앨범 감상
        page.goto(album_url)
        page.wait_for_selector(".flow-item img.loaded")
        check("앨범 사진 흐름 7장(붙여넣기 포함)", page.locator(".flow-item").count() == 7)
        check("앨범 표지 제목", page.locator("#album-title").inner_text() == "Autumn Seongsu Studio")
        img_src = page.locator(".flow-item img").first.get_attribute("src")
        check("사진은 API /media 경로로만 제공", f":{API_PORT}/media/" in img_src)
        page.screenshot(path=OUT / "03-album-desktop.png")
        layout_checks(page, "앨범(데스크톱)")

        # 6. 뷰어
        page.locator(".flow-item a").first.click()
        page.wait_for_selector(".pswp--open")
        page.wait_for_timeout(600)  # 열림 전환이 끝난 뒤 키 입력
        check("뷰어 열림 + URL photo 반영", "photo=" in page.url)
        page.keyboard.press("ArrowRight")
        expect(page.locator(".pswp__counter")).to_have_text("2 / 7")
        check("방향키로 다음 사진", True)
        page.keyboard.press("f")
        page.wait_for_selector("text=Added to favorites.")
        check("F 키 즐겨찾기", True)
        page.keyboard.press("i")
        page.wait_for_selector(".viewer-info dt:text('Taken')")
        check("I 키 정보 패널(촬영 정보)", "September 12, 2026" in page.locator(".viewer-info").inner_text())
        page.screenshot(path=OUT / "04-viewer-info.png")
        page.keyboard.press("Escape")
        page.keyboard.press("Escape")
        page.wait_for_selector(".pswp", state="detached")
        check("Esc로 뷰어 닫힘 + URL photo 제거", "photo=" not in page.url)

        # 6-1. 앨범 화면에서 바로 붙여넣기 → 이 앨범에 업로드
        page.evaluate(paste_png, "#e76f51")
        expect(page.locator(".quick-status.floating")).to_contain_text("Saved: clipboard-", timeout=30000)
        page.wait_for_function("document.querySelectorAll('.flow-item').length === 8", timeout=15000)
        check("앨범 화면 붙여넣기 → 앨범에 추가", True)

        # 7. 편집 모드: 2장 선택 → 휴지통
        page.click("button[aria-label='Album menu']")
        page.click(".menu-item:has-text('Edit')")
        items = page.locator(".flow-item a")
        items.nth(4).click()
        items.nth(5).click()
        expect(page.locator(".bulk-bar .count")).to_have_text("2 selected")
        page.click(".bulk-bar button:has-text('Move to trash')")
        page.wait_for_selector("text=Moved 2 photos to trash.")
        page.wait_for_function("document.querySelectorAll('.flow-item').length === 6")
        check("편집 모드 일괄 휴지통 이동", True)
        page.click("#edit-done")

        # 8. 휴지통 복원
        page.goto(f"{BASE}/manage/trash.html")
        page.wait_for_selector(".trash-item")
        check("휴지통 2장", page.locator(".trash-item").count() == 2)
        page.locator(".trash-item").first.locator("button:has-text('Restore')").click()
        page.wait_for_selector("text=Restored 1 item.")
        check("휴지통 복원", page.locator(".trash-item").count() == 1)

        # 9. 검색·즐겨찾기·모델
        page.goto(f"{BASE}/pages/search.html?q=Seongsu")
        page.wait_for_selector(".cover-card")
        check("검색: 앨범 찾기", "Autumn Seongsu Studio" in page.locator("main").inner_text())
        page.goto(f"{BASE}/pages/favorites.html")
        page.wait_for_selector(".flow-item")
        check("즐겨찾기 1장", page.locator(".flow-item").count() == 1)
        page.goto(f"{BASE}/pages/models.html")
        page.wait_for_selector(".model-card")
        page.click(".model-card")
        page.wait_for_selector("#model-name")
        check("모델 화면", page.locator("#model-name").inner_text() == "Seoyun Han")

        # 10. 홈 (히어로)
        page.goto(f"{BASE}/")
        page.wait_for_selector(".hero img.loaded")
        check("홈 히어로 표시", page.locator("#hero-title").inner_text() == "Autumn Seongsu Studio")
        page.screenshot(path=OUT / "05-home-desktop.png")

        # 11. 화면 가리기
        page.keyboard.press("Shift+H")
        check("Shift+H 화면 가림", page.locator(".privacy-shield").is_visible())
        page.keyboard.press("Shift+H")
        check("Shift+H 다시 표시", not page.locator(".privacy-shield").is_visible())

        # 12. 잠금 → 비밀번호로 해제
        page.click("button[aria-label='Open menu']")
        page.click(".menu-item:has-text('Lock now')")
        page.wait_for_url(re.compile(r"lock=1"))
        page.wait_for_selector("#unlock-password")
        check("잠금 화면", page.locator("img").count() == 0)
        page.fill("#unlock-password", PASSWORD)
        page.click("button[type=submit]")
        page.wait_for_url(re.compile(rf"{BASE}/(\?|$)"))
        check("비밀번호로 잠금 해제 후 복귀", True)

        # 13. 설정
        page.goto(f"{BASE}/manage/settings.html")
        page.wait_for_selector("#s-security")
        page.check("#blur")
        page.wait_for_selector("text=Settings saved.")
        check("설정: 썸네일 가리기", page.evaluate("document.documentElement.dataset.blur") == "true")
        page.uncheck("#blur")

        # 14. 모바일(390px)
        mobile = browser.new_context(viewport={"width": 390, "height": 844}, locale="ko-KR", has_touch=True, is_mobile=True, bypass_csp=True, storage_state=context.storage_state())
        m = mobile.new_page()
        m.on("pageerror", lambda e: console_errors.append(str(e)))
        for path, name, ready in [("/", "홈(모바일)", ".hero img"), (album_url.replace(BASE, ""), "앨범(모바일)", ".flow-item"), ("/pages/albums.html", "앨범 목록(모바일)", ".cover-card"),
                                  ("/pages/models.html", "모델 목록(모바일)", ".model-card"), ("/manage/upload.html", "업로드(모바일)", ".quick-dropzone"),
                                  ("/manage/trash.html", "휴지통(모바일)", ".trash-item"), ("/manage/settings.html", "설정(모바일)", "#s-security")]:
            m.goto(BASE + path)
            m.wait_for_selector(ready)
            m.wait_for_timeout(300)
            layout_checks(m, name)
        m.goto(album_url)
        m.wait_for_selector(".flow-item img.loaded")
        m.screenshot(path=OUT / "06-album-mobile.png")
        m.goto(f"{BASE}/")
        m.wait_for_selector(".hero img.loaded")
        m.screenshot(path=OUT / "07-home-mobile.png")

        # 15. 라이트 테마
        page.goto(f"{BASE}/")
        page.evaluate("localStorage.setItem('album-theme', 'light')")
        page.goto(album_url)
        page.wait_for_selector(".flow-item img.loaded")
        check("라이트 테마 적용", page.evaluate("document.documentElement.dataset.theme") == "light")
        page.screenshot(path=OUT / "08-album-light.png")
        page.evaluate("localStorage.removeItem('album-theme')")

        # 16. 로그아웃 후 사진 URL 차단
        page.goto(f"{BASE}/")
        page.click("button[aria-label='Open menu']")
        page.click(".menu-item:has-text('Sign out')")
        page.wait_for_url(re.compile(r"/login\.html"))
        status = page.evaluate(f"fetch('{img_src}', {{credentials: 'include'}}).then(r => r.status)")
        check("로그아웃 후 사진 요청 401", status == 401, str(status))

        check("브라우저 콘솔 오류 없음", not console_errors, " | ".join(console_errors[:5]))
        browser.close()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} / {len(results)} 통과, 스크린샷: {OUT}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(run())
