# WhatsApp Web Clone — full stack

A working WhatsApp Web–style messenger: React frontend, FastAPI backend,
real-time delivery over WebSockets.

```text
WhatsApp-Web-Clone/
├── backend/                                   FastAPI + SQLAlchemy + WebSockets
└── WhatsApp-Web-UI-Clone/                     pnpm workspace
    └── artifacts/whatsapp-clone/              the React app
```

Each half has its own README. [`backend/README.md`](backend/README.md) is the
detailed one: endpoints, WebSocket events, and the design decisions behind
them.

---

## Run it

Two terminals.

### 1. Backend — <http://localhost:8000>

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux
pip install -r requirements.txt

cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"   # paste as SECRET_KEY

uvicorn app.main:app --reload --port 8000
```

Swagger UI is at <http://localhost:8000/docs>.

By default `.env.example` points at PostgreSQL. For a zero-setup run, use
SQLite instead:

```ini
DATABASE_URL=sqlite+aiosqlite:///./whatsapp_clone.db
AUTO_CREATE_TABLES=true
```

With PostgreSQL, run `alembic upgrade head` once and leave
`AUTO_CREATE_TABLES=false`.

### 2. Frontend — <http://localhost:19720>

```bash
cd WhatsApp-Web-UI-Clone
pnpm install
```

Then, from `artifacts/whatsapp-clone`:

```powershell
# PowerShell (Windows)
$env:PORT="19720"; $env:BASE_PATH="/"; .\node_modules\.bin\vite.CMD
```

```bash
# macOS / Linux
PORT=19720 BASE_PATH=/ ./node_modules/.bin/vite
```

Vite proxies `/api`, `/ws` and `/uploads` to `http://localhost:8000`, so the
browser stays on one origin — no CORS preflight in development and WebSocket
URLs need no absolute host. Point it elsewhere with `BACKEND_URL`.

---

## Try the whole thing

1. Open <http://localhost:19720> — you get a sign-in screen. **Register.**
2. Open a **second browser profile** (or a private window) and register a
   second account. Two accounts in the same browser would share the same
   `localStorage` token.
3. In one window: **New chat** → search the other user by name, or paste their
   full email → **Start chat**.
4. Type. The message appears in the other window immediately, with the typing
   indicator, read receipts (one tick → two grey → two blue), and the online
   dot on the avatar.
5. Attach a photo or PDF with the paperclip. It uploads, then sends.
6. Close one window and watch the other switch to "last seen …".

---

## Live vs. demo conversations

The sidebar holds two kinds of chat:

- **Live** — created through "New chat", stored in the database, delivered over
  WebSockets. These are real.
- **Demo** — the original mock conversations, kept deliberately and tagged
  `demo` in the list. They render through exactly the same components but
  never touch the network; anything typed in one lives in React state until
  reload. The **Demo** filter chip shows just these.

The **Updates / Channels / Communities / Calls** sections are also local mock
UI, labelled "local preview". The backend brief put status updates, communities
and calls on its do-not-build list, so there is nothing to connect them to.

---

## Tests

```bash
cd backend && pytest          # 49 tests
```

Covers auth, chats, messages, keyset pagination, read receipts, uploads, and
the full WebSocket path — delivery, typing, presence, and cross-chat fan-out.
Runs on SQLite, so no database server is needed.

Frontend typecheck:

```bash
cd WhatsApp-Web-UI-Clone
./node_modules/.bin/tsc -p artifacts/whatsapp-clone/tsconfig.json --noEmit
```

---

## Windows notes

Two repo-level traps, both already worked around:

- `pnpm-workspace.yaml` excluded every non-Linux native binary (Replit is
  linux-x64), which made Vite fail with
  `Cannot find module @rollup/rollup-win32-x64-msvc`. The win32-x64 entries for
  rollup, esbuild, lightningcss and `@tailwindcss/oxide` were removed from that
  exclusion list. Linux installs are unaffected — they skip those optional deps
  anyway.
- The root `preinstall` guard rejects any install where
  `npm_config_user_agent` is not `pnpm/*`. `pnpm --filter <pkg> run <script>`
  trips it via its implicit deps check, so call the package's own binaries
  directly (as above) rather than through `pnpm run`.

Also: Git Bash rewrites a lone `/` in an environment variable into the Git
install path, so `BASE_PATH=/` silently becomes `C:/Program Files/Git/`. Launch
Vite from PowerShell on Windows.

---

## Known limitations

Stated plainly rather than hidden:

- **No end-to-end encryption.** Messages are stored in plaintext. The UI says
  "transport security" rather than claiming E2E.
- **Group read receipts are approximate** — a message flips to `read` once any
  other member reads it. Exact for one-to-one chats, which is what the check
  marks are really for.
- **`delivered` means "a recipient had a live socket"**, not a device-level
  acknowledgement.
- **Single process only.** WebSocket state is in-process, so two Uvicorn
  workers would each see only their own connections. That is the point at which
  a shared pub/sub backend is needed, and Redis was explicitly out of scope.
- **The token lives in `localStorage`**, readable by any script on the origin.
  An httpOnly cookie is the right answer in production; the brief specified
  bearer-token auth.
