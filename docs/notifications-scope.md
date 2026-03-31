# Notifications — scope & policy (V1)

## 1. Purpose

Define **which events** become user- or admin-facing notifications, **which channels** they use, and **defaults** so the product stays useful without spam.

**Channel rule (V1):** Notifications are **in-app only** — **toasts** (and in-session UI) today; a dedicated **in-app inbox / bell** when implemented. **Email is not part of the notification system** (no digest, no “notify me by mail” for these events).

> **Separate concern:** Transactional emails for **account security** (e.g. password reset, verify email) are **not** “notifications” in this doc and may exist independently of the in-app notification product.

**Push:** Out of scope for V1 unless explicitly added later.

---

## 2. Design principles

1. **Signal over noise** — Prefer one clear notification over many small ones.
2. **Channel by urgency** — In-session behavior → UI (toast/banner). Async outcomes → **in-app inbox** when built. **No email channel** for product notifications.
3. **Aggregate** — Admin moderation and failed jobs are **batched** (counts + time window), not one row per event in the inbox.
4. **Opt-in for noisy categories** — Anything “social” or high-frequency is off by default (out of V1 scope below).
5. **Learning/sandbox** — Real-time feedback stays **on the Lab screen**; avoid global inbox noise for every query/sandbox tick.

---

## 3. Scope priorities (V1)

| Area | Included | Primary channels |
|------|-----------|------------------|
| **B. Learning / sandbox** | Yes — without spam | Toast/banner in Lab; optional deferred **in-app** only |
| **UGC: public DB pending review** | Yes — owner visibility | **In-app** (owner); no per-step pipeline spam |
| **UGC: golden snapshot** | Yes — owner | **In-app** only (status + errors in UI) |
| **Admin: moderation queue** | Yes | **In-app** batched (badge/list); **no** per-item spam |
| **Admin: jobs / queue failures** | Yes | Admin **in-app** only; **aggregated** (e.g. “3 jobs failed”) |

**Explicitly out of V1 notification product (unless re-scoped):**

- Email as a notification channel.
- Leaderboard / social “someone passed you” (opt-in later).
- Every successful query run in the Lab.
- Heartbeat / polling-style sandbox status unless user is in-session (UI-only).

---

## 4. Policy matrix

### 4.1 Learning / sandbox (learners)

| Event | In-app (toast / Lab UI) | In-app inbox (future) | Push |
|-------|-------------------------|------------------------|------|
| Sandbox provisioning progress | Yes — only while in flow | No | No |
| Sandbox **ready** | Yes | Optional — if user left and came back | No |
| Sandbox **failed** / error | Yes | Yes — single row, deduped | No |
| Session expired / idle timeout | Yes if on page | Optional — one line | No |
| Query executed / success | Yes — result panel only | **No** | No |

**Rule:** Anything that happens **every few seconds** in the Lab stays **local to the Lab UI**, not a global notification stream.

### 4.2 UGC — database upload & golden (owners / contributors)

| Event | Owner in-app | Push |
|-------|--------------|------|
| Public upload **submitted** → pending review | Yes — status in Explorer | No |
| Public upload **approved** / **rejected** | Yes | No |
| Golden snapshot **pending** | Yes — status in UI | No |
| Golden **succeeded** | Yes | No |
| Golden **failed** | Yes + error detail | No |

### 4.3 Admin / moderation

| Event | Admin in-app | Push |
|-------|--------------|------|
| New DB / challenge **awaiting review** | Yes — **batched** badge / list | **No** per item |
| Job / queue **failed** | Yes — **aggregated** (“N failures in window”) | No |

---

## 5. Event catalog — V1 (implementation checklist)

Use these as `notification_type` or domain event names when building `notification_events` / `user_notifications`.

### 5.1 Learning / sandbox

| ID (suggested) | Description | Default: learner |
|----------------|--------------|------------------|
| `sandbox.provisioning` | In-session only — UI | Toast only |
| `sandbox.ready` | Sandbox ready to use | Toast; optional inbox if async |
| `sandbox.failed` | Provision / health failed | Toast + optional inbox |
| `session.expired` | Learning session ended | Optional inbox |
| *(excluded)* `query.executed` | — | Do not notify globally |

### 5.2 UGC

| ID (suggested) | Description | Default: owner |
|----------------|--------------|------------------|
| `dataset.review.pending` | Public upload awaiting moderation | In-app |
| `dataset.review.approved` | Catalog approved | In-app |
| `dataset.review.rejected` | Catalog rejected | In-app |
| `golden.pending` | Bake queued / running | In-app |
| `golden.ready` | Bake succeeded | In-app |
| `golden.failed` | Bake failed | In-app |

### 5.3 Admin

| ID (suggested) | Description | Default: admin |
|----------------|--------------|----------------|
| `admin.review.queue` | Count of items pending review | In-app batched |
| `admin.jobs.failed` | Failed worker/queue jobs (aggregated) | In-app |

---

## 6. Default user preferences (V1 targets)

When a `user_notification_preferences` (or equivalent) table exists, **notification toggles are in-app only** (per category on/off). **No email column** for this product surface.

| Category | In-app |
|----------|--------|
| Learning / sandbox | On (with non-spam rules above) |
| UGC (my uploads, golden) | On |
| Admin (moderators only) | On |

**Learners who are not owners/admins:** only **Learning / sandbox** (and later **UGC** if they upload) apply.

---

## 7. Aggregation & rate limits (implementation hints)

- **Admin review:** Emit at most **one** “queue updated” signal per **15–60 minutes** per admin, or on login, with **counts** in payload.
- **Failed jobs:** Bucket by **time window** (e.g. 1 hour); message: “3 sandbox jobs failed — [link to admin jobs].”
- **Golden:** Do not emit on every internal state transition; emit on **terminal** states (`ready`, `failed`) and optionally **pending** once per dataset version.

---

## 8. Related docs

- `docs/database-design.md` — metadata and jobs/audit direction.
- Settings UI: `apps/web/src/app/(app)/settings/page-client.tsx` — keep copy aligned: **notifications = in-app**; do not promise email for this feature unless product scope changes.

---

## 9. Revision history

| Date | Change |
|------|--------|
| 2026-03-31 | Initial V1 scope: learning/sandbox, UGC golden & review, admin batched moderation & job failures |
| 2026-03-31 | **No email** in notification system; in-app only; transactional security email called out as separate |
