import express from "express";
import cors from "cors";
import { pool, migrate, ensureAdmin } from "./db.js";
import routes from "./routes.js";

const app = express();
app.set("trust proxy", 1); // Railway 프록시 뒤에서 실제 IP 로 rate limit
app.disable("x-powered-by");

// CORS_ORIGIN: 프론트 주소(쉼표로 여러 개). 미설정 시 모두 허용(개발용)
const origins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true, maxAge: 86400 }));
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
