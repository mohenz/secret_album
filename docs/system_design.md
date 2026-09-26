# 비밀앨범 시스템 설계서

## 0. 문서 정보

| 항목 | 내용 |
|---|---|
| 프로젝트 | 비밀앨범 (`D:\workspace\secret_album`) |
| 버전 | 0.2 초안 (2026년 9월 26일) |
| 개정 사유 | 사용자 지시: 아키텍처를 **cinetube 프로젝트와 동일하게** 구성 (v0.1의 Next.js·Caddy 구성 폐기) |
| 기준 문서 | `docs/design_request.md` v0.2 (갤러리형 디자인 요청서) |
| 참조 아키텍처 | `D:\workspace\cinetube` — `README.md`, `docs/new_pc_setup_guide.md`, `docs/local_api_operations.md`, `docs/local_api_worker.md`, `docs/gitea_development_environment.md`, `docs/internal_git_developer_guide.md`, `docs/windows_server_operations_plan_20260914.md` |
| 운영 형태 | 내부망 Windows 서버 전용. 인터넷 공개 없음 |

## 1. 목표와 범위

### 1.1 목표

1. 모델별·앨범별 사진을 내부 서버에 보관하고, 디자인 요청서의 갤러리형 감상 경험을 웹으로 제공한다.
2. 로그인하지 않은 사람은 사진 파일에 **어떤 경로로도** 접근할 수 없다.
3. cinetube와 같은 구성·같은 운영 방식으로 만들어, 같은 서버·같은 절차로 개발·배포·운영한다.

### 1.2 1차 범위

| 포함 | 제외(후속 검토) |
|---|---|
| 로그인, 자동 잠금 (2단계 인증은 D4 결정으로 제외) | 인터넷 공개, 외부 공유 링크 |
| 모델·앨범·사진·태그 관리, 즐겨찾기 | 동영상 |
| 대량 업로드, 썸네일·표시용 이미지 자동 생성, EXIF 추출 | 얼굴 인식, AI 자동 태그 |
| 갤러리 감상 화면, 사진 뷰어, 슬라이드쇼, 검색 | 모바일 앱 |
| 편집 모드(일괄 작업), 휴지통 | 열람자 화면(데이터 모델만 반영) |
| 백업·복원 스크립트, Gitea 자동 배포 | 여러 서버 분산 실행 |

### 1.3 규모 가정

| 항목 | 가정 | 설계 여유 |
|---|---|---|
| 사용자 | 소유자 1명 (+ 열람자 최대 10명) | — |
| 앨범 / 사진 | 1,000개 / 5만 장, 원본 평균 12MB | 1만 개 / 50만 장 |
| 저장 용량 | 원본 600GB + 파생 이미지 약 15% | 디스크 확장 |
| 동시 접속 | 3명 이하 | 20명 |

## 2. 전체 구성 (cinetube와 동일한 3계층 + Worker)

```text
[브라우저 (PC·휴대폰, 내부망)]
   │                                   │
   │ 화면 파일(HTML·CSS·JS)            │ API 호출 + 사진 요청 (세션 쿠키)
   ▼                                   ▼
[정적 웹서버 :8090]                 [Python 로컬 API :3051]
 python -m http.server               ThreadingHTTPServer
 --directory web                     scripts/local_api.py → scripts/album_api/
 (화면 파일만, 사진 없음)                 │                    │
                                        ▼                    ▼
                          [PostgreSQL :54328]      [local/media (원본·파생 이미지)]
                           local/postgres-data            ▲
                                        ▲                    │
                                        │                    │
                          [Worker: scripts/local_worker.py (background_jobs 큐)]
```

| 계층 | cinetube | 비밀앨범 |
|---|---|---|
| 프론트엔드 | Vanilla HTML·CSS·JS, 화면별 HTML + 화면별 진입 JS, `python -m http.server 8080` | 같음. 포트 `8090`, **웹 루트를 `web/` 폴더로 한정** (6.2) |
| 백엔드 API | Python 표준 라이브러리 `ThreadingHTTPServer`, `scripts/local_api.py` + `scripts/cinetube_api/` 계층 패키지, 포트 3001 | 같음. `scripts/album_api/`, 포트 `3051` |
| DB | 프로젝트 전용 PostgreSQL 데이터 디렉터리 `local/postgres-data`, 포트 54322, `local/schema.sql` + 마이그레이션 SQL | 같음. 포트 `54328` |
| 파일 저장소 | `local/media/`, Pillow로 300px WebP 썸네일 | 같음. 파생 이미지 3종(thumb·medium·large) |
| 백그라운드 작업 | `scripts/local_worker.py` + `background_jobs` 테이블(`FOR UPDATE SKIP LOCKED`) | 같음. 업로드 사진 처리를 기본 비동기로 사용 |
| 실행 | `start-cinetube.cmd` / `stop-cinetube.cmd` / `ct.cmd` | `start-album.cmd` / `stop-album.cmd` / `sa.cmd` |
| 운영 서버 | 내부망 Windows 서버 `192.168.0.2`, `E:\workspace\cinetube` | 같은 서버, `E:\workspace\secret_album` (결정 D1) |
| 배포 | Gitea `main` push → post-receive 훅 → 작업 트리 갱신 + API 재시작 | 같음. Gitea 저장소 `admin/secret_album` |
| 프로세스 유지 | `CineTube-API-Supervisor` 예약 작업 | 같음. API와 **Worker 모두** 감시(12.3) |

