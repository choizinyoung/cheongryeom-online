// 프론트 정적 서버 (의존성 없음)
// - /           → index.html
// - /config.js  → 환경변수 API_BASE_URL 을 window.API_BASE 로 주입
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(dir, "index.html"));
const apiBase = (process.env.API_BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const config = `window.API_BASE=${JSON.stringify(apiBase)};\n`;

const security = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x").pathname;
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, security).end();
    } else if (url === "/" || url === "/index.html") {
      res.writeHead(200, { ...security, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : html);
    } else if (url === "/config.js") {
      res.writeHead(200, { ...security, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : config);
    } else if (url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    } else {
      res.writeHead(302, { Location: "/" }).end();
    }
  })
  .listen(Number(process.env.PORT || 3000), () =>
    console.log(`프론트 서버 실행 중: http://localhost:${process.env.PORT || 3000} (API: ${apiBase})`));
