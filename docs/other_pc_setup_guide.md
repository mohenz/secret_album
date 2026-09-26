# 다른 PC 개발 환경 연결 가이드

## 1. 목적과 현재 기준

이 문서는 다른 Windows PC에서 `secret_album` 저장소를 내려받아 개발을 이어가기 위한 절차다.

- 저장소: `https://github.com/mohenz/secret_album.git`
- 브랜치: `main`
- 개발 기준 경로: `D:\Workspace\secret_album`
- Python: **3.14** 계열, 프로젝트 전용 가상환경 `.venv` (검증 버전 3.14.3, 3.14.7)
- PostgreSQL: 18, 전용 포트 `54328`
- 웹: `http://127.0.0.1:8090`
- API: `http://127.0.0.1:3051`
- DB: `secret_album`, 역할 `album_app`

`local/`의 비밀번호, PostgreSQL 데이터, 사진, 로그와 백업은 Git에 포함되지 않는다. 새 PC에서는 새 DB를 초기화하거나 기존 PC에서 안전하게 덤프와 사진 파일을 옮겨야 한다.

## 2. 사전 설치

다음 프로그램을 설치한다.

1. Git for Windows
2. Python 3.14 — Python.org 공식 Windows 64비트 배포판. PATH 기본 Python이 다른 버전이어도 된다. `py` 실행기로 3.14를 지정해 가상환경을 만든다
3. PostgreSQL 18 — 기본 설치 경로 `C:\Program Files\PostgreSQL\18`

확인:

```powershell
git --version
py -3.14 --version
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' --version
```

현재 DB 스크립트는 PostgreSQL 경로를 `C:\Program Files\PostgreSQL\18\bin`으로 고정한다. 다른 버전이나 경로를 사용하면 `scripts/start_local_db.ps1`과 `scripts/stop_local_db.ps1`의 `$pgBin` 또는 `$pgCtl`을 수정해야 한다.

## 3. 저장소 연결

새 PC에서 최초 한 번 실행한다.

```powershell
New-Item -ItemType Directory -Path D:\Workspace -Force
Set-Location D:\Workspace
git clone https://github.com/mohenz/secret_album.git
Set-Location D:\Workspace\secret_album
git switch main
git pull --ff-only origin main
```

GitHub 인증이 필요하면 개인 액세스 토큰 또는 Git Credential Manager를 사용한다. 토큰을 문서나 `local/album.env`에 기록하지 않는다.

## 4. Python 환경 구성

프로젝트 전용 가상환경은 **필수**다. `sa.cmd`는 `.venv\Scripts\python.exe`로 API·Worker·웹을 실행하며, 가상환경이 없거나 3.14가 아니면 실행을 멈춘다.

```powershell
Set-Location D:\Workspace\secret_album
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
python --version   # Python 3.14.x 확인
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

기존에 다른 버전으로 만든 `.venv`가 있으면 폴더를 삭제하고 다시 만든다.

PowerShell 실행 정책 때문에 활성화가 막히면 현재 프로세스에서만 허용한다.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

## 5. 새 DB로 시작하기

기존 데이터를 옮기지 않는 PC에서는 다음 명령 하나로 DB를 준비한다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start_local_db.ps1
```

첫 실행 시 자동으로 수행되는 작업:

1. `local/album.env`에 무작위 DB 비밀번호 생성
2. `local/postgres-data`에 전용 PostgreSQL 클러스터 생성
3. `127.0.0.1:54328`에서 DB 시작
4. 역할 `album_app`, DB `secret_album` 사용
5. `local/schema.sql` 적용
6. 핵심 테이블 12개와 `pgcrypto`, `pg_trgm`, 검색 인덱스 생성

DB 확인:

```powershell
$settings = @{}
Get-Content .\local\album.env | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
}
$env:PGPASSWORD = $settings.PGPASSWORD
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' `
  -h 127.0.0.1 -p 54328 -U album_app -d secret_album `
  -c "SELECT current_database(), current_user;"
Remove-Item Env:PGPASSWORD
```