Docker·Node 빌드 도구는 쓰지 않는다. 서버에는 PostgreSQL과 Python만 설치한다.

## 3. 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 런타임 | Python 3.14.x | 프로젝트 `.venv`를 실행·테스트의 단일 기준으로 사용 |
| 프론트엔드 | Vanilla HTML·CSS·JavaScript (ES 모듈, 빌드 단계 없음) | cinetube와 같음 |
| 디자인 토큰 | Bloom 의미 토큰을 CSS 변수로 정의(`web/assets/css/tokens.css`), Light·Dark | shadcn neutral+blue 값을 가져와 매핑 |
| 글꼴 | Pretendard Variable (로컬 파일 `web/assets/fonts/`) | 내부망 전용이라 외부 CDN을 쓰지 않음 |
| 아이콘 | Lucide SVG (쓰는 아이콘만 `web/assets/icons/`에 복사) | cinetube의 Material Symbols는 쓰지 않음(Bloom 표준) |
| 사진 격자 | 저스티파이드 레이아웃 직접 구현(`shared/justified.js`, 약 80줄) + `IntersectionObserver` 지연 로드·가상화 | 외부 라이브러리 없음 |
| 사진 뷰어 | PhotoSwipe 5 (Vanilla ES 모듈, 로컬 복사본 `web/assets/vendor/photoswipe/`) | 스와이프·핀치 줌·키보드·접근성 기본 제공. 슬라이드쇼는 직접 구현 |
| Dialog·메뉴 | 네이티브 `<dialog>`, `popover` 속성 + 공통 `shared/ui.js` | Bloom 예외(결정 D2) |
| 백엔드 | Python **3.14** 표준 라이브러리 `http.server`, 프로젝트 전용 가상환경 `.venv` | cinetube는 Python 3.10. 비밀앨범은 3.14로 고정(2026-09-26 사용자 결정) |
| DB 드라이버 | `psycopg[binary]` 3.x + 자체 연결 풀 | cinetube `database.py` 구조 재사용 |
| 이미지 처리 | Pillow (WebP 생성, EXIF, 방향 보정) + `pillow-heif`(HEIC 지원 시) | cinetube는 Pillow로 썸네일 생성 |
| 비밀번호 | `argon2-cffi` (argon2id) | 신규(cinetube는 로그인 없음) |
| 테스트 | `unittest` (백엔드), `check_module_layers.py` (계층 검사), Playwright(화면 흐름, 개발 PC에서만) | cinetube와 같음 + 화면 흐름 |

`requirements.txt`:

```text
psycopg[binary]==3.3.4
Pillow==12.1.1
argon2-cffi
pillow-heif        # D5에서 HEIC 지원을 결정한 경우만
```

## 4. 프로젝트 구조

```text
secret_album/
├─ start-album.cmd / stop-album.cmd / sa.cmd   원클릭 실행·중지·짧은 실행
├─ requirements.txt
├─ README.md
├─ docs/                    design_request.md, system_design.md, 운영 문서
├─ web/                     ★ 정적 웹서버 루트 (이 폴더 밖은 웹으로 열리지 않음)
│  ├─ index.html            홈
│  ├─ login.html            로그인 · 잠금 해제
│  ├─ pages/
│  │  ├─ albums.html        앨범 목록
│  │  ├─ album.html         앨범 (?id=)
│  │  ├─ models.html        모델 목록
│  │  ├─ model.html         모델 (?id=)
│  │  ├─ favorites.html     즐겨찾기
│  │  └─ search.html        검색 결과 (?q=)
│  ├─ manage/
│  │  ├─ upload.html        업로드
│  │  ├─ trash.html         휴지통
│  │  └─ settings.html      설정
│  └─ assets/
│     ├─ css/               tokens.css(Bloom 토큰), base.css, gallery.css, manage.css
│     ├─ fonts/             Pretendard Variable
│     ├─ icons/             Lucide SVG
│     ├─ vendor/photoswipe/
│     ├─ img/               중립 파비콘
│     └─ js/
│        ├─ api-config.js   API 주소 결정 (cinetube local-db-config.js와 같은 방식)
│        ├─ pages/          화면별 진입 JS: home.js, albums.js, album.js, models.js, model.js,
│        │                  favorites.js, search.js, login.js, upload.js, trash.js, settings.js
│        └─ shared/         store.js(API 호출), ui.js(dialog·toast·메뉴), theme.js,
│                           justified.js, viewer.js(PhotoSwipe 래퍼·슬라이드쇼),
│                           privacy.js(화면 가리기·자동 잠금·백그라운드 가림), edit-mode.js
├─ scripts/
│  ├─ local_api.py          API 진입점 (Handler 재노출 + 서버 실행)
│  ├─ local_worker.py       백그라운드 작업 Worker
│  ├─ check_module_layers.py
│  ├─ start_local_db.ps1 / stop_local_db.ps1 / launch_album.ps1
│  ├─ api_supervisor.ps1 / register_api_supervisor.ps1
│  ├─ admin_create.py       최초 소유자 계정 생성 (웹 가입 없음)
│  ├─ backup_album.ps1 / restore_album.ps1
│  ├─ rebuild_derived.py    원본에서 파생 이미지 재생성
│  └─ album_api/
│     ├─ config.py          환경변수, 경로, 크기 제한, 세션·잠금 시간
│     ├─ tables.py          CRUD 화이트리스트, 검색 컬럼, 정렬 허용값
│     ├─ database.py        연결 풀, run_sql
│     ├─ queries.py         필터·검색·정렬·페이지네이션
│     ├─ repository.py      모델·앨범·사진·태그·즐겨찾기·휴지통 CRUD
│     ├─ auth.py            비밀번호, 세션 발급·검증·만료, 로그인 실패 제한
│     ├─ media.py           안전 경로, 업로드 저장, 파생 이미지 생성, EXIF, 사진 전달
│     ├─ jobs.py            background_jobs 큐 + 작업 핸들러 등록
│     └─ handler.py         라우팅, 인증 검사, CORS, JSON 응답, 처리시간 로그
├─ local/                   ★ git 제외, 웹 루트 밖
│  ├─ schema.sql            신규 클러스터 초기 스키마
│  ├─ migrations/           NNN_설명.sql (반복 실행 안전)
│  ├─ postgres-data/        DB 데이터 디렉터리
│  ├─ media/                사진 저장소 (5장)
│  ├─ uploads/              업로드 임시 파일
│  ├─ backups/              DB 덤프
│  └─ *.log                 postgres.log, api.*.log, worker.*.log, web.*.log, deploy.log
└─ tests/                   test_auth.py, test_media.py, test_queries.py, test_handler_api.py,
                            test_jobs.py, test_jobs_live.py, fixtures/
```

