-- 개인용 사이트라 2단계 인증을 쓰지 않는다 (2026-09-26 사용자 결정 D4). 관련 열을 지운다.
ALTER TABLE users DROP COLUMN IF EXISTS totp_secret;
ALTER TABLE users DROP COLUMN IF EXISTS totp_enabled;
ALTER TABLE users DROP COLUMN IF EXISTS recovery_codes;
ALTER TABLE sessions DROP COLUMN IF EXISTS mfa_verified;