DB 종료:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop_local_db.ps1
```

## 6. 기존 PC 데이터를 옮길 때

현재 데이터가 필요하면 `local/postgres-data` 폴더를 직접 복사하지 않는다. PostgreSQL 논리 덤프와 사진 저장소를 각각 이전한다.

### 6.1 기존 PC에서 DB 덤프

먼저 비밀앨범 DB를 실행한 다음 다음 명령을 사용한다.

```powershell
Set-Location D:\Workspace\secret_album
$settings = @{}
Get-Content .\local\album.env | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
}
$env:PGPASSWORD = $settings.PGPASSWORD
New-Item -ItemType Directory -Path .\local\backups -Force | Out-Null
& 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe' `
  -h 127.0.0.1 -p 54328 -U album_app -d secret_album `
  -Fc -f .\local\backups\secret_album_transfer.dump
if ($LASTEXITCODE -ne 0) { throw 'DB 덤프 실패' }
Remove-Item Env:PGPASSWORD
```

다음 항목을 암호화된 외장 저장장치 또는 안전한 내부망 경로로 옮긴다.

- `local/backups/secret_album_transfer.dump`
- `local/media/originals/`
- 필요하면 `local/media/derived/` — 없어도 원본에서 재생성 가능

`local/album.env`는 복사하지 않는 것을 권장한다. 새 PC에서 새 비밀번호와 새 클러스터를 만든다.

### 6.2 새 PC에서 복원

1. 5장의 절차로 빈 DB를 먼저 생성한다.
2. API와 Worker는 중지한다.
3. 덤프 파일을 `local/backups/`에 놓는다.
4. 다음 명령으로 복원한다.

```powershell
Set-Location D:\Workspace\secret_album
$settings = @{}
Get-Content .\local\album.env | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
}
$env:PGPASSWORD = $settings.PGPASSWORD
& 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe' `
  -h 127.0.0.1 -p 54328 -U album_app -d secret_album `
  --clean --if-exists --no-owner `
  .\local\backups\secret_album_transfer.dump
if ($LASTEXITCODE -ne 0) { throw 'DB 복원 실패' }
Remove-Item Env:PGPASSWORD
```

사진은 동일한 상대 경로로 복사한다.

```text
local/media/originals/<yyyy>/<mm>/<photo_id>.<확장자>
local/media/derived/<photo_id 앞 2글자>/<photo_id>/...
```

복원 후 DB 행과 실제 사진 파일이 모두 있는지 확인해야 한다. 사진 데이터는 아직 초기 개발 단계이므로 실제 이전 전에 현재 스키마와 업로드 구현 상태를 다시 확인한다.

## 7. 전체 서비스 실행과 확인

가상환경이 활성화된 PowerShell에서 실행한다.

```powershell
Set-Location D:\Workspace\secret_album
.\sa.cmd
```

브라우저가 열리지 않으면 직접 접속한다.

- 사이트: `http://127.0.0.1:8090`
- API 생존 확인: `http://127.0.0.1:3051/health`
- DB 준비 확인: `http://127.0.0.1:3051/ready`

PowerShell 확인 명령:

```powershell
Invoke-RestMethod http://127.0.0.1:3051/health
Invoke-RestMethod http://127.0.0.1:3051/ready
```

정상 기대값:

```text
/health → status: ok
/ready  → status: ready, database: ok
```

전체 종료:

```powershell
.\stop-album.cmd
```

## 8. 개발 시작 전 검증

```powershell
.\.venv\Scripts\python.exe -m compileall -q scripts tests
.\.venv\Scripts\python.exe scripts\check_module_layers.py
.\.venv\Scripts\python.exe -m unittest discover -s tests -t .
```