### 4.1 API 모듈 의존 방향 (cinetube 규칙 그대로)

```text
config / tables → database → queries → repository / auth / media → jobs → handler → local_api.py
```

하위 계층은 상위 계층을 import하지 않는다. 같은 계층 예외는 `media → repository`만 허용하고, `scripts/check_module_layers.py`로 강제한다.

## 5. 파일 저장소

### 5.1 디렉터리

```text
local/media/
├─ originals/<yyyy>/<mm>/<photo_id>.<원본 확장자>   원본 (수정하지 않음)
└─ derived/<photo_id 앞 2글자>/<photo_id>/
   ├─ thumb.webp     긴 변 480px  q75   격자·커버
   ├─ medium.webp    긴 변 1600px q82   모바일 뷰어·히어로
   └─ large.webp     긴 변 3200px q85   데스크톱 뷰어·확대 (원본보다 크게 만들지 않음)
```

- 파일 이름에는 사용자 입력(원본 파일명)을 쓰지 않고 `photo_id`(UUID)만 쓴다. 원본 파일명은 DB에만 저장.
- 파생 이미지는 EXIF를 제거(GPS 포함)하고 방향은 픽셀에 반영한다. 원본에서 언제든 재생성 가능(`rebuild_derived.py`).
- cinetube 운영 규칙과 같이, 이미지 관련 작업 결과는 추정하지 않고 **DB 값과 실제 파일 존재 여부를 함께 확인**해 보고한다.
- 서버 디스크는 BitLocker 암호화(결정 D7).

### 5.2 DB 연결 방식

cinetube의 `media_assets` 테이블(파일 경로·썸네일 URL 저장) 대신, 사진 파일 경로는 `photo_id`로 **서버가 계산**한다. DB에는 경로·URL을 저장하지 않는다. 경로 조작 여지를 없애고, 저장소 위치를 옮겨도 DB를 고칠 필요가 없게 하기 위함이다.

## 6. 보안 설계 (cinetube와 가장 크게 다른 부분)

cinetube는 로그인 없는 로컬 서비스이고 `local/media`를 정적 웹서버로 그대로 공개한다. 비밀앨범은 같은 구조를 쓰되 아래를 반드시 추가·변경한다.

### 6.1 로그인·세션·잠금

| 항목 | 설계 |
|---|---|
| 계정 | 최초 소유자는 서버에서 `.\.venv\Scripts\python.exe scripts\admin_create.py`로 1회 생성. 웹 가입 화면 없음 |
| 비밀번호 | argon2id, 최소 10자 |
| 2단계 인증 | 쓰지 않음 (D4, 2026-09-26 사용자 결정: 개인용 사이트) |
| 로그인 실패 | 계정별 5회 실패 → 10분 잠금, IP별 분당 요청 제한. 오류 문구는 아이디 존재 여부를 드러내지 않음 |
| 세션 | 256bit 무작위 토큰 쿠키 `album_session`(`HttpOnly; SameSite=Strict; Path=/`, HTTPS 적용 시 `Secure`). DB에는 SHA-256 해시만 저장 |
| 수명 | 절대 만료 14일, 서버 측 유휴 만료 = 자동 잠금 설정값(기본 15분) |
| 잠금 해제 | 비밀번호 재입력 |
| 권한 | `owner`: 전체 / `viewer`: `album_shares`에 있는 앨범 조회·즐겨찾기만 |

화면(8090)과 API(3051)는 **같은 호스트, 다른 포트**다. 브라우저 기준 같은 사이트이므로 `SameSite=Strict` 쿠키가 API 호출(`fetch(..., {credentials: "include"})`)과 `<img src="http://<호스트>:3051/media/...">` 요청 모두에 실린다.

