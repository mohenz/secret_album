# 비밀앨범

내부망에서 모델 사진을 보관·관리하고 감상하는 비공개 갤러리입니다.

## 현재 단계

0단계 기반 구축이 완료되었습니다. 전용 PostgreSQL 클러스터와 초기 스키마, 정적 웹, Python API, Worker 및 상태 확인 API를 제공합니다. 인증과 사진 API는 다음 단계에서 구현합니다.

## 실행

```powershell
python -m pip install -r requirements.txt
.\sa.cmd
```

- 웹: `http://127.0.0.1:8090`
- API 상태: `http://127.0.0.1:3051/health`
- 준비 상태: `http://127.0.0.1:3051/ready`

첫 실행에서 `local/album.env` 비밀번호와 `local/postgres-data`가 자동 생성됩니다. 종료는 `.\stop-album.cmd`를 사용합니다.

## 검증

```powershell
python -m compileall -q scripts tests
python scripts\check_module_layers.py
python -m unittest discover -s tests -t .
```

설계 기준은 `docs/project_settings.md`, `docs/design_request.md`, `docs/system_design.md`입니다.

다른 PC에서 개발을 이어갈 때는 `docs/other_pc_setup_guide.md`를 따릅니다.
