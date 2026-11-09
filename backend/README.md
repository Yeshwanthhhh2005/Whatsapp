# WhatsApp Web Clone — Backend

FastAPI backend for a WhatsApp Web–style client: JWT auth, direct and group
chats, persisted message history, file attachments, and real-time delivery,
typing indicators, presence and read receipts over WebSockets.

The React frontend lives in `../WhatsApp-Web-UI-Clone/artifacts/whatsapp-clone`
and talks to this server.

---

## Installation

Requires **Python 3.11+** (3.12+ recommended).

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

Then create your config:

```bash
cp .env.example .env
```

Generate a real secret key and paste it into `.env`:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

The app **refuses to start without `SECRET_KEY`**. A shipped default secret
would be a genuine vulnerability, so there isn't one.

---

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SECRET_KEY` | **yes** | — | Signs JWTs. Generate per environment. |
| `DATABASE_URL` | no | local Postgres | Must use an async driver (`postgresql+asyncpg://…`). |
| `CORS_ORIGINS` | no | localhost 5173 / 19720 / 3000 | Comma-separated browser origins. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | no | `10080` (7 days) | Access-token lifetime. |
| `UPLOAD_DIR` | no | `uploads` | Where attachments are written. |
| `PUBLIC_BASE_URL` | no | `http://localhost:8000` | Prefix for returned file URLs. |
| `MAX_UPLOAD_SIZE_MB` | no | `10` | Per-file upload cap. |
| `ENV` | no | `development` | `production` reduces log verbosity. |
| `AUTO_CREATE_TABLES` | no | `false` | Create tables from the models instead of running Alembic. Dev/test only. |

---

## Database setup

### PostgreSQL (intended target)

```bash
createdb whatsapp_clone
# or: docker run -d --name wa-pg -e POSTGRES_PASSWORD=postgres \
#       -p 5432:5432 postgres:17
```

Point `DATABASE_URL` at it and run the migration:

```bash
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/whatsapp_clone
alembic upgrade head
```

Alembic reads `DATABASE_URL` from `app.config`, so `alembic.ini` deliberately
leaves `sqlalchemy.url` blank — there is one source of truth.

To add a migration after changing a model:

```bash
alembic revision --autogenerate -m "describe the change"
alembic upgrade head
```

### SQLite (zero-setup local run)

Everything works on SQLite too, which is useful when you don't want to install
Postgres:

```ini
DATABASE_URL=sqlite+aiosqlite:///./whatsapp_clone.db
AUTO_CREATE_TABLES=true
```

`AUTO_CREATE_TABLES` builds the schema from the models on startup and skips
Alembic. Fine for local work and the test suite; **do not use it in
production** — there is no migration history, so later model changes won't be
applied to an existing database.

---

## Running the server

```bash
uvicorn app.main:app --reload --port 8000
```

- API: <http://localhost:8000/api>
- Swagger UI: <http://localhost:8000/docs>
- ReDoc: <http://localhost:8000/redoc>
- Health: <http://localhost:8000/api/health>

### Authenticating in Swagger

1. `POST /api/auth/register` (or `/login`).
2. Copy `access_token` from the response.
3. Click **Authorize**, paste the token.

---

## API endpoints

### Auth

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/register` | `{name, email, password}` → token + user. `409` if the email is taken. |
| `POST` | `/api/auth/login` | `{email, password}` → token + user. |
| `GET` | `/api/auth/me` | The signed-in user. |

Passwords are hashed with **bcrypt**. Login returns one message for both an
unknown address and a wrong password, so the endpoint can't be used to
enumerate registered accounts.

### Users

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/users/me` | Own profile, including email. |
| `PATCH` | `/api/users/me` | `{name?, about?, profile_image?}`. Omitted fields are left alone. |
| `GET` | `/api/users/search?q=` | Partial **name** or exact **email** match. |

Search never returns email addresses: knowing someone's address is enough to
find them, but the directory can't be scraped for addresses.

