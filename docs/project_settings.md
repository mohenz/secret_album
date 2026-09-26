# 비밀앨범 프로젝트 설정

- 기준일: 2026년 9월 26일
- 단계: 기획·설계 (코드 없음)
- 이 문서는 지금까지 정한 프로젝트 설정을 한곳에 모은 요약이다. 세부 내용은 각 원본 문서가 우선한다.

## 1. 기본 정보

| 항목 | 값 |
|---|---|
| 프로젝트명 | 비밀앨범 |
| project_key | `secrete_album` (폴더명 철자 그대로) |
| 목적 | 모델 사진을 보관·관리하고 감상하는 **갤러리형 비공개 앨범 웹사이트** |
| 운영 형태 | 내부망 Windows 서버 전용, 인터넷 공개 없음 |
| 개발 경로 | `D:\workspace\secrete_album` |
| 운영 경로(제안) | 서버 `192.168.0.2`의 `E:\workspace\secrete_album` |
| git | 아직 저장소 없음. 워크스페이스 저장소에서도 추적하지 않음 |

## 2. project_control 등록

| 항목 | 값 |
|---|---|
| 레지스트리 | `project_control/project_registry.md` 38행 |
| 별칭 | `secrete_album`, `secrete album`, `secret_album`, `secret album`, `비밀앨범`, `비밀 앨범` |
| 상태 파일 | `project_control/states/secrete_album_current.md` |
| 커밋 | project_control 저장소에 커밋하지 않음 |

> 레지스트리 항목과 상태 파일은 등록 당시(디자인 요청서 v0.1) 내용이다. 이후 결정된 **갤러리형 방향(v0.2)과 cinetube 동일 아키텍처는 아직 반영되지 않았다.**

## 3. 문서

| 파일 | 내용 | 상태 |
|---|---|---|
| `docs/design_request.md` | 디자인 작업 요청서 v0.2 — 갤러리형 감상 중심, 감상/관리 영역 분리, Bloom 표준 예외 E1~E6 | 초안, 결정 대기 |
| `docs/system_design.md` | 시스템 설계서 v0.2 — cinetube와 동일한 아키텍처 | 초안, 결정 대기 |
| `docs/project_settings.md` | 이 문서 | — |
| `design/design_request.md` | `docs/design_request.md` v0.2와 같은 내용의 사본 | — |
| `design/nocturne_monograph/DESIGN.md` | 외부 디자인 시안의 디자인 시스템 정의 (다크 계열 자체 팔레트) | 미검토 |
| `design/_1` ~ `design/_8`, `design/stitch_personal_gallery_album_web_app(.zip)` | 외부 디자인 시안 8화면 (`code.html` + `screen.png`) | 미검토 |
| `design_request.md` (루트) | Bloom UI 디자인 표준·설계 프로세스 원문 사본 | 사용자 정리 예정 |

## 4. 디자인 설정

| 항목 | 값 |
|---|---|
| 적용 표준 | Bloom UI 디자인 표준 (`project_control/design/bloom_ui_design_standard.md`), 설계 절차 (`bloom_ui_design_process.md`) |
| 방향 | 어두운 전시실 무드, 사진이 화면 가장자리까지 채우는 갤러리. 관리 기능은 편집 모드로 격리 |
| 영역 구분 | 감상 영역(표준 예외 E1~E6 적용) / 관리 영역(Bloom 표준 그대로, 다크 톤) |
| 글꼴 | Pretendard Variable (로컬 파일) |
| 아이콘 | Lucide만 사용 |
| 색상 | Bloom Neutral + Blue 의미 토큰. Blue는 포커스·편집 모드 주요 버튼·선택 표시에만 |
| 언어 | 사용자 노출 문구 전부 한국어 |

### 4.1 표준 예외 (승인 대기)

| 번호 | 내용 |
|---|---|
| E1 | 다크 테마 기본값 |
| E2 | 사진 뷰어 배경 어두운 색 고정 |
| E3 | 사진·커버 모서리 반경 0 |
| E4 | 디스플레이 제목 32~64px |
| E5 | 사진 위 글자용 하단 스크림 그라데이션 |
| E6 | 사진 그리드 좌우 여백 0, 사진 간격 2~4px |
| D2 | Radix UI 대신 네이티브 `<dialog>`·`popover` (Vanilla JS 구성 때문, 시스템 설계서 16장) |

## 5. 아키텍처 설정 (cinetube와 동일 구성)

| 계층 | 설정 |
|---|---|
| 화면 | Vanilla HTML·CSS·JS, 빌드 없음, 화면별 HTML + 화면별 진입 JS. 정적 웹서버 `python -m http.server 8090 --directory web` |
| API | Python 표준 `ThreadingHTTPServer`, 진입점 `scripts/local_api.py`, 계층 패키지 `scripts/album_api/` |
| Worker | `scripts/local_worker.py` + `background_jobs` 테이블(`FOR UPDATE SKIP LOCKED`) |
| DB | PostgreSQL 전용 데이터 디렉터리 `local/postgres-data`, DB `secrete_album`, 앱 역할 `album_app` |
| 사진 저장소 | `local/media/originals`(원본) + `local/media/derived`(thumb 480·medium 1600·large 3200 WebP) |
| 사진 뷰어 | PhotoSwipe 5 (로컬 복사본) |
| 사진 격자 | 저스티파이드 레이아웃 직접 구현 |
| Python 패키지 | `psycopg[binary]` 3.3.4, `Pillow` 12.1.1, `argon2-cffi`, `pyotp`, (HEIC 지원 시) `pillow-heif` |
| 테스트 | `unittest`, `check_module_layers.py`, Playwright(개발 PC) |