### 6.2 사진 파일 보호

| cinetube 방식 | 비밀앨범 방식 | 이유 |
|---|---|---|
| 정적 웹서버 루트 = 프로젝트 루트 | 정적 웹서버 루트 = `web/` (`python -m http.server 8090 --directory web`) | 프로젝트 루트를 공개하면 `local/media`, `local/backups`, 로그, `.git`까지 웹으로 열림 |
| 사진을 정적 파일 URL(`/local/media/...`)로 제공 | 사진은 API의 `GET /media/<photo_id>/<종류>`로만 제공. 매 요청 세션·권한 검사 후 파일 스트리밍 | 로그인 없이 사진 접근 차단 |

`/media` 응답 헤더:

```text
Content-Type: image/webp (원본은 실제 형식)
Cache-Control: private, no-cache             (브라우저가 보관하되 매번 세션을 재확인, 304. "캐시 사용 안 함" 선택 시 no-store)
ETag: "<photo_id>-<종류>-<sha256 앞 12자>"
X-Content-Type-Options: nosniff
Content-Disposition: inline  (원본 다운로드 시 attachment + 원본 파일명)
```

- `photo_id`는 UUID 형식만 허용하고, 종류는 `thumb|medium|large|original`만 허용한다. 파일 경로는 서버가 조합하고 결과 경로가 `local/media` 안인지 다시 확인한다(cinetube `resolve_media_path`와 같은 방식).
- 세션이 없으면 401, 열람자가 공유받지 않은 앨범의 사진을 요청하면 404.

### 6.3 API 공통 보안

| 항목 | cinetube | 비밀앨범 |
|---|---|---|
| CORS | `Access-Control-Allow-Origin: *` | 설정된 웹 출처만(`http://<서버>:8090`, 개발 시 `http://localhost:8090`) + `Access-Control-Allow-Credentials: true` |
| 인증 | 없음 | `/auth/login`·`/auth/otp`·`/health` 외 모든 경로에서 세션 필수 |
| 변경 요청 검사 | 없음 | `POST·PATCH·PUT·DELETE`는 `Origin` 헤더가 허용 출처인지 확인(CSRF 방지) |
| 요청 크기 | 64MB JSON 본문 | JSON 1MB, 업로드는 파일당 200MB(설정) |
| 보안 헤더 | 없음 | API·정적 웹 모두 `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` (정적 웹서버는 `http.server` 확장 핸들러 `scripts/web_server.py`로 헤더 추가) |
| 수신 주소 | API `0.0.0.0` | API·웹 `0.0.0.0`(내부망 접속용), DB는 `127.0.0.1`만 |
| 방화벽 | 8080·3001 인바운드 허용 | 8090·3051만 **내부망 대역(192.168.0.0/24)** 허용, 54328 차단 |
| 전송 암호화 | HTTP | 1차 HTTP(내부망). 비밀번호·사진이 평문으로 오가므로 HTTPS 적용은 결정 D3 |

### 6.4 화면 쪽 프라이버시 기능

| 기능 | 구현 (`shared/privacy.js`) |
|---|---|
| 화면 가리기 | `Shift+H`·헤더 버튼 → 불투명 오버레이, 사진 `<img>` 숨김 |
| 백그라운드 가림 | `visibilitychange`·`blur`에서 즉시 가림 |
| 자동 잠금 | 입력 없음 타이머 → 30초 전 안내 → `login.html?lock=1`로 이동. 서버 세션도 유휴 만료 |
| 썸네일 가리기 | 설정값에 따라 `filter: blur(24px)`, 탭한 사진만 해제 |
| 중립적 탭 정보 | 모든 HTML `<title>`은 고정 이름, 중립 파비콘 |
| 로그인 확인 | 모든 화면 진입 JS가 먼저 `GET /auth/me` → 401이면 로그인 화면으로 이동. 화면 파일 자체에는 사진·모델 정보가 없음 |

## 7. 데이터 모델

`local/schema.sql`로 초기화하고, 이후 변경은 `local/migrations/NNN_*.sql`(반복 실행 안전, `if not exists`)로 적용한다. cinetube와 같은 방식이다.

```text
users          id(uuid), login_id(unique), display_name, password_hash, role('owner'|'viewer'),
               failed_login_count, locked_until, disabled_at, created_at, updated_at
sessions       id(토큰 SHA-256), user_id, created_at, last_seen_at, expires_at,
               user_agent, ip, revoked_at
models         id, name, stage_name, bio, cover_photo_id, is_favorite, deleted_at, created_at, updated_at
albums         id, model_id, title, description, shot_on(date), location, cover_photo_id,
               visibility('private'|'shared'), deleted_at, created_at, updated_at
photos         id, album_id, model_id, original_filename, mime_type, byte_size, sha256(unique),
               width, height, taken_at, camera, lens, exposure(jsonb), exif(jsonb),
               dominant_color, caption, is_pause(쉼표 사진), position(numeric),
               status('processing'|'ready'|'failed'), error, deleted_at, created_at, updated_at
tags           id, name(unique)
photo_tags     photo_id, tag_id
favorites      user_id, photo_id, created_at
album_shares   album_id, user_id, can_download
app_settings   key, value(jsonb)       자동 잠금 시간, 휴지통 보관 일수, 캐시 정책 등
audit_logs     id, user_id, action, target_type, target_id, detail(jsonb), ip, created_at
background_jobs  cinetube와 같은 구조 (id, job_type, status, payload, result, error,
                 attempts, max_attempts, run_after, locked_by, locked_at, started_at,
                 finished_at, created_at, updated_at)
```

