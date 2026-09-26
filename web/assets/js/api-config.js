// 화면은 접속한 호스트 이름 그대로 API 포트(3051)에 요청한다. (cinetube local-db-config.js와 같은 방식)
export const API_BASE = `${location.protocol}//${location.hostname}:3051`;
