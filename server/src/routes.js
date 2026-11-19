import crypto from "node:crypto";
import express from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { query, tx } from "./db.js";
import { newUid, sign, optionalUser, requireUser } from "./auth.js";
import { broadcast, sseHandler } from "./events.js";
import {
  CHARACTERS, KEYWORDS, MAX_LINES_PER_USER, MAX_TEXT_LEN, MAX_NICK_LEN, ANON_NICK,
} from "./constants.js";

const r = express.Router();
const len = (s) => Array.from(s).length; // Postgres VARCHAR 와 같은 기준(코드 포인트)
const fail = (res, status, error, message) => res.status(status).json({ error, message });
// 회사 내부망은 여러 직원이 같은 IP 를 쓰므로: 로그인 후 요청은 uid 기준, 그 전은 IP 기준(넉넉하게)
const limiter = (windowMin, max, byUser = false) =>
  rateLimit({
    windowMs: windowMin * 60_000, limit: max, standardHeaders: "draft-7", legacyHeaders: false,
    ...(byUser && { keyGenerator: (req) => req.user.uid }),
    message: { error: "RATE_LIMITED", message: "요청이 너무 많아요. 잠시 후 다시 시도해주세요" },
  });

const countMine = async (uid) =>
  (await query("SELECT count(*)::int AS n FROM lines WHERE uid = $1", [uid])).rows[0].n;

/* ---------- 설정 ---------- */
r.get("/config", (_req, res) =>
  res.json({ characters: CHARACTERS, keywords: KEYWORDS, maxPerUser: MAX_LINES_PER_USER, maxText: MAX_TEXT_LEN, maxNick: MAX_NICK_LEN }));

/* ---------- 인증 ---------- */
// 페이지를 열면 익명 사용자 자동 발급
r.post("/auth/anon", limiter(10, 300), async (_req, res) => {
  const uid = newUid();
  await query("INSERT INTO users (uid) VALUES ($1)", [uid]);
  res.status(201).json({ token: sign(uid, false), uid, isAdmin: false });
});

// 관리자 비밀번호 로그인
r.post("/auth/admin", limiter(15, 10), async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string")
    return fail(res, 400, "BAD_REQUEST", "아이디와 비밀번호를 입력해주세요");
  const u = (await query(
    "SELECT uid, password_hash FROM users WHERE username = $1 AND is_admin", [username])).rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash)))
    return fail(res, 401, "INVALID_CREDENTIALS", "아이디 또는 비밀번호가 틀렸어요");
  res.json({ token: sign(u.uid, true), uid: u.uid, isAdmin: true });
});

r.get("/me", requireUser, async (req, res) =>
  res.json({ uid: req.user.uid, isAdmin: req.user.isAdmin, myCount: await countMine(req.user.uid), maxPerUser: MAX_LINES_PER_USER }));

/* ---------- 한 줄 ---------- */
// 목록 (sort=new|like). 작성자 uid 는 노출하지 않고 mine 으로만 구분
r.get("/lines", optionalUser, async (req, res) => {
  const uid = req.user?.uid ?? null;
  const order = req.query.sort === "like" ? "hearts DESC, l.ts DESC" : "l.ts DESC";
  const { rows } = await query(
    `SELECT l.line_id AS id, l.nick, l.ch, l.k, l.t, l.ts,
            count(h.uid)::int AS hearts,
            COALESCE(bool_or(h.uid = $1), FALSE) AS liked,
            (l.uid = $1) IS TRUE AS mine
       FROM lines l LEFT JOIN hearts h ON h.line_id = l.line_id
      GROUP BY l.line_id
      ORDER BY ${order}`,
    [uid],
  );
  res.json({ lines: rows, total: rows.length, myCount: rows.filter((x) => x.mine).length, maxPerUser: MAX_LINES_PER_USER });
});

