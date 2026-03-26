# Challenge Ranking Flow Redesign

## Goal
Thiết kế lại luồng `ranking`, `submission`, `challenge`, `lesson` theo DB để:

- backend tự giữ mọi ràng buộc lesson/challenge/database
- public UI chỉ đọc dữ liệu đã publish, không lẫn draft
- learner submission không thể chấm điểm sai DB hoặc sai challenge
- ranking có thể lọc và tổng hợp theo DB, lesson, challenge
- contributor/admin flow tách khỏi learner runtime flow

## Current Failures

1. `learning_sessions` đang nhận `lessonVersionId` và `challengeVersionId` độc lập.
   Kết quả: có thể tạo challenge session với DB của lesson A nhưng challenge của lesson B.

2. `submitAttempt` nhận `challengeVersionId` từ client.
   Kết quả: client có thể submit một query execution của session này để chấm điểm cho challenge publish khác.

3. Public challenge catalog lấy `publishedVersionId` để load leaderboard nhưng lại hiển thị metadata của `latest version`.
   Kết quả: UI có thể hiển thị version/validator của draft chưa publish.

4. Hệ thống chưa có khái niệm DB là first-class dimension trên lesson/challenge/ranking.
   Hiện public flow chủ yếu xoay quanh `track` và `lesson`, còn database chỉ sống ở explorer.

5. Từ `submission` đang bị overloaded:
   - learner submit query để chấm điểm
   - contributor submit content draft để review
   Hai luồng này khác bản chất nhưng đang nằm gần nhau ở UI/API naming.

## Redesign Principles

1. Client không được phép ghép ID thủ công.
   Backend phải tự resolve challenge, lesson, database từ một entry point duy nhất.

2. Public read model chỉ dùng immutable published releases.
   Draft và review metadata không được rò sang learner UI.

3. DB phải là dimension chuẩn trên mọi surface:
   lesson list, challenge detail, ranking, contributor queue.

4. Runtime phải là mode-based:
   `explore`, `lesson`, `challenge`.

5. Ranking chỉ đọc từ scored attempts gắn với published challenge release.

## Target Bounded Contexts

### 1. Database Catalog
Nguồn chân lý cho DB public.

Đề xuất thêm entity `database_profiles`:

- `id`
- `slug`
- `name`
- `schema_template_id`
- `source_dataset_template_id`
- `source_scale`
- `available_scales`
- `domain`
- `difficulty`

Trong giai đoạn đầu, `database_profiles.id` có thể map 1:1 với database explorer item hiện tại.

### 2. Content Authoring
Quản lý draft và review.

- `lessons`
- `lesson_versions`
- `challenges`
- `challenge_versions`
- `content_review_submissions`

Context này chỉ phục vụ contributor/admin.

### 3. Published Learning Runtime
Quản lý dữ liệu immutable mà learner được nhìn thấy và chạy.

- `lesson_releases`
- `challenge_releases`
- `learning_sessions`
- `query_executions`
- `challenge_attempts`

### 4. Ranking Read Model
Tối ưu cho leaderboard và analytics.

- `challenge_best_scores`
- `global_ranking_entries`
- có thể materialize async từ attempts

## New Core Model

### Lesson Release
Snapshot immutable của một lesson đã publish.

`lesson_releases`

- `id`
- `lesson_id`
- `release_no`
- `source_version_id`
- `database_id`
- `schema_template_id`
- `dataset_template_id`
- `title`
- `content`
- `starter_query`
- `published_at`

### Challenge Release
Snapshot immutable của một challenge đã publish.

`challenge_releases`

- `id`
- `challenge_id`
- `release_no`
- `source_version_id`
- `lesson_release_id`
- `database_id`
- `schema_template_id`
- `dataset_template_id`
- `title`
- `description`
- `difficulty`
- `points`
- `problem_statement`
- `hint_text`
- `validator_type`
- `validator_config`
- `published_at`

Rule bắt buộc:

- `challenge_release.lesson_release_id` phải trỏ đến lesson release đang được challenge này gắn vào
- `challenge_release.database_id` phải bằng `lesson_release.database_id`
- `challenge_release.schema_template_id` phải bằng `lesson_release.schema_template_id`

### Learning Session
Không cho client truyền cặp lesson/challenge rời rạc nữa.

`learning_sessions`

- `id`
- `user_id`
- `mode` enum: `explore | lesson | challenge`
- `database_id`
- `lesson_release_id` nullable
- `challenge_release_id` nullable
- `schema_template_id`
- `dataset_template_id`
- `selected_scale`
- `status`
- `started_at`
- `last_activity_at`
- `ended_at`

Check constraints:

