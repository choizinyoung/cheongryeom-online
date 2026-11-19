import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import bcrypt from "bcryptjs";

// BIGINT(ts) 를 문자열이 아닌 숫자로 받기 (ms 타임스탬프는 안전 범위 내)
pg.types.setTypeParser(20, (v) => Number(v));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 환경변수가 필요합니다.");
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DATABASE_POOL_MAX || 10),
});

export const query = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function migrate() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  await pool.query(fs.readFileSync(path.join(dir, "schema.sql"), "utf8"));
}

// 관리자 계정 1개: 환경변수 ADMIN_USERNAME / ADMIN_PASSWORD 로 생성·갱신
export async function ensureAdmin() {
  const { ADMIN_USERNAME: username, ADMIN_PASSWORD: password } = process.env;
  if (!username || !password) {
    console.warn("ADMIN_USERNAME / ADMIN_PASSWORD 미설정 → 관리자 계정 없음");
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (uid, is_admin, username, password_hash)
     VALUES ($1, TRUE, $2, $3)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_admin = TRUE`,
    ["admin:" + username, username, hash],
  );
  console.log(`관리자 계정 준비 완료: ${username}`);
}
