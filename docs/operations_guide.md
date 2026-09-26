# 비밀앨범 운영 가이드

- 기준일: 2026-09-26
- 대상: 내부망 Windows 운영 서버 (시스템 설계서 v0.2 12장 기준, cinetube와 같은 운영 방식)
- 함께 볼 문서: `docs/system_design.md`, `docs/other_pc_setup_guide.md`

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

관리자 PowerShell에서 실행한다.

```powershell
# 1) 코드 받기 (Gitea 저장소를 쓰는 경우)
git clone http://192.168.0.2:3000/admin/secret_album.git E:\workspace\secret_album
Set-Location E:\workspace\secret_album

# 2) Python 3.14 가상환경
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# 3) DB 초기화 (local\album.env에 DB 비밀번호·암호화 키가 자동 생성된다)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start_local_db.ps1
```

`local\album.env`를 열어 내부망 접속용 값을 추가한다 (서버 IP가 192.168.0.2인 예):

```text
ALBUM_API_HOST=0.0.0.0
ALBUM_WEB_BIND=0.0.0.0
ALBUM_WEB_ORIGINS=http://192.168.0.2:8090,http://localhost:8090,http://127.0.0.1:8090
```

- 사진 디스크를 따로 쓰면 `ALBUM_MEDIA_ROOT=F:\secret_album_media`를 추가한다.
- `ALBUM_DATA_KEY`(2단계 인증 비밀값 암호화 키)는 **서버 밖 안전한 곳에 따로 보관**한다. 잃어버리면 모든 사용자가 2단계 인증을 다시 등록해야 한다.

```powershell
# 4) 소유자 계정 만들기 (웹 가입 화면 없음)
.\.venv\Scripts\python.exe scripts\admin_create.py

# 5) 방화벽: 8090·3051을 같은 서브넷에만 연다
.\deploy\configure_firewall.ps1

# 6) 감시 예약 작업 등록 (부팅 시 + 1분마다 자기 복구)
.\scripts\register_supervisor.ps1 -User "SERVER\albumsvc"
```

접속: `http://192.168.0.2:8090` → 로그인 → 처음 한 번 2단계 인증(인증 앱) 등록 → 복구 코드 보관.

## 3. 배포 (Gitea push)

1. Gitea 저장소 `admin/secret_album`의 `hooks/post-receive`에 `deploy/post-receive`를 복사한다 (줄바꿈 LF 유지). 운영 경로가 다르면 파일 안의 `DEPLOY_ROOT`를 고친다.
2. 개발 PC에서 검증 후 push한다.

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
| 2단계 인증 기기 분실 | — | 복구 코드로 로그인 → 설정에서 새 복구 코드 발급 |
| 복구 코드도 없음 | — | 서버에서 DB의 `users.totp_enabled`를 false로 바꾸면 다음 로그인 때 다시 등록한다 (소유자 본인 확인 후) |
| `PostgreSQL 시작 실패` | `local\postgres.log` | 다른 프로세스가 54328을 쓰는지 확인. 데이터 폴더 손상 시 4.3 복원 |

유지보수(패키지 업그레이드, 복원) 중에는 감시 작업이 서비스를 다시 띄우지 않도록 먼저 끈다:
`schtasks /Change /TN "SecretAlbum-Supervisor" /DISABLE` → 작업 후 `/ENABLE`.

## 7. 보안 주의

- `local\`(DB·사진·비밀값·로그·백업)은 git에 올리지 않는다. GitHub 저장소는 현재 **공개**다.
- 1차 운영은 HTTP다(결정 D3). 무선 구간에서 비밀번호와 사진이 암호화 없이 오가므로 HTTPS 적용을 권장한다. HTTPS 적용 시 `ALBUM_COOKIE_SECURE=true`를 설정한다.
- 서버와 백업 디스크에 BitLocker를 켠다 (결정 D7).
- 공용 PC에서 쓸 때는 설정 화면에서 "Browser cache"를 끈다.