- `mode = 'explore'` => `lesson_release_id IS NULL` and `challenge_release_id IS NULL`
- `mode = 'lesson'` => `lesson_release_id IS NOT NULL` and `challenge_release_id IS NULL`
- `mode = 'challenge'` => `challenge_release_id IS NOT NULL`
- nếu `challenge_release_id IS NOT NULL`, thì `database_id/schema_template_id/dataset_template_id` phải match release

### Challenge Attempt
Learner scoring submission.

`challenge_attempts`

- `id`
- `learning_session_id`
- `challenge_release_id`
- `query_execution_id`
- `attempt_no`
- `status`
- `score`
- `evaluation`
- `submitted_at`

Constraints/indexes:

- `unique(query_execution_id)`
- `unique(learning_session_id, attempt_no)`
- index `(challenge_release_id, submitted_at desc)`
- index `(challenge_release_id, user_id)` qua join/view cho leaderboard

Quan trọng:
`challenge_attempts.challenge_release_id` phải luôn bằng `learning_sessions.challenge_release_id`.

## New API Shape

## Public Read APIs

- `GET /v1/databases`
- `GET /v1/databases/:databaseId`
- `GET /v1/databases/:databaseId/lessons`
- `GET /v1/lesson-releases/:lessonReleaseId`
- `GET /v1/challenge-releases/:challengeReleaseId`
- `GET /v1/challenge-releases/:challengeReleaseId/leaderboard?window=weekly|monthly|alltime`
- `GET /v1/leaderboard?scope=global&databaseId=&lessonReleaseId=&window=`

Public API chỉ trả `release` objects.
Không expose `latest draft version` trên learner pages.

## Runtime APIs

`POST /v1/learning-sessions`

Body mới:

- `{ "mode": "explore", "databaseId": "...", "scale": "small" }`
- `{ "mode": "lesson", "lessonReleaseId": "...", "scale": "small" }`
- `{ "mode": "challenge", "challengeReleaseId": "...", "scale": "small" }`

Server sẽ tự resolve:

- `database_id`
- `schema_template_id`
- `dataset_template_id`
- `lesson_release_id`
- `challenge_release_id`

`POST /v1/challenge-attempts`

Body mới:

- `{ "learningSessionId": "...", "queryExecutionId": "..." }`

Server sẽ:

1. lấy session
2. verify session mode là `challenge`
3. lấy `challenge_release_id` từ session
4. verify query execution thuộc session
5. score theo release đó

Client không còn gửi `challengeVersionId` hay `challengeReleaseId`.

## Authoring / Review APIs

Đổi tên để tránh đụng với learner attempts.

- `POST /v1/contributor/challenges`
- `POST /v1/contributor/challenges/:id/versions`
- `POST /v1/contributor/challenges/:id/review-submissions`
- `GET /v1/contributor/review-submissions`
- `POST /v1/admin/review-submissions/:id/approve`
- `POST /v1/admin/review-submissions/:id/request-changes`
- `POST /v1/admin/review-submissions/:id/reject`

Approve không mutate public data trực tiếp theo kiểu draft row.
Approve sẽ tạo `challenge_release` mới, rồi cập nhật pointer publish hiện hành.

## UI Flow Redesign

## Learner Flow

### A. Theo DB

`Database page`

- hiển thị DB summary
- lesson releases dùng DB này
- challenge releases nổi bật dùng DB này
- link sang ranking filtered theo DB

### B. Lesson

Route đề xuất:

- `/databases/:databaseId/lessons/:lessonReleaseId`

Trang lesson hiển thị:

- DB badge
- release badge, ví dụ `Lesson Release v3`
- starter query
- challenges thuộc đúng lesson release đó

CTA:

- `Start Lesson Lab`
  gọi `POST /learning-sessions { mode: "lesson", lessonReleaseId }`

### C. Challenge

Route đề xuất:

- `/databases/:databaseId/challenges/:challengeReleaseId`
hoặc
- nested dưới lesson release

Trang challenge hiển thị:

- challenge release badge
- DB badge
- scoring rules của published release
- leaderboard của chính release đó

CTA:

- `Start Challenge Lab`
  gọi `POST /learning-sessions { mode: "challenge", challengeReleaseId }`

### D. Attempts

Đổi learner history page từ ý nghĩa mơ hồ `submissions` sang:

- `/attempts` hoặc `/challenge-attempts`

Nội dung:

- attempts của user
- filter theo DB, lesson release, challenge release

## Contributor Flow

Đổi `/submissions` hiện tại vì nó đang alias sang contributor page nhưng tên gây hiểu nhầm.

Đề xuất tách:

- `/contributor`
- `/contributor/drafts`
- `/contributor/review-submissions`

Screen contributor cần hiện:

- Draft challenge versions
- Release history
- Review status history
- DB đang gắn với challenge

## Admin Flow

Admin moderation page group theo:

