// 실시간 반영: Server-Sent Events. 데이터가 바뀌면 "change" 이벤트만 보내고
// 클라이언트가 목록을 다시 불러옴. (단일 인스턴스 기준)
const clients = new Set();
let timer = null;

export function sseHandler(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 5000\n\n");
  clients.add(res);
  req.on("close", () => clients.delete(res));
}

// 짧은 시간에 여러 번 바뀌어도 한 번만 알림
export function broadcast() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    for (const res of clients) res.write("event: change\ndata: {}\n\n");
  }, 300);
}

// 프록시가 유휴 연결을 끊지 않도록 주기적으로 주석 전송
setInterval(() => {
  for (const res of clients) res.write(": ping\n\n");
}, 25000).unref();
