# 비밀앨범 (secret_album) — 에이전트 안내

어느 컴퓨터에서 작업하는지 먼저 확인한다.

- **운영 서버**(`192.168.0.2`, 작업 경로 `E:\workspace\secret_album`): 코드를 고치지 않는다. `docs/server_agent_guide.md`를 끝까지 읽고 그 절차만 따른다.
- **개발 PC**: `docs/project_settings.md`, `docs/system_design.md`, `docs/operations_guide.md`를 본다. 변경은 개발 PC에서 커밋하고 `gitea` 원격 `main` push로 서버에 배포한다.

공통: `local/`(DB·사진·`album.env`·로그·백업)은 git에 올리지 않고, 비밀값과 사진 내용을 출력·기록하지 않는다. 사이트 UI 문구는 영어, 문서와 운영 스크립트 메시지는 한국어다.
