-- 서버 시작 시 자동 실행 (여러 번 실행해도 안전)

-- USER: 익명 사용자 + 관리자 계정(username/password_hash 가 있는 행)
CREATE TABLE IF NOT EXISTS users (
  uid           TEXT PRIMARY KEY,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  username      TEXT UNIQUE,
  password_hash TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- LINE: 청렴 한 줄 (CHARACTER / KEYWORD 는 코드 고정 → CHECK 제약으로 표현)
CREATE TABLE IF NOT EXISTS lines (
  line_id TEXT PRIMARY KEY,
  uid     TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  nick    VARCHAR(12) NOT NULL DEFAULT '익명',
  ch      SMALLINT NOT NULL CHECK (ch BETWEEN 0 AND 3),
  k       TEXT CHECK (k IS NULL OR k IN ('기본과원칙', '상호존중', '공정투명', '갑질근절')),
  t       VARCHAR(50) NOT NULL CHECK (char_length(btrim(t)) > 0),
  ts      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS lines_ts_idx  ON lines (ts DESC);
CREATE INDEX IF NOT EXISTS lines_uid_idx ON lines (uid);

-- HEART: (line_id, uid) 복합 PK → 1인 1공감
CREATE TABLE IF NOT EXISTS hearts (
  line_id    TEXT NOT NULL REFERENCES lines(line_id) ON DELETE CASCADE,
  uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (line_id, uid)
);
CREATE INDEX IF NOT EXISTS hearts_uid_idx ON hearts (uid);
