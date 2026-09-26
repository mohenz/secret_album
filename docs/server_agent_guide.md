# 운영 서버 에이전트 작업 가이드

- 기준일: 2026-09-27
- 읽는 대상: 운영 서버(`192.168.0.2`)에서 실행되는 AI 코딩 에이전트(Claude Code, Codex 등)
- 목적: 비밀앨범을 운영 서버에 처음 구성하고, 이후 운영 작업(재배포·점검·장애 대응)을 안전하게 수행한다.
- 함께 볼 문서: `docs/operations_guide.md`(운영 전반), `docs/system_design.md`(구조)

이 문서를 처음부터 끝까지 읽은 뒤 작업한다. 0장의 금지 사항은 사용자가 명시적으로 허락하지 않는 한 어떤 이유로도 어기지 않는다.

---

## 0. 절대 규칙

| 금지 | 이유 |
|---|---|
| 다른 서비스의 프로세스·포트·설정을 멈추거나 바꾸기 (특히 Gitea `3000`, cinetube 웹 `8080`·API `3001`·DB) | 같은 서버의 운영 서비스다 |
| Gitea 설정(`app.ini`)·서비스·다른 저장소의 훅 수정 | 비밀앨범 훅은 `admin\secret_album.git\hooks\post-receive.d\secret-album` 하나만 다룬다 |
| `local\` 폴더(DB·사진·`album.env`·백업)를 git에 올리기, 서버 밖으로 복사하기 | 개인 사진과 비밀값이 들어 있다 |
| 비밀번호·`album.env` 값·Gitea 자격 증명을 화면 출력·로그·문서·커밋에 남기기 | 키 이름과 존재 여부만 보고한다 |
| 사진 파일을 열어 보거나 내용을 묘사하기, 스크린샷에 실제 사진 담기 | 비공개 앨범이다. 확인은 개수·크기·HTTP 상태로만 한다 |
| `local\postgres-data` 직접 삭제, `DROP DATABASE secret_album`, `pg_ctl` 직접 실행 | DB는 `scripts\start_local_db.ps1`·`restore_album.ps1`로만 다룬다 |
| 서버 작업 트리에서 코드 수정 후 커밋·push | 코드 변경은 개발 PC에서만 한다. 서버는 받기만 한다 |
| 실패한 명령을 원인 확인 없이 같은 방식으로 반복 | 최초 오류를 분류하고 고친 뒤 다시 실행한다 |

판단이 필요한 상황(데이터 삭제, 다른 서비스와 포트 충돌, 복원 덮어쓰기)에서는 멈추고 사용자에게 선택지를 번호로 제시한다.

---

## 1. 환경 사실

| 항목 | 값 |
|---|---|
| 서버 | Windows, 내부망 `192.168.0.2` |
| 작업 경로 | `E:\workspace\secret_album` (다르면 모든 명령의 경로를 바꾼다) |
| Gitea | `http://192.168.0.2:3000`, 저장소 `admin/secret_album`(비공개), 브랜치 `main` |
| Python | 3.14, 가상환경 `.venv` (다른 버전 금지) |
| PostgreSQL | 18, 도구 `C:\Program Files\PostgreSQL\18\bin`, 전용 클러스터 `local\postgres-data`, 포트 `127.0.0.1:54328` |
| 웹 화면 | `http://192.168.0.2:8090` (`scripts\web_server.py`, `web\`만 제공) |
| API | `http://192.168.0.2:3051` (`scripts\local_api.py`) |
| Worker | `scripts\local_worker.py` (포트 없음, 사진 파생 이미지 생성) |
| 자동 시작 | 예약 작업 `SecretAlbum-Supervisor` (부팅 시 + 1분마다 `scripts\supervisor.ps1`) |
| 비밀값 | `local\album.env` (DB 비밀번호 등, 자동 생성) |
| 로그 | `local\` 아래 `supervisor.log`, `api.log`, `worker.log`, `web.log`, `postgres.log`, `deploy.log`, `backup.log` |
| 같은 서버의 다른 서비스 | Gitea `3000`, cinetube `8080`·`3001` — 건드리지 않는다 |

---

## 2. 작업 A — 최초 구성

사용자가 "서버에 설치/구성해 줘"라고 하면 이 장을 수행한다. 관리자 권한 PowerShell이 필요하다.

### 2.1 사전 확인 (읽기만)

```powershell
whoami; [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')
git --version
Test-Path 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe'
py -3.14 --version
Get-NetTCPConnection -LocalPort 8090,3051,54328 -State Listen -ErrorAction SilentlyContinue
Get-CimInstance Win32_Service | Where-Object Name -like '*gitea*' | Select-Object Name, State, StartName
Test-Path E:\workspace\secret_album
```

판정:

- 관리자가 아니면 중단하고 사용자에게 관리자 PowerShell로 다시 열어 달라고 한다.
- 8090·3051·54328 중 하나라도 비밀앨범이 아닌 프로세스가 쓰고 있으면 중단하고 보고한다(포트를 바꾸지 않는다).
- Gitea 서비스 실행 계정(`StartName`)을 기록한다. 2.3의 `-ServiceUser` 결정에 쓴다.
- `E:\workspace\secret_album`이 이미 있으면 새로 clone하지 않는다. `git -C E:\workspace\secret_album status -sb`로 상태만 확인한다.

### 2.2 코드 받기

```powershell
git clone http://192.168.0.2:3000/admin/secret_album.git E:\workspace\secret_album
```

Gitea 로그인이 필요하다. 자격 증명은 사용자에게 받고, 어디에도 기록하지 않는다. clone에 성공하면 자격 증명이 Windows 자격 증명 관리자에 저장되어 2.3의 데이터 다운로드에 재사용된다.

### 2.3 설치 스크립트 실행

에이전트는 암호 입력 창에 응답할 수 없으므로 감시 작업 계정을 `SYSTEM`으로 지정해 무인으로 실행한다.

```powershell
$env:SECRET_ALBUM_NONINTERACTIVE = '1'
powershell -NoProfile -ExecutionPolicy Bypass -File E:\workspace\secret_album\deploy\server_setup.ps1 -ServiceUser SYSTEM
```

`-ServiceUser` 결정:

| Gitea 서비스 계정 | 선택 |
|---|---|
| `LocalSystem` | `-ServiceUser SYSTEM` (배포 훅과 같은 계정이라 권장) |
| 특정 사용자 계정 | 사용자가 직접 실행하도록 안내: `-ServiceUser "<그 계정>"` (암호 입력 필요) |

스크립트 단계와 성공 표시(`OK`):

1. 사전 확인 — Python 3.14가 없으면 winget으로 설치한다.
2. `.venv`와 패키지
3. DB 준비, `album.env`에 내부망 접속 값 추가
4. 데이터 — Gitea 초안 릴리스 `data-migration`의 zip을 받아 복원한다. 이미 데이터가 있으면 건너뛴다.
5. 방화벽, 배포 훅, 감시 작업
6. `/ready` 200, 화면 200, 로그인 없이 `/albums` 401, `/local/album.env` 404

선택 인자:

| 인자 | 쓸 때 |
|---|---|
| `-Bundle <zip 경로>` | 사용자가 이전 zip을 직접 서버에 옮겨 둔 경우 |
| `-NoData` | 사용자가 새로 시작하라고 한 경우. 소유자 계정 생성에서 입력이 필요하므로 사용자가 직접 실행한다 |
| `-GiteaRepoRoot <경로>` | "Gitea 저장소 폴더를 찾지 못했습니다" 오류가 난 경우. 경로는 Gitea `app.ini`의 `[repository] ROOT` 값(읽기만) |

스크립트는 다시 실행해도 된 단계는 건너뛴다. 실패하면 2.5의 표로 원인을 분류하고, 고친 뒤 같은 명령으로 다시 실행한다.

### 2.4 설치 후 검증 (모두 통과해야 완료)

```powershell
Get-ScheduledTask SecretAlbum-Supervisor | Select-Object TaskName, State
Get-NetTCPConnection -LocalPort 8090,3051,54328 -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3051/ready | Select-Object StatusCode, Content
(Invoke-WebRequest -UseBasicParsing http://192.168.0.2:8090/login.html).StatusCode
try { Invoke-WebRequest -UseBasicParsing http://192.168.0.2:3051/albums } catch { [int]$_.Exception.Response.StatusCode }   # 401이어야 한다
Test-Path "<2.3 출력의 '배포 훅:' 경로>"   # True여야 한다
Get-Content E:\workspace\secret_album\local\supervisor.log -Tail 10
```

데이터 복원 확인 (개수만 본다):

```powershell
Set-Location E:\workspace\secret_album
& .\scripts\load_album_env.ps1 -Path .\local\album.env
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h $env:PGHOST -p $env:PGPORT -U $env:PGUSER -d $env:PGDATABASE -tAc "SELECT 'models=' || (SELECT count(*) FROM models WHERE deleted_at IS NULL) || ' albums=' || (SELECT count(*) FROM albums WHERE deleted_at IS NULL) || ' photos=' || (SELECT count(*) FROM photos WHERE deleted_at IS NULL) || ' pending_jobs=' || (SELECT count(*) FROM background_jobs WHERE status IN ('queued','running'))"
Remove-Item Env:PGPASSWORD
```

2026-09-27 이전 zip 기준 기대값: `models=1 albums=1 photos=20`. `pending_jobs`는 Worker가 파생 이미지를 만들면서 몇 분 안에 0이 된다.

### 2.5 실패 분류

| 오류 메시지 / 현상 | 원인 | 조치 |
|---|---|---|
| `관리자 PowerShell에서 실행해 주세요` | 권한 | 사용자에게 관리자 창을 요청 |
| `PostgreSQL 18 도구가 없습니다` | PG 18 미설치 | 중단하고 보고. 설치는 사용자 승인 후 PostgreSQL 18 공식 설치 프로그램으로 기본 경로(`C:\Program Files\PostgreSQL8`)에 한다 |
| `Python 3.14 설치를 확인하지 못했습니다` | winget 실패·PATH 미반영 | 새 PowerShell 창에서 `py -3.14 --version` 확인 후 재실행 |
| `포트 N 를 다른 프로그램이 쓰고 있습니다` | 포트 충돌 | 중단하고 보고. 다른 서비스를 멈추지 않는다 |
| `DB 시작 실패` | `local\postgres.log` 확인 | 54328 충돌, 데이터 폴더 권한 문제를 보고 |
| `Gitea 자격 증명이 없습니다` | clone 자격 증명 미저장 | 사용자에게 로그인 clone을 요청하거나 `-Bundle` 사용 |
| `릴리스 'data-migration'에 이전 파일이 없습니다` | 이미 삭제됨 | 사용자에게 `-Bundle` zip 또는 `-NoData` 중 선택을 요청 |
| `DB 복원 실패` | 덤프 손상·버전 | `local\backups\before_restore_*.dump`가 남아 있다. 보고 후 지시를 기다린다 |
| `Gitea 저장소 폴더(admin\secret_album.git)를 찾지 못했습니다` | 저장소 루트가 비표준 위치 | `app.ini`에서 `[repository] ROOT`를 읽어 `-GiteaRepoRoot`로 재실행 |
| `확인 실패` (6단계) | 서비스 미기동 | `local\supervisor.log`, `local\api.error.log`, `local\web.error.log` 마지막 30줄을 보고 원인 분류 |

### 2.6 마무리

1. 모두 통과하면 사용자에게 보고한다 (6장 형식).
2. Gitea 초안 릴리스 `data-migration`(개인 사진 포함) 삭제를 **사용자에게 요청**한다. 에이전트가 직접 지우지 않는다.
3. 서버의 `local\transfer\` 안 zip은 복원 확인 후 사용자 동의를 받아 지운다.

---

## 3. 작업 B — 배포 확인과 수동 재배포

정상 흐름: 개발 PC가 `git push gitea main` → Gitea 훅이 `deploy\deploy.ps1` 실행 → 결과가 `local\deploy.log`에 남는다.

```powershell
Get-Content E:\workspace\secret_album\local\deploy.log -Tail 20
git --git-dir="<Gitea 저장소 루트>\admin\secret_album.git" log -1 --oneline main
```

`deploy.log` 마지막 실행이 실패했거나 훅이 동작하지 않았으면, 원인을 고친 뒤 한 번만 수동 재배포한다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File E:\workspace\secret_album\deploy\deploy.ps1 -GitDir "<Gitea 저장소 루트>\admin\secret_album.git" -Branch main
```

작업 트리만 그대로 다시 띄우려면 `-SkipCheckout`을 쓴다. `deploy.ps1`은 새 마이그레이션이 있으면 먼저 DB를 백업한다.

---

## 4. 작업 C — 일상 점검

| 확인 | 명령 | 정상 |
|---|---|---|
| 서비스 | `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3051/ready` | 200, `{"status":"ready"}` |
| 감시 작업 | `Get-ScheduledTask SecretAlbum-Supervisor` | `Ready` 또는 `Running` |
| 감시 로그 | `Get-Content local\supervisor.log -Tail 20` | 반복 재시작 기록이 없음 |
| 사진 처리 적체 | 2.4의 `pending_jobs` 쿼리 | 0 또는 줄어드는 중 |
| 디스크 | `Get-PSDrive E` | 여유 10% 이상 |
| 백업 | `Get-Content local\backup.log -Tail 5` | 최근 날짜의 성공 기록 |

백업 예약 작업이 없으면(`Get-ScheduledTask SecretAlbum-Backup`) 사용자에게 백업 디스크 경로를 묻고 `docs/operations_guide.md` 4.1대로 등록한다.

---

## 5. 작업 D — 장애 대응

순서: 증상 확인 → 로그 마지막 30줄 → 원인 분류 → 가장 작은 조치 → 2.4 검증.

| 증상 | 먼저 볼 것 | 조치 |
|---|---|---|
| 사이트 접속 불가 | 포트 Listen 여부, `supervisor.log` | 감시 작업이 1분 안에 다시 띄운다. 멈춰 있으면 `Start-ScheduledTask SecretAlbum-Supervisor` |
| `/ready`가 `not_ready` | `postgres.log`, `api.error.log` | `scripts\start_local_db.ps1` 실행 |
| 사진이 계속 Processing | `worker.log` | 감시 작업이 Worker를 다시 띄운다. 멈춘 작업은 15분 뒤 자동 회수 |
| 파생 이미지 누락 | — | `.\.venv\Scripts\python.exe scripts\rebuild_derived.py --missing` |
| 배포 후 오류 | `deploy.log` | 원인 분류 후 보고. 되돌리기는 개발 PC에서 커밋으로 한다 |

유지보수 중에는 감시 작업이 서비스를 다시 띄우지 않도록 먼저 끄고, 끝나면 켠다.

```powershell
schtasks /Change /TN "SecretAlbum-Supervisor" /DISABLE
# 작업
schtasks /Change /TN "SecretAlbum-Supervisor" /ENABLE
```

복원(`restore_album.ps1 -Apply`)은 현재 DB를 덮어쓴다. 반드시 사용자 승인 후 `docs/operations_guide.md` 4.3 절차로만 한다.

---

## 6. 보고 형식

작업이 끝나면 사용자에게 한국어로 다음을 보고한다. 비밀값·사진 내용은 넣지 않는다.

```text
작업: (최초 구성 / 재배포 / 점검 / 장애 대응)
결과: 성공 | 실패 | 사용자 결정 필요
확인:
  - /ready 200, 화면 200, 로그인 없이 /albums 401, /local/album.env 404
  - 감시 작업 상태, 포트 8090·3051·54328
  - 데이터 개수 (models / albums / photos / pending_jobs)
접속 주소: http://192.168.0.2:8090
남은 일: (예: Gitea 초안 릴리스 data-migration 삭제 — 사용자 작업)
실패 시: 단계, 최초 오류 메시지 한 줄, 확인한 로그, 제안 조치(번호 선택지)
```
