# SQLCraft Feature List

This document summarizes the main features of the **SQLCraft** platform, grouped into core capabilities required for the system to run (Core / MVP) and advanced features that define the product’s value.

## Product language notes
- SQLCraft should be described as a SQL platform, not a generic “learning system.”
- The system has two roles: **User** and **Admin**.
- Contribution is a User workflow, not a separate role.
- Some legacy entity names such as `tracks`, `lessons`, `challenges`, and `learning_sessions` may still appear in code and schema until a dedicated rename pass.

---

## Core / must-have features

Minimum foundation for users to access the product, run SQL, and work with content.

### 1. Identity (users & roles)
- [x] Sign-in, sign-up, and JWT-based session management.
- [x] Basic roles: **Admin** and **User**.
  - [x] **User**: Access the app, run SQL, and contribute databases, schemas, lessons (Lessons), and tracks (Tracks).
  - [x] **Admin**: Operate the system and approve user-contributed content before publication.
- [x] Basic user profile page.

### 2. Lesson engine
- [x] List learning tracks (Tracks) and lesson structure (Lessons).
- [x] Render lesson content as Markdown (code blocks, text formatting).
- [x] `lesson-first` flow: Track → Lesson → Start Lab, with optional starter query from the lesson.

### 3. Basic SQL lab (editor)
- [x] Integrated SQL editor (CodeMirror) with syntax highlighting and SQL autocompletion.
- [x] Execute SQL and surface results to the user (frontend polls after async backend processing via job queue).
- [x] Result grid with row count, clear truncation when capped, and copy result/query actions.
- [x] Clear errors: validation (blocked SQL) vs runtime (PostgreSQL errors).
- [x] Schema/database view backed by the live sandbox (not mock): tables, columns, types, PK/FK.
- [x] Session lifecycle UI: provisioning / active / expired / failed, with “Start new session” when expired or failed.
- [x] Format SQL and Clear editor actions.

### 4. Challenge engine
- [x] Optional: users pick challenges for advanced practice and points.
- [x] Result-set validation vs reference answer for automatic scoring. The system runs `referenceSolution` on the session sandbox and compares full result sets (columns, row count, values).
- [x] Challenge pages in lesson context: description, attempt history, best score, basic leaderboard.
- [x] Contributions: signed-in users create challenge drafts; after admin approve/publish, challenges go public in lesson context.
- [x] Points and comparison for query optimization. Scoring splits correctness, performance baseline, and index optimization; index credit requires index DDL in the session and `EXPLAIN ANALYZE` showing index use. Baseline comes from the author via `validatorConfig.baselineDurationMs` on the base database.

### 5. Sandbox isolation
- [x] Dedicated PostgreSQL container per learner session for data isolation. Worker creates a container per sandbox/session on the internal Docker network; `container_ref` is the internal host.
- [x] Worker cleans up sandboxes on session end or timeout.

---

## Advanced / differentiators

Features focused on query optimization and depth beyond basics.

### 6. Execution plan visualizer
- [x] Implicit `EXPLAIN` / `EXPLAIN ANALYZE`. Run flow picks mode: `EXPLAIN ANALYZE` for safe read queries (`SELECT`, `WITH ... SELECT`), `EXPLAIN` for statements that may write (`INSERT` / `UPDATE` / `DELETE` / `WITH` with DML) to avoid unintended side effects.
- [x] Tree visualizer for cost, scanned rows, actual time, index hit/miss, buffer hits/reads, bottleneck/hot-path highlights instead of raw JSON in the Execution Plan tab.

### 7. Progressive dataset scaling
- [x] When admins import canonical dataset metadata via Admin API, store schema definition, per-table row counts, total DB rows, source scale classification, and `system_jobs` for import/generation tracking.
- [x] Users can switch workload scale for the same schema:
  - [x] **Tiny**: ~100 rows.
  - [x] **Small**: ~10,000 rows.
  - [x] **Medium**: ~1–5M rows.
  - [x] **Large**: 10M+ rows.
  - [x] Only downscale from the imported source; no upscale beyond the original import.
  - [x] On scale change, worker reprovisions from the matching dataset template: restore from artifact if present, else deterministic seed from row counts instead of resizing a live sandbox.
- [x] System generates derived dataset templates from canonical row counts; worker provisions from artifacts or deterministic synthetic load preserving FK integrity and basic business coverage.

### 8. Optimization labs & cost-aware scoring
- [x] Query history for reviewing work.
- [x] Side-by-side comparison of two queries.
- [x] Safe `CREATE INDEX` / `DROP INDEX` to measure speedups on large data.
- [x] **Schema diff view**: changes vs base template schema (indexes, partitions, views, MVs, routines) with **“Reset sandbox to base”** to undo all changes.
- [x] Performance-oriented scoring beyond binary correctness.

### 9. Contribution tools
- [x] Markdown editor with SQL validator for preflight before submit. UI supports Write / Preview / Preflight, validates `referenceSolution`, and allows reopening drafts for new versions.
- [x] Admin moderation for user content. Challenge drafts: `pending / approved / changes_requested / rejected`, review notes, `Approve & Publish`, `Request Changes`, `Reject Draft`.
- [x] Lesson content versioning for safe updates. Admins can create, inspect, reload into editor, and publish versions.

### 10. Gamification
- [ ] Leaderboard highlighting fastest solves with lowest query cost.

### 11. Super admin console (planned)
- [ ] **Database & schema management**: schema templates and dataset templates. **SQL dump upload**: admin uploads `.sql`, system scans structure (tables, columns, keys, row counts), total rows, domain metadata, and source scale for review before publish; worker can generate smaller dataset artifacts for sandboxes.
- [ ] **Content management**: full CRUD for tracks, lessons, and challenge configuration without waiting on user contributions.
- [ ] **Community management**: account admin, ban abusive users, approve or reject contributed lessons/challenges/databases.
- [ ] **System monitoring**: platform health, worker provisioning queues, error logs, server resources.
