# 오월드 청렴 트리 (cheongryeom-oneline)

```
server/   API 서버 (Node 20+, Express 5, PostgreSQL)
web/      프론트 (index.html + 의존성 없는 정적 서버)
```

## 데이터 모델

| 테이블 | 설명 |
|---|---|
| `users` | 익명 사용자(`uid`), 관리자 계정은 `is_admin=true` + `username`/`password_hash` |
| `lines` | 청렴 한 줄. `ch` 0~3, `k` 4개 키워드 중 하나 또는 NULL, `t` 50자, `nick` 12자 |
| `hearts` | `(line_id, uid)` 복합 PK → 1인 1공감. 글 삭제 시 함께 삭제 |

캐릭터·키워드는 코드에 고정 (`server/src/constants.js`, `web/index.html`의 `CH`/`KWS`, `schema.sql`의 CHECK).
테이블은 서버 시작 시 자동 생성됩니다.

## API

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| POST | `/api/auth/anon` | - | 익명 사용자 발급 → `{token, uid}` |
| POST | `/api/auth/admin` | - | `{username, password}` → 관리자 토큰(12시간) |
| GET | `/api/me` | 필요 | `{uid, isAdmin, myCount}` |
| GET | `/api/lines?sort=new\|like` | 선택 | 전체 목록 `{lines:[{id,nick,ch,k,t,ts,hearts,liked,mine}], total, myCount}` |
| POST | `/api/lines` | 필요 | `{nick?, ch, k?, t}` 작성 (1인 최대 10개 → 초과 시 409) |
| DELETE | `/api/lines/:id` | 필요 | 본인 글 또는 관리자만 (403/404) |
| PUT | `/api/lines/:id/heart` | 필요 | 공감 |
| DELETE | `/api/lines/:id/heart` | 필요 | 공감 취소 |
| GET | `/api/events` | - | SSE. 데이터 변경 시 `change` 이벤트 |
| GET | `/api/config` | - | 캐릭터/키워드/제한값 |
| GET | `/health` | - | DB 연결 확인 |

인증은 `Authorization: Bearer <token>`. 프론트는 익명 토큰을 localStorage에 저장해 같은 브라우저에서 "내 글"을 구분합니다.

## 로컬 실행

```bash
# 1) API (Postgres 필요)
cd server && npm install
DATABASE_URL=postgres://... ADMIN_USERNAME=admin ADMIN_PASSWORD=pw npm run dev   # :8080

# 2) 프론트
cd web && API_BASE_URL=http://localhost:8080 npm start                          # :3000
```

관리자 로그인: `http://localhost:3000/?admin` → 하단 관리자 로그인 박스.

## Railway 배포

한 프로젝트에 서비스 3개: **Postgres**, **server**, **web** (같은 GitHub 레포).

1. **Postgres**: `+ New → Database → PostgreSQL`
2. **server** 서비스: `+ New → GitHub Repo` → Settings → **Root Directory = `/server`**
   - Variables
     - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
     - `JWT_SECRET` = 긴 랜덤 문자열
     - `NODE_ENV` = `production`
     - `ADMIN_USERNAME`, `ADMIN_PASSWORD` = 관리자 계정
     - `CORS_ORIGIN` = web 서비스 도메인 (예: `https://cheongryeom-web.up.railway.app`)
   - Settings → Networking → **Generate Domain**
3. **web** 서비스: 같은 레포 추가 → **Root Directory = `/web`**
   - Variables: `API_BASE_URL` = server 도메인 (예: `https://cheongryeom-api.up.railway.app`)
   - **Generate Domain**

각 폴더의 `railway.json`이 시작 명령(`npm start`)과 헬스체크(`/health`)를 지정합니다.

> 실시간 반영(SSE)은 server 인스턴스 1개 기준입니다. 레플리카를 늘리면 30초 주기 갱신으로만 반영됩니다.