인덱스:

- `photos(album_id, position) where deleted_at is null` — 앨범 흐름
- `photos(model_id, taken_at desc)`, `photos(taken_at desc)`, `albums(model_id, shot_on desc)`
- `pg_trgm` 확장 + GIN trigram 인덱스: `models.name`, `models.stage_name`, `albums.title`, `tags.name`, `photos.caption` — 한국어 부분 일치 검색

삭제 정책: 휴지통 이동은 `deleted_at` 기록. 보관 기간(기본 30일)이 지나면 Worker의 `trash.purge` 작업이 DB 행과 원본·파생 파일을 함께 삭제하고 감사 로그를 남긴다.

## 8. 처리 흐름

### 8.1 업로드

cinetube는 이미지를 data URL(JSON)로 보내지만, 사진 원본은 크고 개수가 많아 **파일 하나당 요청 하나로 바이너리를 그대로 전송**한다.

```text
1. 화면(upload.html): 모델·앨범 선택 → 파일마다
   PUT /uploads?album_id=<id>&filename=<원본명>   본문 = 파일 바이너리, 동시 3개
2. API
   - 세션(owner)·Origin 확인, Content-Length ≤ 제한
   - local/uploads/<임시 id>로 스트리밍 저장하면서 SHA-256 계산
   - 매직 넘버로 형식 검사 (JPEG·PNG·WebP, D5 결정 시 HEIC)
   - 같은 sha256이 있으면 409 + 기존 사진 id (화면에서 "건너뛰기/그래도 추가")
   - originals/로 이동 → photos 행 생성(status=processing)
   - background_jobs에 photo.process 등록 → 202 {photo_id, job_id}
   - DB 등록 실패 시 기록한 파일 삭제 (cinetube media.py의 보상 처리와 같음)
3. Worker: photo.process
   - Pillow로 열기 → EXIF 추출(촬영일·카메라·렌즈·노출) → 방향 보정
   - thumb·medium·large WebP 생성, width·height·대표 색상 저장 → status=ready
   - 실패 시 cinetube 재시도 규칙(30초 → 120초 → 600초, 최대 3회), 최종 실패는 status=failed + error
4. 화면: GET /uploads/status?ids=... 를 2초마다 조회해 파일별 상태 표시
```

- 앨범의 첫 사진이 준비되면 자동으로 커버 지정.
- 파생 이미지가 준비되기 전 격자에는 `dominant_color` 자리표시를 쓴다(준비 전에는 회색).

### 8.2 Worker 작업 종류

| job_type | 내용 |
|---|---|
| `photo.process` | 파생 이미지·EXIF·색상 (업로드마다) |
| `photo.rebuild` | 파생 이미지 재생성 (규격 변경 시) |
| `trash.purge` | 보관 기간 지난 항목 영구 삭제 (매일 1회 예약) |
| `session.cleanup` | 만료 세션 삭제 (매일 1회) |
| `jobs.cleanup` | 7일 지난 성공 작업 삭제 (cinetube 운영 문서의 정리 SQL 자동화) |

Worker는 cinetube `local_worker.py`와 같은 옵션(`--once`, `--concurrency`, `--recover-stale`)을 제공한다. 동시 처리 기본값은 `CPU 코어 수 - 1`(최대 4), DB 풀 크기보다 작게 유지한다.

### 8.3 화면 데이터 흐름

- 모든 화면은 `shared/store.js`의 함수로만 API를 호출한다(cinetube `store.js`와 같은 역할).
- API 주소는 `api-config.js`가 결정: 접속한 호스트 이름 그대로 `:3051`을 붙인다(cinetube의 사설 IP 판정 방식 재사용, 클라우드 분기는 제거).
- 앨범 화면: `GET /albums/<id>/photos`로 레이아웃용 최소 필드(id·width·height·dominant_color·is_pause)를 한 번에 받고, `justified.js`로 행을 계산한 뒤 화면에 보이는 행만 `<img srcset>`을 채운다(5천 장 앨범 대응).
- 뷰어: PhotoSwipe에 medium·large를 `srcset`으로 전달, 앞뒤 2장 미리 로드.

## 9. API

cinetube와 같이 JSON 응답, 오류는 `{ "error": { "code", "message" } }`. `message`는 한국어로 원인과 다음 행동을 포함한다.