r.post("/lines", requireUser, limiter(1, 20, true), async (req, res) => {
  const b = req.body || {};
  const t = typeof b.t === "string" ? b.t.trim() : "";
  const nick = (typeof b.nick === "string" ? b.nick.trim() : "") || ANON_NICK;
  const ch = b.ch;
  const k = b.k == null || b.k === "" ? null : b.k;

  if (!t) return fail(res, 400, "TEXT_REQUIRED", "한 줄 다짐을 입력해주세요");
  if (len(t) > MAX_TEXT_LEN) return fail(res, 400, "TEXT_TOO_LONG", `문구는 ${MAX_TEXT_LEN}자까지예요`);
  if (len(nick) > MAX_NICK_LEN) return fail(res, 400, "NICK_TOO_LONG", `닉네임은 ${MAX_NICK_LEN}자까지예요`);
  if (!Number.isInteger(ch) || ch < 0 || ch >= CHARACTERS.length) return fail(res, 400, "BAD_CHARACTER", "캐릭터를 다시 선택해주세요");
  if (k !== null && !KEYWORDS.includes(k)) return fail(res, 400, "BAD_KEYWORD", "키워드를 다시 선택해주세요");

  const line = await tx(async (c) => {
    // 사용자 행 잠금 → 동시에 여러 번 눌러도 10개 제한이 지켜짐
    await c.query("SELECT 1 FROM users WHERE uid = $1 FOR UPDATE", [req.user.uid]);
    const n = (await c.query("SELECT count(*)::int AS n FROM lines WHERE uid = $1", [req.user.uid])).rows[0].n;
    if (n >= MAX_LINES_PER_USER) return null;
    const row = { id: crypto.randomUUID(), nick, ch, k, t, ts: Date.now() };
    await c.query(
      "INSERT INTO lines (line_id, uid, nick, ch, k, t, ts) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [row.id, req.user.uid, nick, ch, k, t, row.ts],
    );
    return { ...row, hearts: 0, liked: false, mine: true };
  });
  if (!line) return fail(res, 409, "LIMIT_REACHED", `1인 최대 ${MAX_LINES_PER_USER}개까지 걸 수 있어요`);
  broadcast();
  res.status(201).json({ line, myCount: await countMine(req.user.uid) });
});

// 본인 글 또는 관리자만 삭제
r.delete("/lines/:id", requireUser, async (req, res) => {
  const { rowCount } = await query(
    "DELETE FROM lines WHERE line_id = $1 AND (uid = $2 OR $3)", [req.params.id, req.user.uid, req.user.isAdmin]);
  if (!rowCount) {
    const exists = (await query("SELECT 1 FROM lines WHERE line_id = $1", [req.params.id])).rowCount;
    return exists ? fail(res, 403, "FORBIDDEN", "삭제 권한이 없어요") : fail(res, 404, "NOT_FOUND", "이미 삭제된 글이에요");
  }
  broadcast();
  res.status(204).end();
});

/* ---------- 공감 ---------- */
const heartState = async (lineId, uid) =>
  (await query(
    "SELECT count(*)::int AS hearts, COALESCE(bool_or(uid = $2), FALSE) AS liked FROM hearts WHERE line_id = $1",
    [lineId, uid])).rows[0];

r.put("/lines/:id/heart", requireUser, limiter(1, 60, true), async (req, res) => {
  try {
    await query("INSERT INTO hearts (line_id, uid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.params.id, req.user.uid]);
  } catch (e) {
    if (e.code === "23503") return fail(res, 404, "NOT_FOUND", "삭제된 글이에요");
    throw e;
  }
  broadcast();
  res.json(await heartState(req.params.id, req.user.uid));
});

r.delete("/lines/:id/heart", requireUser, limiter(1, 60, true), async (req, res) => {
  await query("DELETE FROM hearts WHERE line_id = $1 AND uid = $2", [req.params.id, req.user.uid]);
  broadcast();
  res.json(await heartState(req.params.id, req.user.uid));
});

/* ---------- 실시간 ---------- */
r.get("/events", sseHandler);

export default r;
