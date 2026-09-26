# 비밀앨범 (Secret Album)

내부망에서 모델 사진을 보관·관리하고 감상하는 갤러리형 비공개 앨범입니다. 사이트 화면은 영어입니다.

## 현재 단계

시스템 설계서 14장의 0~6단계 구현을 마쳤습니다.

- 로그인·2단계 인증(TOTP, 복구 코드)·세션·자동 잠금·로그인 실패 잠금
- 업로드(중복·형식 검사) → Worker가 WebP 파생 이미지 3종 생성(EXIF·GPS 제거)
- 갤러리 화면(홈·앨범·모델·즐겨찾기·검색), 사진 뷰어(슬라이드쇼·정보 패널·단축키)
- 편집 모드 일괄 작업, 휴지통(복원·영구 삭제·자동 비우기), 설정
- 화면 가리기(Shift+H)·백그라운드 가림·썸네일 가리기
- 운영: 감시 예약 작업, 백업·복원, Gitea 배포 훅, 방화벽 스크립트

## 실행 (개발 PC)

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\sa.cmd                                              # DB → API → Worker → 화면
.\.venv\Scripts\python.exe scripts\admin_create.py   # 최초 1회 소유자 계정
```

- 사이트: `http://127.0.0.1:8090` (처음 로그인할 때 2단계 인증을 등록합니다)
- API 상태: `http://127.0.0.1:3051/health`, `/ready`
- 종료: `.\stop-album.cmd`

## 검증

```powershell
.\.venv\Scripts\python.exe -m compileall -q scripts tests
.\.venv\Scripts\python.exe scripts\check_module_layers.py
.\.venv\Scripts\python.exe -m unittest discover -s tests -t .     # 26개 (DB가 켜져 있으면 통합 테스트 포함)

# 화면 흐름 E2E (설치된 Chrome 사용, 49개 확인 항목, 스크린샷은 local\e2e)
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe tests\e2e\run_e2e.py
```

통합 테스트와 E2E는 운영 DB가 아닌 `secret_album_test` DB와 임시 폴더를 씁니다.

## 문서

| 문서 | 내용 |
|---|---|
| `docs/project_settings.md` | 프로젝트 설정 요약, 결정 사항 |
| `docs/design_request.md` | 갤러리형 디자인 요청서, 표준 예외 E1~E7 |
| `docs/design_review.md` | 외부 시안 검토 |
| `docs/system_design.md` | 시스템 설계서 (cinetube와 같은 구성) |
| `docs/operations_guide.md` | 운영 서버 구성·배포·백업·장애 대응 |
| `docs/other_pc_setup_guide.md` | 다른 PC에서 개발 이어가기 |