| 메서드·경로 | 기능 | 권한 |
|---|---|---|
| `GET /health` | 프로세스 상태 | 없음 |
| `GET /ready` | DB 연결·저장소 쓰기 가능 여부 | 없음(상세 정보 미포함) |
| `POST /auth/login` · `/auth/unlock` · `/auth/lock` · `/auth/logout` | 로그인, 잠금 해제, 잠금, 로그아웃 | 없음 / 세션 |
| `GET /auth/me` | 현재 사용자·권한 | 세션 |
| `GET /home` | 히어로·최근 앨범·모델 (홈 한 번에) | 세션 |
| `GET·POST /models`, `GET·PATCH·DELETE /models/<id>` | 모델 | 조회 세션, 변경 owner |
| `GET·POST /albums`, `GET·PATCH·DELETE /albums/<id>` | 앨범 (`?sort=shot_desc&model_id=`) | 조회 세션, 변경 owner |
| `GET /albums/<id>/photos` | 앨범 사진 레이아웃 목록 | 세션(열람자는 공유 앨범만) |
| `GET·PATCH /photos/<id>` | 사진 정보, 캡션·태그·쉼표 여부 | 조회 세션, 변경 owner |
| `POST /photos/bulk` | 일괄: `favorite`, `tag`, `move`, `set_cover`, `set_pause`, `trash`, `reorder` | owner (`favorite`은 세션) |
| `PUT·DELETE /favorites/<photo_id>` | 즐겨찾기 | 세션 |
| `GET /favorites` | 즐겨찾기 목록 | 세션 |
| `GET /search?q=` | 모델·앨범·태그·사진 통합 검색 | 세션 |
| `PUT /uploads?album_id=&filename=` · `GET /uploads/status?ids=` | 업로드, 처리 상태 | owner |
| `GET /trash` · `POST /trash/restore` · `DELETE /trash` | 휴지통 | owner |
| `GET·PATCH /settings` | 설정 | owner |
| `GET /jobs` · `/jobs/<id>` · `/jobs/stats` | 작업 상태 (cinetube와 같음) | owner |
| `GET /media/<photo_id>/<thumb\|medium\|large\|original>` | 사진 전달 (6.2) | 세션 + 앨범 권한, original은 owner 또는 `can_download` |

API 계약 상세는 구현 단계에서 `docs/local_api_contract.md`로 분리한다(cinetube와 같은 문서 구성).

## 10. 환경과 포트

| 항목 | 개발 PC | 운영 서버 |
|---|---|---|
| 경로 | `D:\workspace\secret_album` | `E:\workspace\secret_album` (D1) |
| 정적 웹 | `http://localhost:8090` | `http://192.168.0.2:8090` |
| API | `http://localhost:3051` | `http://192.168.0.2:3051` |
| PostgreSQL | `127.0.0.1:54328`, DB `secret_album` | 같음(서버 내부만) |
| 저장소 | `local/media` | `local/media` (사진 디스크가 따로 있으면 `ALBUM_MEDIA_ROOT`로 변경) |

포트 8090·3051·54328은 워크스페이스 `development_systems.csv`에서 사용 중이지 않음을 확인했다(2026-09-26). 운영 서버에서 다른 서비스와 겹치지 않는지 배포 전에 다시 확인한다.

환경 변수(`scripts/album_api/config.py`, cinetube `config.py`와 같은 방식):

```text
PGHOST=127.0.0.1  PGPORT=54328  PGUSER=album_app  PGPASSWORD=***  PGDATABASE=secret_album
ALBUM_API_HOST=0.0.0.0          ALBUM_API_PORT=3051
ALBUM_WEB_ORIGINS=http://192.168.0.2:8090,http://localhost:8090
ALBUM_MEDIA_ROOT=<비우면 local/media>
ALBUM_MAX_UPLOAD_BYTES=209715200
ALBUM_SESSION_IDLE_MINUTES=15   ALBUM_SESSION_MAX_DAYS=14
ALBUM_DB_POOL_SIZE=8            ALBUM_WORKER_CONCURRENCY=3
ALBUM_SLOW_REQUEST_MS=1000
```

비밀값은 서버의 `local/album.env`(git 제외)에만 두고, 실행 스크립트가 읽어 환경 변수로 설정한다. cinetube처럼 DB `postgres` 계정을 앱이 쓰지 않고, 앱 전용 `album_app` 역할(자기 DB 권한만)을 만든다.

## 11. 개발 실행과 검증

```powershell
cd D:\workspace\secret_album
py -3.14 -m venv .venv                               # 최초 1회: Python 3.14 가상환경
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\sa                                                 # DB → API → Worker → 웹 기동, 브라우저 열기
.\.venv\Scripts\python.exe scripts\admin_create.py # 최초 1회 소유자 계정 생성
.\stop-album.cmd                                     # 전체 중지
```

`launch_album.ps1`는 cinetube `launch_cinetube.ps1`와 같은 순서로 동작한다: `start_local_db.ps1`(최초 실행 시 `initdb` + 스키마 적용) → API → Worker → 정적 웹서버 → 브라우저 열기 → 내부망 주소 안내.

검증:

```powershell
.\.venv\Scripts\python.exe -m compileall -q scripts tests
.\.venv\Scripts\python.exe scripts\check_module_layers.py
.\.venv\Scripts\python.exe -m unittest discover -s tests -t .
```

