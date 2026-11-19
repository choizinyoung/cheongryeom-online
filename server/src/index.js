import express from "express";
import cors from "cors";
import { pool, migrate, ensureAdmin } from "./db.js";
import routes from "./routes.js";

const app = express();
app.set("trust proxy", 1); // Railway 프록시 뒤에서 실제 IP 로 rate limit
app.disable("x-powered-by");

// CORS_ORIGIN: 프론트 주소(쉼표로 여러 개). 미설정 시 모두 허용(개발용)
// 흔한 입력 실수(끝의 /, 공백, https:// 누락)는 자동 보정
const normOrigin = (s) => {
  s = s.trim().replace(/\/+$/, "");
  return (s && !/^https?:\/\//i.test(s) ? "https://" + s : s).toLowerCase();
};
const origins = (process.env.CORS_ORIGIN || "").split(",").map(normOrigin).filter(Boolean);
const warned = new Set();
console.log(origins.length ? `CORS 허용 출처: ${origins.join(", ")}` : "CORS_ORIGIN 미설정 → 모든 출처 허용");
app.use(cors({
  origin(origin, cb) {
    if (!origin || !origins.length || origins.includes(origin.toLowerCase())) return cb(null, true);
    if (!warned.has(origin)) {
      warned.add(origin);
      console.warn(`CORS 차단: ${origin} → 이 주소를 CORS_ORIGIN 에 넣어주세요`);
    }
    cb(null, false);
  },
  maxAge: 86400,
}));
app.use(express.json({ limit: "10kb" }));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use("/api", routes);
app.use((_req, res) => res.status(404).json({ error: "NOT_FOUND", message: "없는 주소예요" }));
app.use((err, _req, res, _next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "BAD_JSON", message: "잘못된 요청이에요" });
  console.error(err);
  res.status(500).json({ error: "SERVER_ERROR", message: "서버 오류가 발생했어요. 잠시 후 다시 시도해주세요" });
});

await migrate();
await ensureAdmin();
const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`API 서버 실행 중: http://localhost:${port}`));