- DB
- lesson
- challenge
- pending review submission

Admin chỉ review `review submission`.
Admin không review trực tiếp “latest version row” nữa.

## Ranking Model

## Challenge Leaderboard

Key chuẩn:

- `challenge_release_id`

Mỗi leaderboard entry là best scored attempt của user trên release đó.

`challenge_best_scores`

- `challenge_release_id`
- `user_id`
- `best_attempt_id`
- `best_score`
- `attempts_count`
- `passed_attempts`
- `last_submitted_at`

Có thể update sync trong transaction submit attempt hoặc async bằng worker.

## Global Ranking

Global ranking phải cộng theo challenge release đã pass, không theo raw attempts.

`global_ranking_entries`

- `user_id`
- `window`
- `points`
- `challenges_completed`
- `streak`
- `last_submitted_at`

Dimension filters:

- `database_id`
- `track_id`
- `lesson_release_id`

## Required Invariants

1. `challenge session` luôn provision từ chính DB snapshot của challenge release.
2. `challenge attempt` luôn lấy challenge target từ session, không lấy từ request body.
3. Một query execution chỉ submit được một lần.
4. Public ranking/catalog chỉ đọc release tables.
5. Draft metadata không được hiển thị trên learner UI.
6. Mọi learner-facing object đều mang `database_id`.

## Phase 1: Safety Patch on Current Schema

Làm ngay, ít migration, để chặn bug hiện tại.

### Backend

1. `createSession`
   - nếu có `challengeVersionId`, verify challenge version đó thuộc cùng lesson với `lessonVersionId`
   - nếu mismatch, reject `422`

2. `submitAttempt`
   - load session đầy đủ
   - verify session có `challengeVersionId`
   - verify `session.challengeVersionId === payload.challengeVersionId`
   - tốt hơn: bỏ `challengeVersionId` khỏi payload ngay ở API

3. `challengeAttempts`
   - thêm unique index cho `(learning_session_id, challenge_version_id, attempt_no)` hoặc tốt hơn `(learning_session_id, attempt_no)`
   - insert attempt number trong transaction

4. `listPublishedChallenges`
   - trả metadata của `publishedVersionId`, không phải latest draft version

### UI

1. Public leaderboard page chỉ hiển thị `published version`
2. Admin rankings page hiển thị rõ:
   - `Published release`
   - `Latest draft`
3. Đổi label `submissions` của learner/contributor để khỏi nhập nhằng

## Phase 2: Release-Based Model

Thêm table mới:

- `database_profiles`
- `lesson_releases`
- `challenge_releases`
- `content_review_submissions`
- `challenge_best_scores`

Session chuyển sang model `mode + releaseId`.

## Phase 3: DB-First UX

1. Database becomes first navigation axis
2. Lessons/challenges/rankings đều filter được theo DB
3. Contributor queue group theo DB
4. Global ranking có view:
   - all databases
   - per database

## Migration Strategy

### Step 1
Additive migration, chưa đổi UI:

- thêm `mode`, `database_id`, `schema_template_id`, `dataset_template_id` vào `learning_sessions`
- backfill từ `lesson_versions` hoặc explorer database session

### Step 2
Tạo `lesson_releases`, `challenge_releases`

- backfill từ `publishedVersionId` hiện tại
- mỗi published version hiện tại sinh ra một release đầu tiên

### Step 3
Chuyển public APIs sang release IDs

- giữ compatibility routes tạm thời
- old route resolve sang release mới

### Step 4
Chuyển ranking sang read model

- backfill best scores từ `challenge_attempts`

## Verification

## Must Pass

1. Không thể tạo challenge session với lesson DB khác challenge DB
2. Không thể submit query từ lesson session vào challenge leaderboard
3. Không thể submit query execution lặp lại
4. Public challenge page luôn hiển thị đúng release đang được chấm điểm
5. Ranking filter theo DB trả đúng count và score

## Test Cases

- unit test mismatch `lessonVersionId/challengeVersionId`
- unit test submit attempt without challenge session
- unit test duplicate query submission
- integration test publish draft v2 while public still sees release v1
- e2e test database -> lesson -> challenge -> lab -> submit -> leaderboard

## Recommended Rollout

### Sprint 1

- patch safety invariants
- fix public metadata mismatch
- rename ambiguous submission screens

### Sprint 2

- introduce release tables
- migrate public APIs
- move session creation to `mode + releaseId`

### Sprint 3

- add ranking read model
- add DB-first navigation and DB filters everywhere

## Done When

- learner runtime không còn nhận raw lesson/challenge version pair từ client
- contributor submission và learner attempt được tách nghĩa hoàn toàn
- published flow chỉ đọc immutable releases
- ranking/query/submission đều truy vết được chính xác về `database_id`
