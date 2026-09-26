# 비밀앨범 운영 가이드

- 기준일: 2026-09-26
- 대상: 내부망 Windows 운영 서버 (시스템 설계서 v0.2 12장 기준, cinetube와 같은 운영 방식)
- 함께 볼 문서: `docs/system_design.md`, `docs/other_pc_setup_guide.md`, `docs/server_agent_guide.md`(서버에서 AI 에이전트가 작업할 때)

## 1. 구성 요약

| 구성 요소 | 실행 | 포트 | 로그 |
|---|---|---|---|
| PostgreSQL 18 (전용 클러스터 `local/postgres-data`) | `scripts\start_local_db.ps1` | `127.0.0.1:54328` | `local\postgres.log` |
| API (`scripts\local_api.py`) | 감시 예약 작업 | `3051` | `local\api.log`, `api.error.log` |
| Worker (`scripts\local_worker.py`) | 감시 예약 작업 | 없음 | `local\worker.log`, `worker.error.log` |
| 정적 화면 (`scripts\web_server.py`, `web\`만 제공) | 감시 예약 작업 | `8090` | `local\web.log`, `web.error.log` |
| 감시 (`scripts\supervisor.ps1`) | 예약 작업 `SecretAlbum-Supervisor` | — | `local\supervisor.log` |

앱 로그는 자정마다 순환하고 14일 보관한다. 감사 기록(로그인, 영구 삭제, 원본 다운로드, 설정 변경)은 DB `audit_logs` 테이블에 남는다.

## 2. 최초 서버 구성

Gitea 저장소 `admin/secret_album`(비공개)은 개발 PC에서 만들어 두었다. 서버의 **관리자 PowerShell**에서 두 줄만 실행한다.

```powershell
git clone http://192.168.0.2:3000/admin/secret_album.git E:\workspace\secret_album
powershell -NoProfile -ExecutionPolicy Bypass -File E:\workspace\secret_album\deploy\server_setup.ps1
```

`deploy\server_setup.ps1`이 하는 일 (다시 실행해도 된 단계는 건너뛴다):

1. 사전 확인: 관리자 권한, Git, PostgreSQL 18(`C:\Program Files\PostgreSQL8in`), Python 3.14(없으면 winget 설치), 포트 8090·3051·54328
2. `.venv`와 패키지 설치
3. 전용 PostgreSQL 클러스터·DB 생성(`locallbum.env` 자동 생성)과 내부망 접속 값(`ALBUM_API_HOST`, `ALBUM_WEB_BIND`, `ALBUM_WEB_ORIGINS`) 추가
4. 개발 PC 데이터 이전: Gitea 비공개 초안 릴리스 `data-migration`의 zip(DB 덤프 + 원본 사진)을 받아 복원하고 화면용 이미지 재생성을 등록한다. 로그인 계정·비밀번호는 개발 PC와 같다.
5. 방화벽(같은 서브넷만), Gitea 저장소 `hooks\post-receive.d\secret-album` 배포 훅, 감시 예약 작업(실행 계정 암호를 묻는다)
6. `/ready` 200, 화면 200, 로그인 없이 `/albums` 401, `/local/album.env` 404 확인

선택 인자:

| 인자 | 용도 |
|---|---|
| `-ServiceUser "SERVERlbumsvc"` | 감시 예약 작업 실행 계정 (기본: 현재 사용자, 암호를 묻는다). `SYSTEM`이면 암호 없이 등록 |
| `-Bundle D:\secret_album_data_*.zip` | 이전 zip을 직접 지정 (USB 등으로 옮긴 경우) |
| `-NoData` | 데이터 없이 새로 시작하고 소유자 계정을 만든다 |
| `-GiteaRepoRoot <gitea-repositories 경로>` | Gitea 저장소 폴더 자동 탐색이 실패할 때 |

- 이전이 끝나면 Gitea 초안 릴리스 `data-migration`(개인 사진 포함)을 지운다.
- 이전 뒤에는 서버에서만 사진을 올린다. 개발 PC DB와 서버 DB는 동기화되지 않는다.
- 사진 디스크를 따로 쓰려면 실행 전에 `locallbum.env`에 `ALBUM_MEDIA_ROOT=F:\secret_album_media`를 넣는다.

접속: `http://192.168.0.2:8090`

## 3. 배포 (Gitea push)

1. 배포 훅은 `server_setup.ps1`이 설치한다 (`hooks/post-receive.d/secret-album`, LF).
2. 개발 PC에서 검증 후 push한다. 개발 PC에는 `gitea` 원격이 등록되어 있다.

```powershell
.\.venv\Scripts\python.exe scripts\check_module_layers.py
.\.venv\Scripts\python.exe -m unittest discover -s tests -t .
git push gitea main
```

`deploy/deploy.ps1`이 하는 일:

1. 작업 트리를 `main`으로 갱신 (`local\`은 git 제외라 보존)
2. `requirements.txt`가 바뀌었으면 패키지 설치
3. 새 마이그레이션이 있으면 **먼저 DB 백업** 후 적용
4. API·Worker·화면 종료 → 감시 예약 작업이 새 코드로 다시 시작
5. `/ready` 200 확인, **로그인 없이 `/albums`·`/media`가 401이고 `/local/album.env`가 404인지 확인**
6. 결과를 push 콘솔과 `local\deploy.log`에 기록. 확인 실패 시 종료 코드 1

Git push 성공과 배포 성공은 따로 확인한다. 수동 재배포: `.\deploy\deploy.ps1 -SkipCheckout`

## 4. 백업과 복원

### 4.1 매일 백업 (예약 작업으로 등록)

```powershell
.\scripts\backup_album.ps1 -BackupRoot F:\album-backup
```

- DB: `pg_dump -Fc` → `local\backups` + 백업 디스크 `db\`, 30일 보관, 덤프마다 `pg_restore --list`로 검증
- 원본 사진: `robocopy /MIR` → 백업 디스크 `originals\`
- 파생 이미지는 백업하지 않는다 (원본에서 재생성)
- 결과: `local\backup.log`

예약 작업 등록 예 (매일 03:00):

```powershell
$action = New-ScheduledTaskAction -Execute powershell.exe -Argument '-NoProfile -ExecutionPolicy Bypass -File E:\workspace\secret_album\scripts\backup_album.ps1 -BackupRoot F:\album-backup'
Register-ScheduledTask -TaskName 'SecretAlbum-Backup' -Action $action -Trigger (New-ScheduledTaskTrigger -Daily -At 3am) -User 'SERVER\albumsvc' -Password '<암호>'
```

### 4.2 복원 연습 (분기마다)

운영 DB를 건드리지 않고 임시 DB에 복원해 행 수를 비교한다.

```powershell
.\scripts\restore_album.ps1 -Dump local\backups\secret_album_YYYYMMDD_HHMMSS.dump -Verify
```

### 4.3 실제 복원

```powershell
schtasks /Change /TN "SecretAlbum-Supervisor" /DISABLE
.\stop-album.cmd
.\scripts\restore_album.ps1 -Dump F:\album-backup\db\secret_album_....dump -OriginalsFrom F:\album-backup\originals -Apply
schtasks /Change /TN "SecretAlbum-Supervisor" /ENABLE
.\.venv\Scripts\python.exe scripts\rebuild_derived.py --missing
```

복원 직전의 DB는 `local\backups\before_restore_*.dump`로 자동 저장된다.

## 5. 일상 점검

| 확인 | 방법 |
|---|---|
| 서비스 상태 | `http://127.0.0.1:3051/ready` → `{"status":"ready"}` |
| 사진 처리 적체·실패 | 사이트 설정 화면 "Photo processing", 또는 `GET /jobs/stats` (소유자 로그인) |
| 디스크 여유 | 설정 화면 "Storage" (10% 미만이면 경고 표시) |
| 백업 성공 | `local\backup.log` 마지막 줄 |
| 감시 동작 | `local\supervisor.log` |

## 6. 장애 대응

| 증상 | 확인 | 조치 |
|---|---|---|
| 사이트 접속 불가 | `Get-NetTCPConnection -LocalPort 8090,3051,54328 -State Listen` | 감시 예약 작업 상태 확인(`Get-ScheduledTask SecretAlbum-Supervisor`), `local\supervisor.log` |
| `/ready`가 `not_ready` | `local\postgres.log`, `local\api.log` | `scripts\start_local_db.ps1` 실행. `local\album.env`의 `PGPASSWORD` 확인 |
| 업로드한 사진이 계속 "Processing…" | Worker 실행 여부, `local\worker.log` | Worker는 감시 작업이 다시 띄운다. 멈춘 작업은 Worker 재시작 시 15분 기준으로 회수된다 |
| 사진이 "Processing failed" | 설정 화면 실패 건수, `local\worker.log` | 손상·지원하지 않는 파일. 휴지통으로 옮기고 원본을 다시 올린다 |
| 로그인 5회 실패로 잠김 | — | 10분 뒤 다시 시도 |
| 비밀번호 분실 | — | 서버에서 새 계정을 만들 수 없으므로(소유자 1명), DB에서 `users` 행을 지운 뒤 `scriptsdmin_create.py`로 다시 만든다. 사진·앨범은 그대로 남는다 |
| `PostgreSQL 시작 실패` | `local\postgres.log` | 다른 프로세스가 54328을 쓰는지 확인. 데이터 폴더 손상 시 4.3 복원 |

유지보수(패키지 업그레이드, 복원) 중에는 감시 작업이 서비스를 다시 띄우지 않도록 먼저 끈다:
`schtasks /Change /TN "SecretAlbum-Supervisor" /DISABLE` → 작업 후 `/ENABLE`.

## 7. 보안 주의

- `local\`(DB·사진·비밀값·로그·백업)은 git에 올리지 않는다. GitHub 저장소는 현재 **공개**다.
- 1차 운영은 HTTP다(결정 D3). 무선 구간에서 비밀번호와 사진이 암호화 없이 오가므로 HTTPS 적용을 권장한다. HTTPS 적용 시 `ALBUM_COOKIE_SECURE=true`를 설정한다.
- 서버와 백업 디스크에 BitLocker를 켠다 (결정 D7).
- 공용 PC에서 쓸 때는 설정 화면에서 "Browser cache"를 끈다.