현재 기준으로 테스트 26개가 통과해야 한다(`tests/test_runtime.py`는 Python 3.14가 아니면 실패한다). DB가 켜져 있으면 통합 테스트(`test_auth_live.py`, `test_gallery_live.py`)가 `secret_album_test` DB를 새로 만들어 실행하고, DB가 꺼져 있으면 건너뛴다.

화면을 바꿨다면 E2E도 실행한다(설치된 Chrome 사용, 49개 확인 항목, 스크린샷은 `local\e2e`):

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe tests\e2e\run_e2e.py
```

실패한 상태에서 기능 개발이나 원격 푸시를 진행하지 않는다.

## 9. 다른 PC에서 작업을 이어가는 절차

작업 시작:

```powershell
Set-Location D:\Workspace\secret_album
git status --short --branch
git pull --ff-only origin main
.\.venv\Scripts\Activate.ps1
.\sa.cmd
```

작업 종료 전:

```powershell
.\.venv\Scripts\python.exe -m compileall -q scripts tests
.\.venv\Scripts\python.exe scripts\check_module_layers.py
.\.venv\Scripts\python.exe -m unittest discover -s tests -t .
git status --short
git add <변경한 파일>
git commit -m "작업 내용"
git push origin main
```

두 PC에서 동시에 같은 파일을 수정하지 않는다. 작업 시작 전 `git pull --ff-only`, 종료 후 `git push`를 원칙으로 한다. `local/` 데이터는 Git으로 동기화되지 않는다.

## 10. 현재 상태

2026-09-26 기준 시스템 설계서 14장의 0~6단계 구현을 마쳤다(인증, 업로드·처리, 감상 화면, 관리, 프라이버시·보안, 운영 스크립트). 사이트 화면 문구는 영어다(표준 예외 E7).

새 PC에서 처음 로그인하려면 소유자 계정을 만든다: `.\.venv\Scripts\python.exe scripts\admin_create.py`

운영 서버 구성·배포·백업은 `docs/operations_guide.md`를 따른다.

설계 기준은 다음 문서를 우선한다.

- `docs/project_settings.md`
- `docs/system_design.md`
- `docs/design_request.md`
- `docs/design_review.md`
- `docs/operations_guide.md`

## 11. 문제 해결

### PostgreSQL 도구를 찾을 수 없음

PostgreSQL 18 설치 위치를 확인하고 `scripts/start_local_db.ps1`의 `$pgBin`을 수정한다.

### 54328 포트가 이미 사용 중

```powershell
Get-NetTCPConnection -LocalPort 54328 -State Listen
```

다른 프로젝트 프로세스라면 임의로 종료하지 말고 포트 정책을 먼저 조정한다. 변경 시 `project_control/project_docs/development_systems.csv`, 환경 파일과 문서를 함께 갱신한다.

### PowerShell 스크립트 실행 차단

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

시스템 전체 실행 정책은 변경하지 않는다.

### `/health`는 성공하지만 `/ready` 실패

`local/postgres.log`, `local/api.error.log`, `local/album.env`의 호스트·포트·DB명을 확인한다. 비밀번호는 화면이나 이슈에 복사하지 않는다.

### 사이트에 접속되지 않음

```powershell
Get-NetTCPConnection -LocalPort 8090,3051,54328 -State Listen -ErrorAction SilentlyContinue
Get-Content .\local\web.error.log -Tail 50
Get-Content .\local\api.error.log -Tail 50
Get-Content .\local\postgres.log -Tail 50
```

## 12. 보안 주의사항

- `local/album.env`, DB 덤프, 사진 원본을 GitHub에 올리지 않는다.
- 현재 GitHub 저장소는 문서 기준 공개 저장소이므로 실제 사진이나 개인정보를 커밋하지 않는다.
- DB 포트 `54328`을 외부 네트워크에 개방하지 않는다.
- 사진 이전 매체는 BitLocker 등으로 암호화한다.
- 복원 검증이 끝난 임시 덤프는 안전하게 삭제한다.
- 실제 사진 사용 전 저장소 비공개 전환 또는 내부 Gitea 사용 여부를 결정한다.