| 테스트 | 범위 |
|---|---|
| `test_auth_live.py` | 비밀번호 로그인, 세션 만료·유휴 잠금, 로그인 실패 잠금, Origin·쿠키 |
| `test_media.py` | 안전 경로, 매직 넘버 검사, 파생 이미지 크기·EXIF 제거·방향 보정, 보상 처리 |
| `test_handler_api.py` | 무세션 401, 열람자 권한 404, CORS 허용 출처, Origin 검사, 오류 형식 |
| `test_queries.py` | 검색·정렬·페이지네이션 SQL 조립 |
| `test_jobs.py` / `test_jobs_live.py` | 큐 선점·중복 방지·재시도 (DB 없으면 skip) |
| Playwright(개발 PC) | 로그인→앨범→뷰어, 업로드, 편집 모드 일괄 작업, 휴지통, 화면 가리기, 모바일 390px 넘침·44px 검사 |

테스트는 운영 DB와 `local/media`를 쓰지 않는다(cinetube 규칙).

## 12. 배포와 운영 (cinetube와 같은 절차)

### 12.1 Gitea

| 항목 | 값 |
|---|---|
| 저장소 | `http://192.168.0.2:3000/admin/secret_album.git` (신규 생성) |
| 원격 | `gitea`만 등록. 비공개 사진 앨범이므로 GitHub 원격은 두지 않음(결정 D8) |
| 배포 브랜치 | `main` |

개발 PC에서:

```powershell
.\.venv\Scripts\python.exe scripts\check_module_layers.py
.\.venv\Scripts\python.exe -m unittest discover -s tests -t .
git switch main
git pull --ff-only gitea main
git merge --ff-only <검토한 개발 브랜치>
git push gitea main
```

서버 post-receive 훅(cinetube 훅을 복제):

1. 작업 트리를 `main`으로 갱신(clean reset, `local/`은 git 제외라 보존)
2. `local/migrations/`에 새 파일이 있으면 적용 전 DB 덤프 → 마이그레이션 적용 (cinetube는 마이그레이션이 자동 배포 범위 밖이었음 — 비밀앨범은 훅에 포함하되 실패 시 중단)
3. API·Worker 프로세스 종료 → 감시 예약 작업이 새 코드로 재기동
4. `/health` 200 확인, 무세션 `/media`·`/albums` 요청이 401인지 확인
5. 결과를 `local/deploy.log`에 기록하고 push 콘솔에 출력

Git push 성공과 서버 배포 성공은 따로 확인한다(cinetube 문서와 같음).

### 12.2 백업

| 대상 | 방식 | 주기 | 보관 |
|---|---|---|---|
| DB | `pg_dump -Fc` → `local/backups/` 후 백업 디스크로 복사 | 매일 03:00 (예약 작업) | 30일 |
| 원본 사진 | `robocopy local\media\originals <백업 디스크> /MIR` | 매일 03:30 | 백업 디스크 |
| 파생 이미지 | 백업하지 않음(`rebuild_derived.py`로 재생성) | — | — |
| `local/album.env` | 오프라인 보관 | 변경 시 | — |

분기마다 별도 폴더에 복원해 로그인·사진 열람까지 확인한다. cinetube에서 DB 데이터 디렉터리 손상(`postgres-data.corrupt-*`) 이력이 있었으므로 **DB 덤프 백업은 1차 범위에 반드시 포함**한다.

### 12.3 프로세스 유지·모니터링

- `register_api_supervisor.ps1`로 `SecretAlbum-Supervisor` 예약 작업 등록(부팅 시 + 1분마다 자기 복구). cinetube 감시 스크립트와 같은 이유(배포 훅·에이전트 셸에서 띄운 프로세스가 호출자 종료 시 함께 종료되는 문제)로, 배포 훅은 프로세스를 죽이기만 하고 재기동은 감시 작업이 맡는다.
- cinetube는 API만 감시하지만, 비밀앨범은 업로드 처리가 Worker에 의존하므로 **API와 Worker를 모두 감시**한다. 정적 웹서버와 PostgreSQL도 같은 작업에서 살아 있는지 확인한다.
- 로그: `local/api.*.log`, `worker.*.log`, `web.*.log`, `postgres.log`, `supervisor.log`, `deploy.log`. 일 단위 순환, 14일 보관.
- 감사 로그(`audit_logs`): 로그인 성공·실패, 비밀번호 변경, 영구 삭제, 원본 다운로드, 설정 변경.
- 디스크 여유 10% 미만이면 설정 화면과 로그에 경고.

## 13. 보안 점검 목록

- [ ] 정적 웹서버 루트가 `web/`이고, `local/`·`scripts/`·`.git`이 웹으로 열리지 않는다
- [ ] `/media/*`와 인증 외 API의 무세션 요청은 401, 공유되지 않은 앨범은 404
- [ ] 파일 경로는 `photo_id`로 서버가 조합하고 저장소 밖으로 벗어나지 않는다
- [ ] 업로드는 매직 넘버 검사·크기 제한, 원본 파일명을 경로에 쓰지 않는다
- [ ] 파생 이미지에 GPS 등 EXIF가 없다
- [ ] 비밀번호 argon2id, 세션 토큰은 해시 저장, 로그인 실패 제한
- [ ] CORS는 허용 출처만, 변경 요청은 Origin 검사
- [ ] DB는 127.0.0.1만, 방화벽은 8090·3051을 내부망 대역만 허용
- [ ] 앱은 `postgres`가 아닌 `album_app` 역할로 접속
- [ ] 비밀값은 `local/album.env`에만 있고 git에 없다 (`git add -A --dry-run`으로 확인)
- [ ] 서버 디스크·백업 디스크 암호화

