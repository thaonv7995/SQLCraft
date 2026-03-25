# Admin UI Console Plan

## Goal
Ship a UI-first admin console aligned with the current product: `user/admin` roles only, versioned SQL content, fixed challenge points, user contributions, global rankings, and per-challenge rankings.

## Canonical Product Language
- SQLCraft should be described as a SQL platform, not a learning platform.
- The only system roles are `user` and `admin`.
- Contribution is a workflow, not a role.
- Legacy entity names such as `lessons` and `challenges` may remain in code until a separate rename track ships.

## Final IA
- `/admin` → `Overview`
- `/admin/content` → `Content`
- `/admin/databases` → `Databases`
- `/admin/users` → `Users`
- `/admin/rankings` → `Rankings`
- `/admin/system` → `System`
- `/admin/settings` → `Settings`

## Rules
- Remove product language tied to `learner`, `student`, `contributor`, and `arena`.
- Treat contribution as a user workflow, not a role.
- Keep sidebar to top-level domains only; use tabs inside each page.
- Reuse existing admin shells and card/table components before creating new primitives.

## Delivery Order
- [ ] 1. Reshape admin shell and sidebar to the new IA → Verify: sidebar only shows `Overview`, `Content`, `Databases`, `Users`, `Rankings`, `System`, `Settings`
- [ ] 2. Finish `Overview` as the control-plane home → Verify: `/admin` shows live KPI cards, review summary, ranking snapshot, and links into all admin domains
- [ ] 3. Rebuild `Content` around lessons + challenges + review queue → Verify: admin can navigate tabs for `Lessons`, `Challenges`, and `Review Queue` without seeing LMS-only or role-confused language
- [ ] 4. Replace schema placeholders with a real `Databases` console → Verify: `/admin/databases` shows tabs for `Schema Templates`, `Dataset Templates`, `SQL Imports`, and `Generation Jobs`
- [ ] 5. Upgrade `Users` into a true moderation + stats surface → Verify: `/admin/users` shows account status, role, participation stats, and contribution history for real users
- [ ] 6. Add `Rankings` management UI → Verify: `/admin/rankings` shows `Global Ranking`, `Challenge Rankings`, and `Point Rules`
- [ ] 7. Consolidate monitoring into `System` → Verify: `/admin/system` shows health, queues, logs, and resources using one consistent layout
- [ ] 8. Wire `Settings` last → Verify: `/admin/settings` exposes platform defaults and feature toggles without placeholder copy

## Screen Scope

### 1. Overview
- Sections: KPI strip, pending review queue summary, top global users, top challenge rankings, recent system jobs, admin quick actions
- Reuse: `/apps/web/src/components/admin/admin-metrics-dashboard.tsx`
- Needs: rename metrics cards around product outcomes, add ranking snapshots, remove dead actions like migration/sandbox controls until backed by real APIs

### 2. Content
- Tabs: `Lessons`, `Challenges`, `Review Queue`
- `Lessons`: lesson list, version list, lesson editor, publish state
- `Challenges`: challenge list, challenge detail, answer/validator config, points, publish/archive
- `Review Queue`: all pending user submissions for lesson/challenge content
- Reuse: `/apps/web/src/app/(admin)/admin/content/page.tsx`
- Remove: `Tracks`-first framing if tracks are no longer a core product concept

### 3. Databases
- Tabs: `Schema Templates`, `Dataset Templates`, `SQL Imports`, `Generation Jobs`
- `Schema Templates`: list, detail, version, publish/archive
- `Dataset Templates`: source dataset, derived datasets, artifact readiness, size metadata
- `SQL Imports`: upload/review/import state; show placeholder upload surface first if raw dump parsing is not implemented yet
- `Generation Jobs`: dataset generation job table with status and artifact links
- Reuse: `/apps/web/src/components/admin/admin-placeholder-page.tsx` as the first-shell scaffold only

### 4. Users
- Tabs: `All Users`, `Moderation`, `Contribution History`
- Table columns: name, email, role, status, last login, queries run, solved challenges, active sessions, total points, joined date
- Detail panel: contribution history, recent solves, recent sessions, moderation actions
- Reuse: `/apps/web/src/app/(admin)/admin/users/page.tsx`
- Change: collapse all non-admin people into `user`; remove contributor-role controls

### 5. Rankings
- Tabs: `Global Ranking`, `Challenge Rankings`, `Point Rules`
- `Global Ranking`: top users by total points, filters, recompute action
- `Challenge Rankings`: select challenge and inspect rank table
- `Point Rules`: default points, duplicate-solve behavior, tie-break rules, hidden-from-ranking flag
- Reuse: `/apps/web/src/app/(app)/leaderboard/page.tsx`

### 6. System
- Tabs: `Health`, `Queues`, `Logs`, `Resources`
- `Health`: API, DB, Redis, worker, storage status
- `Queues`: provisioning and dataset job queues
- `Logs`: audit logs and error logs
- `Resources`: session counts, sandbox/container usage, CPU/RAM/disk indicators
- Reuse: `/apps/web/src/components/admin/admin-metrics-dashboard.tsx`, `/apps/web/src/app/(admin)/admin/health/logs/page.tsx`
- Change: unify metrics/logs under one route and remove mismatched API assumptions before polishing UI

### 7. Settings
- Tabs: `Platform`, `Ranking Defaults`, `Workers`, `Feature Flags`
- Keep this page last; it depends on decisions made while shipping the other pages

## Implementation Notes
- Reuse current table, card, badge, input, and placeholder primitives from `/apps/web/src/components/ui`
- Create one shared admin page frame with: page header, tab bar, primary action, secondary action, data state slots
- Prefer route-level pages for domains and tab-level local state inside each page
- Keep placeholder pages only for screens not yet wired; do not leave placeholder copy in shipped routes

## Done When
- [ ] The sidebar matches the final IA and no longer shows `Lesson Management`, `Schema Management`, or `System Health` as separate legacy entries
- [ ] Every top-level admin page has a real page shell with the intended tabs, even if some tabs still show staged empty states
- [ ] Product language across admin UI consistently uses `user`, `admin`, `lessons`, `challenges`, `databases`, and `rankings`
- [ ] The plan is actionable enough to implement one page at a time without redesigning IA again