### Chats

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/chats` | Every chat, newest activity first. |
| `POST` | `/api/chats` | `{type: "direct"\|"group", member_ids, name?}`. |
| `GET` | `/api/chats/{chat_id}` | One chat. |

Each chat carries its display name (the other person's name for a direct chat,
the stored name for a group), members, last message, last message time, and
unread count.

Direct chats are unique per pair: requesting one that already exists returns it
with **200** instead of creating a duplicate. Non-members get **404**, not
**403**, so chat ids can't be probed for existence.

### Messages

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/chats/{chat_id}/messages?limit=&before=` | Paginated history, newest first. |
| `POST` | `/api/chats/{chat_id}/messages` | Send. Also broadcasts over WebSocket. |
| `PATCH` | `/api/messages/{message_id}` | Edit your own text message. |
| `DELETE` | `/api/messages/{message_id}` | Delete your own message (soft). |
| `POST` | `/api/chats/{chat_id}/read` | Mark read; `{up_to_message_id?}`. |

**Pagination** is keyset, not `OFFSET`: pass the response's `next_cursor` back
as `before` for the next, older page. A stable cursor means rows are never
skipped or repeated when new messages arrive mid-scroll. `items` are
newest-first — reverse them for top-to-bottom display.

**Delete is a soft delete**, like WhatsApp's delete-for-everyone: the row stays
with `is_deleted: true` and its body cleared, so open clients can show a
tombstone and history stays consistent.

Every mutation here also broadcasts on the socket, so a client that posts over
HTTP and one listening on a socket stay in step.