## 14. 개발 단계

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 0. 기반 | 폴더 구조, `start/stop` 스크립트, 전용 DB 초기화, `album_api` 골격(config·database·handler), Worker 골격, `/health`·`/ready`, 계층 검사 | `.\sa`로 DB·API·Worker·웹 기동, ready 200 |
| 1. 인증 | `admin_create.py`, 로그인·세션·잠금 해제, CORS·Origin 검사, 로그인 화면 | 무세션 401·실패 잠금 테스트 통과 |
| 2. 업로드·처리 | `PUT /uploads`, `photo.process`, 중복 검사, 업로드 화면, `/media` 전달 | 사진 100장 업로드 후 전부 ready, 무세션 `/media` 401 |
| 3. 감상 화면 | Bloom 토큰·글꼴·아이콘, 홈·앨범 목록·앨범·모델·뷰어·슬라이드쇼 | 디자인 요청서 14장 검토 기준 통과 |
| 4. 관리 | 편집 모드 일괄 작업, 등록 폼, 휴지통, 설정, 검색·즐겨찾기 | Playwright 관리 흐름 통과 |
| 5. 프라이버시·보안 | `privacy.js`, 보안 헤더, 13장 점검 | 점검 목록 전 항목 확인 |
| 6. 운영 | Gitea 저장소·훅, 감시 예약 작업, 백업·복원 스크립트, 방화벽 | 서버 재부팅 후 자동 복구, 복원 연습 통과, 다른 기기에서 열람 확인 |

## 15. cinetube 대비 차이점 요약

| 번호 | 차이 | 이유 |
|---|---|---|
| X1 | 정적 웹서버 루트를 `web/`으로 한정 | cinetube 방식(프로젝트 루트 공개)이면 사진·백업·로그가 웹으로 노출됨 |
| X2 | 사진을 API `/media`로만 전달 | 로그인 없이 사진 접근 차단 |
| X3 | 로그인·세션·자동 잠금 추가 | 비공개 앨범 요구사항 (cinetube는 로그인 해제 상태) |
| X4 | CORS `*` → 허용 출처 + 쿠키, Origin 검사 | 쿠키 인증과 CSRF 방지 |
| X5 | 업로드를 data URL JSON 대신 파일 바이너리 전송 | 원본 사진 크기·개수 |
| X6 | `media_assets` 경로 저장 대신 `photo_id`로 경로 계산 | 경로 조작 차단, 저장소 이동 용이 |
| X7 | 업로드 처리는 기본 비동기(Worker) | cinetube는 동기 기본 + 선택적 비동기 |
| X8 | 감시 작업이 API와 Worker 모두 관리 | 업로드 처리가 Worker에 의존 |
| X9 | 배포 훅에 마이그레이션 포함(적용 전 덤프) | cinetube는 자동 배포 범위 밖 |
| X10 | Material Symbols·Inter·Google Fonts 대신 Lucide·Pretendard 로컬 파일 | Bloom UI 표준, 내부망 전용 |
| X11 | Vercel·Supabase·크롬 확장 관련 구성 없음 | 내부 서버 전용, 외부 연동 없음 |
| X12 | GitHub 원격 없음 | 비공개 사진 앨범 (결정 D8) |

## 16. 결정 필요 사항

| 번호 | 항목 | 제안 |
|---|---|---|
| D1 | 운영 서버 | cinetube와 같은 `192.168.0.2`, 경로 `E:\workspace\secret_album`. 사진 디스크 용량(원본 600GB 가정) 확인 필요 |
| D2 | **Bloom 표준의 Radix UI 기반 예외** | Bloom은 Radix(React) 기반을 요구하지만 cinetube 구성은 Vanilla JS라 Radix를 쓸 수 없다. 네이티브 `<dialog>`·`popover`와 공통 `ui.js`로 대체하고, 포커스 가두기·복귀·`Esc` 닫기·`aria-*`를 직접 보장하는 예외로 기록할 것을 제안. 토큰·글꼴·아이콘·간격·문구·접근성 규칙은 그대로 준수 |
| D3 | HTTPS | 1차는 cinetube와 같이 HTTP. 내부망이라도 무선 구간에서 비밀번호·사진이 평문으로 오가므로, 6단계에서 HTTPS(내부 인증서) 적용을 권장 |
| D4 | 2단계 인증 필수 여부 | **결정: 쓰지 않음** (2026-09-26, 개인용 사이트) |
| D5 | HEIC(아이폰 사진) 지원 | `pillow-heif` 추가로 가능. 지원 권장 |
| D6 | 열람자 기능 | 데이터 모델만 반영, 화면은 2차 |
| D7 | 디스크 암호화 | 서버 사진 디스크·백업 디스크 BitLocker 권장 |
| D8 | 원격 저장소 | Gitea만 사용, GitHub 원격 없음 권장. 2026-09-26 현재 사용자 지시로 GitHub 공개 저장소 `mohenz/secret_album`(`origin`)에 배포되어 있어 유지 여부 결정 필요 |
| D9 | 휴지통 보관 기간 | 30일 |
| D10 | 디자인 요청서 표준 예외 E1~E6 | 디자인 요청서 13장과 함께 결정 |
