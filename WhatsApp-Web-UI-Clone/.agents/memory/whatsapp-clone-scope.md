---
name: WhatsApp clone scope
description: The product boundary for the WhatsApp Web-style clone.
---

This is now a **full-stack** app, not a frontend-only mockup. The user
explicitly expanded the scope on 2026-10-08: first "build the backend", then
"connect the backend to the UI, i need a fully working end to end web clone".

- Backend: `backend/` — FastAPI + SQLAlchemy + JWT + WebSockets. Its own
  README covers endpoints, events and design decisions.
- Frontend: `WhatsApp-Web-UI-Clone/artifacts/whatsapp-clone` — now talks to
  that backend for auth, chats, messages, presence, typing and uploads.

**Still out of scope** (the backend brief listed these as do-not-build):
payments, notifications, stories/status updates, communities, calls,
end-to-end encryption, complex privacy settings, Redis, microservices,
Kubernetes, cloud deployment.

The Updates / Channels / Communities / Calls sections of the UI therefore stay
**local mock UI** and are labelled "local preview" — there is nothing to
connect them to.

**The original mock chats are kept on purpose.** The user asked for them to
stay ("leave the current mock data of chats, i should be able to do new chats
with the real data"). They live in `src/lib/mockChats.ts`, carry `demo: true`,
render through the same code path as live chats, and are tagged "demo" in the
sidebar. New chats created via "New chat" are real and backed by the API.

**How to apply:** keep that split — Chats is live, the other four sections and
the demo conversations are local. Do not delete the demo chats.