### 5.1 cinetube와 다르게 가져가는 점

정적 웹 루트를 `web/`으로 한정, 사진은 API `/media`로만 전달, 로그인·2단계 인증·세션·자동 잠금 추가, CORS 허용 출처 제한, 업로드는 파일 바이너리 전송, 업로드 처리 기본 비동기, 감시 작업이 API·Worker 모두 관리, 배포 훅에 마이그레이션 포함, GitHub 원격 없음. (시스템 설계서 15장 X1~X12)

## 6. 포트와 주소

| 서비스 | 개발 PC | 운영 서버 |
|---|---|---|
| 정적 웹 | `http://localhost:8090` | `http://192.168.0.2:8090` |
| API | `http://localhost:3051` | `http://192.168.0.2:3051` |
| PostgreSQL | `127.0.0.1:54328` | `127.0.0.1:54328` (외부 차단) |

- 2026-09-26 기준 `project_control/project_docs/development_systems.csv`에서 사용 중이지 않음을 확인. **csv에는 아직 등록하지 않았다.**
- 방화벽: 8090·3051만 내부망 대역(`192.168.0.0/24`) 허용.

## 7. 환경 변수

비밀값은 `local/album.env`(git 제외)에만 둔다.

```text
PGHOST=127.0.0.1  PGPORT=54328  PGUSER=album_app  PGPASSWORD=***  PGDATABASE=secrete_album
ALBUM_API_HOST=0.0.0.0          ALBUM_API_PORT=3051
ALBUM_WEB_ORIGINS=http://192.168.0.2:8090,http://localhost:8090
ALBUM_MEDIA_ROOT=<비우면 local/media>
ALBUM_MAX_UPLOAD_BYTES=209715200
ALBUM_SESSION_IDLE_MINUTES=15   ALBUM_SESSION_MAX_DAYS=14
ALBUM_DB_POOL_SIZE=8            ALBUM_WORKER_CONCURRENCY=3
ALBUM_SLOW_REQUEST_MS=1000
```

## 8. 실행·검증·배포 명령 (구현 후 사용 예정)

```powershell
# 실행 / 중지
.\sa                     # DB → API → Worker → 웹 기동
.\stop-album.cmd
python scripts\admin_create.py   # 최초 소유자 계정 1회 생성

# 검증
python -m compileall -q scripts tests
python scripts\check_module_layers.py
python -m unittest discover -s tests -t .

# 배포 (Gitea main push → 서버 post-receive 훅)
git push gitea main
```

| 항목 | 값 |
|---|---|
| Gitea 저장소(제안) | `http://192.168.0.2:3000/admin/secrete_album.git` (미생성) |
| 배포 로그 | 서버 `local/deploy.log` |
| 프로세스 유지 | `SecreteAlbum-Supervisor` 예약 작업 (미등록) |
| 백업 | DB 매일 03:00 `pg_dump` 30일 보관, 원본 사진 매일 03:30 `robocopy /MIR` |

## 9. 결정 대기 항목

| 번호 | 항목 | 제안 |
|---|---|---|
| E1~E6 | 디자인 표준 예외 | 승인 |
| D1 | 운영 서버·사진 디스크 용량 | `192.168.0.2`, 원본 600GB 가정 |
| D2 | Radix UI 기반 예외 | 네이티브 `<dialog>`·`popover`로 대체 |
| D3 | HTTPS | 1차 HTTP, 운영 단계에서 HTTPS 권장 |
| D4 | 2단계 인증 필수 | 소유자 필수 |
| D5 | HEIC 지원 | 지원 (`pillow-heif`) |
| D6 | 열람자 기능 | 데이터 모델만, 화면은 2차 |
| D7 | 디스크 암호화 | BitLocker |
| D8 | 원격 저장소 | Gitea만 |
| D9 | 휴지통 보관 기간 | 30일 |
| — | 동영상 지원 | 1차 제외 |

## 10. 작업 이력

| 일자 | 내용 |
|---|---|
| 2026-09-26 | 디자인 작업 요청서 v0.1 작성 (Bloom 표준 기반) |
| 2026-09-26 | `project_control`에 프로젝트 등록, 상태 파일 생성 |
| 2026-09-26 | v0.1 기준 시안이 업무용 화면으로 나와 디자인 요청서 v0.2(갤러리형)로 재작성 |
| 2026-09-26 | 시스템 설계서 v0.1 작성 (Next.js 기반) |
| 2026-09-26 | 사용자 지시로 시스템 설계서 v0.2 작성 — cinetube와 동일한 아키텍처 |
| 2026-09-26 | 이 설정 문서 작성 |

## 11. 다음 작업

1. 9장 결정 대기 항목 확정
2. `design/` 외부 시안 8화면을 디자인 요청서 v0.2·Bloom 표준 기준으로 검토
3. `project_control` 레지스트리·상태 파일을 현재 설정으로 갱신, 포트를 `development_systems.csv`에 등록
4. git 저장소 초기화(`.gitignore`에 `local/` 포함), Gitea 저장소 생성
5. 시스템 설계서 14장 0단계(기반) 구현 착수