### Upload

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/upload` | Multipart `file`. Returns `{url, file_name, content_type, file_size, message_type}`. |

Two-step attachment flow: upload first, then send a message whose `file_url`,
`file_name` and `file_size` come from the response.

Accepted: JPEG, PNG, GIF, WebP, PDF, TXT, DOC(X), XLS(X), ZIP. The extension
comes from a content-type allowlist rather than the client's filename, the
stored name is a fresh UUID, and the display name is stripped to its basename —
so a crafted filename can't escape the upload directory. Files are streamed to
disk so the size cap is enforced as they arrive. Requires authentication, so
it can't be used as open storage.

Files are served from `/uploads` and sharded by `YYYY/MM`.

---

## WebSocket usage

```text
ws://localhost:8000/ws/{chat_id}?token=<access_token>
```

The token travels in the query string because browsers can't set headers on a
WebSocket handshake. The server authenticates and checks membership **before**
accepting, closing with `4401` (bad token) or `4403` (not a member).

Every frame, both directions:

```json
{ "event": "<name>", "data": { } }
```

### Client → server

| Event | Data |
| --- | --- |
| `message` | `{content?, message_type?, file_url?, file_name?, file_size?, client_id?}` |
| `typing_start` | `{}` |
| `typing_stop` | `{}` |
| `message_read` | `{up_to_message_id?}` |
| `ping` | `{}` |

`client_id` is echoed back on the broadcast so the sender can match the saved
message to its optimistic bubble.

### Server → client

| Event | Data |
| --- | --- |
| `connected` | `{user_id, chat_id}` |
| `message` | `{chat_id, message}` |
| `message_updated` | `{chat_id, message}` |
| `message_deleted` | `{chat_id, message_id}` |
| `typing` | `{chat_id, user_id, name, is_typing}` |
| `message_read` | `{chat_id, reader_id, message_ids, read_at}` |
| `presence` | `{user_id, is_online, last_seen}` |
| `pong` | `{}` |
| `error` | `{detail}` |

A malformed frame gets an `error` back; the socket stays open.

### Delivery is not confined to the room

The route is `/ws/{chat_id}` as specified, but `message`, `message_read` and
`presence` are pushed to **every socket belonging to every member of the
chat** — not only sockets opened against that chat. That is what keeps the
sidebar's unread badges live while you have a different conversation open. A
single connection is therefore enough for the whole app.

`typing` is the exception: it stays room-scoped, and is never persisted.

### Presence

Driven entirely by socket lifecycle. A user may hold several sockets (multiple
tabs); `is_online` flips to `true` on the first and `false` on the last, with
`last_seen` stamped on the way out. Everyone sharing a chat with them is
notified.

Disconnect cleanup runs inside a shielded cancel scope, because some ASGI
servers cancel the handler task when a socket closes — without the shield the
cleanup would abort at its first `await` and leave the user flagged online
forever. On startup, stale `is_online` flags from an unclean shutdown are
cleared.

### Read receipts

Three states on `Message.status`, which is what the check marks render:

| Status | Meaning |
| --- | --- |
| `sent` | Persisted. One tick. |
| `delivered` | At least one other member had a live socket. Two grey ticks. |
| `read` | At least one other member marked the chat read past it. Two blue ticks. |

`is_read` is derived from `status` rather than stored separately, so the two
can't drift apart.

Unread counts come from a per-member `last_read_at` watermark, which is cheaper
than a per-message-per-user table and never moves backwards. The honest
limitation: in a **group**, a message flips to `read` once *any* other member
reads it. Per-member receipts would need a `message_reads` table, which this
MVP deliberately skips — for one-to-one chats, the case the check marks are
really about, the result is exact.

---

## Tests

```bash
pytest
```

48 tests covering auth, chats, messages, pagination, read receipts, uploads and
the full WebSocket path (delivery, typing, presence, cross-chat fan-out).

They run against SQLite via `AUTO_CREATE_TABLES`, so no database server is
needed, and drive the app through Starlette's `TestClient` — including the
WebSockets — so everything shares one event loop.

---

## Project layout

```text
backend/
├── app/
│   ├── main.py            # app factory, CORS, lifespan, /uploads mount
│   ├── config.py          # settings from .env
│   ├── database.py        # async engine + session dependency
│   ├── auth/              # bcrypt hashing, JWT, auth dependencies
│   ├── models/            # SQLAlchemy: users, conversations, members, messages
│   ├── schemas/           # Pydantic request/response + WS envelopes
│   ├── services/          # all business logic
│   ├── routes/            # thin HTTP layer over the services
│   └── websocket/         # connection manager, broadcast helpers, /ws route
├── alembic/               # migrations
├── uploads/               # local file storage
└── tests/
```

Routes stay thin: they validate, call a service, and translate service
exceptions into HTTP status codes. Everything else lives in `services/`, which
is why the WebSocket handler and the REST routes can share the same logic.

---

## Design notes

Decisions a reader couldn't infer from the code:

- **`chat_id` vs `conversation_id`.** The API says `chat_id`; the column is
  `conversation_id`, named for the `conversations` table it references.
  `Message.chat_id` is a property bridging the two.

- **Timestamps are generated in Python**, not by `func.now()`. SQLite's
  `CURRENT_TIMESTAMP` has only second resolution and PostgreSQL's `now()` is
  transaction-scoped, so either way rows written in quick succession share a
  timestamp — and then ordering falls back to a random UUID and history renders
  in a different order on every load.

- **Enums are `VARCHAR` + `CHECK`**, not PostgreSQL `ENUM` types. Adding a
  value later is an ordinary migration instead of an `ALTER TYPE` dance, and
  the same DDL works on SQLite for the tests.

- **Sessions in the WebSocket handler are per-operation**, not per-connection.
  A socket can stay open for hours; a session held that long would pin a
  pooled connection and keep an idle transaction open the whole time.

- **Connection state is per-process.** Two Uvicorn workers would each see only
  their own sockets. That is the point at which a shared pub/sub backend
  becomes necessary, and Redis is explicitly out of scope here.

- **File storage is behind a two-method interface** (`app/services/storage.py`).
  Moving to S3 or Cloudinary means writing one more `Storage` subclass and
  changing `get_storage()`; nothing in the routes or services knows which is
  active.

## Known limitations

- No end-to-end encryption. Messages are stored in plaintext; the panel in the
  UI says so rather than claiming otherwise.
- Group read receipts are approximate (see above).
- `delivered` means "a recipient had a live socket", which is a reasonable
  approximation but not a device-level acknowledgement.
- Single-process only.
- The frontend stores its token in `localStorage`, which any script on the
  origin can read. An httpOnly cookie is the right answer in production; the
  brief specified bearer-token auth, so that is what this implements.
