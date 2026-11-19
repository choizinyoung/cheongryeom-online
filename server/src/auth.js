import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { query } from "./db.js";

const isProd = process.env.NODE_ENV === "production";
const SECRET = process.env.JWT_SECRET || (isProd ? null : "dev-only-secret-change-me");
if (!SECRET) {
  console.error("JWT_SECRET 환경변수가 필요합니다.");
  process.exit(1);
}

export const newUid = () => "u_" + crypto.randomUUID().replace(/-/g, "");

export function sign(uid, isAdmin) {
  return jwt.sign({ sub: uid, adm: !!isAdmin }, SECRET, { expiresIn: isAdmin ? "12h" : "365d" });
}

function readToken(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    return jwt.verify(m[1], SECRET);
  } catch {
    return null;
  }
}

// 토큰 검증 + DB의 사용자 확인 (관리자 여부는 항상 DB 기준)
async function resolve(req) {
  const p = readToken(req);
  if (!p?.sub) return null;
  const r = await query("SELECT uid, is_admin FROM users WHERE uid = $1", [p.sub]);
  if (r.rowCount) return { uid: r.rows[0].uid, isAdmin: r.rows[0].is_admin };
  if (p.adm) return null; // 삭제된 관리자 토큰은 무효
  // 서명이 유효한 익명 토큰인데 행이 없으면(DB 초기화 등) 다시 만들어 줌
  await query("INSERT INTO users (uid) VALUES ($1) ON CONFLICT DO NOTHING", [p.sub]);
  return { uid: p.sub, isAdmin: false };
}

export const optionalUser = (req, _res, next) =>
  resolve(req).then((u) => ((req.user = u), next()), next);

export const requireUser = (req, res, next) =>
  resolve(req).then((u) => {
    if (!u) return res.status(401).json({ error: "UNAUTHORIZED", message: "인증이 필요해요" });
    req.user = u;
    next();
  }, next);
