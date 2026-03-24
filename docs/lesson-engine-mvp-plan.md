# Lesson Engine MVP Plan

> Branch: `codex/lesson-engine-mvp`
> Worktree: `/Users/thaonv/Projects/Personal/SQLForge/.claude/worktrees/lesson-engine-mvp`
> Status legend: `[ ]` Pending | `[~]` In Progress | `[x]` Done
> Last updated: 2026-03-24
> Current milestone: lesson-first flow shipped, challenge extension hooks added

## Approach

Complete the Lesson Engine as a learner-facing flow built around `lesson-first` navigation:

`Tracks list -> Track detail -> Lesson page -> Start Lab -> Challenge/Lab continuation`

This matches the current domain model and system design more closely than the existing `track -> start lab directly` shortcut. The implementation should first fix API/frontend contract drift, then add a dedicated lesson-reading experience, then wire a clean handoff into the SQL lab.

## Scope

- In:
  - Learner-facing lesson discovery and reading flow
  - Markdown rendering for published lesson content
  - Clean route structure for tracks, lessons, and lab handoff
  - Starter query handoff from lesson content into the lab
  - Validation coverage for web + API changes directly related to Lesson Engine
- Out:
  - Contributor/admin lesson editor UX
  - Challenge authoring workflow
  - Full progress analytics or streak logic
  - Search, bookmarks, offline reading, or note-taking
  - Rich MDX features beyond safe Markdown rendering

## Current State Snapshot

- Backend already supports:
  - published tracks list and track detail with lesson summaries
  - published lesson metadata
  - published lesson version retrieval with `content`, `starterQuery`, `challenges`, and `schemaTemplate`
  - versioned lesson persistence in `lesson_versions`
- Frontend already supports:
  - `/tracks`
  - `/tracks/[trackId]`
  - session creation from `publishedVersionId`
  - lab page showing `lessonTitle`
- Known gaps:
  - no lesson page route
  - no frontend client for `GET /lesson-versions/:id`
  - no Markdown renderer in `apps/web`
  - lab flow bypasses lesson reading
  - `Track` contract is out of sync between frontend and backend
  - difficulty filtering on tracks is sent by frontend but not supported by backend
- Baseline branch note:
  - `pnpm test` currently fails before feature work in `@sqlcraft/api` because `@sqlcraft/types` cannot be resolved by Vitest
  - `@sqlcraft/web` tests pass

## Recommended UX Direction

### Learner Flow

1. User opens `/tracks`
2. User selects a track on `/tracks/[trackId]`
3. User opens a lesson page using the lesson's published version
4. User reads lesson content rendered from Markdown
5. User clicks `Start Lab`
6. Lab opens with:
   - the lesson title
   - optional link back to the lesson
   - starter query preloaded if available

### UI Principles

- Keep the lesson page focused on reading and orientation
- Keep the lab focused on execution and iteration
- Avoid duplicating the full lesson body inside the lab
- Add only a light "Lesson Notes" or "Back to lesson" affordance inside the lab

## Dependency Map: Lesson Engine vs Challenge Engine

### Product Relationship

- `Lesson Engine` is the guided learning layer
- `Challenge Engine` is the optional assessment and competition layer
- The intended learner graph is:
  - `track -> lesson -> optional challenge`
- A learner must be able to complete a lesson without entering a challenge flow
- A challenge should usually be discovered from a lesson, not from an entirely separate information architecture in V1

### Shared Foundations

The following platform pieces should be treated as shared infrastructure for both features:

- published content versioning
  - `lesson_versions`
  - `challenge_versions`
- runtime session model
  - `learning_sessions`
- sandbox lifecycle
  - `sandbox_instances`
- query history and execution metrics
  - `query_executions`
  - `query_execution_plans`
- schema and dataset linkage
  - `schema_templates`
  - `dataset_templates`

### Ownership Split

`Lesson Engine` should own:

- track browsing
- lesson structure
- lesson reading
- Markdown content rendering
- starter query handoff
- lesson-level progress entry points

`Challenge Engine` should own:

- challenge problem statements
- challenge attempt submission
- result-set validation
- correctness scoring
- performance scoring
- points and leaderboard logic
- best-query comparison rules
- best-index comparison rules

### Coupling Rule

- `Challenge Engine` should depend on `Lesson Engine` for entry and context
- `Lesson Engine` should not depend on `Challenge Engine` to feel complete
- Shared runtime entities must be designed once and reused by both

## Build Now to Avoid Refactor Later

These items should be built into the Lesson Engine implementation now, even if the full Challenge Engine ships later:

### Content and API Shape

- [x] Ensure the lesson page fetches and understands the `challenges` array returned from `GET /lesson-versions/:id`, even if V1 only shows summary cards
- [x] Define frontend types for challenge summary payloads alongside lesson version types
- [x] Preserve `publishedVersionId` at the lesson-card level because it is the bridge to both lab and challenge context

### Routing and Navigation

- [x] Design the lesson page to include a dedicated section for `Challenges in this lesson`
- [x] Reserve a route pattern for challenge pages that nests naturally under lesson context, e.g. `/tracks/[trackId]/lessons/[lessonId]/challenges/[challengeId]`
- [x] Add a clear `Back to lesson` path from any future challenge page and from the lab

### Session Strategy

- [x] Keep lesson-driven sessions valid when `challengeVersionId` is absent
- [x] Make sure the session creation flow can later accept `challengeVersionId` without changing the learner lesson route structure
- [x] Keep query history at the session level so challenge evaluation can reuse the same executions

### Lab Integration

- [x] Keep lab entry generic enough that it can be launched from:
  - lesson reading
  - challenge solving
  - direct session resume
- [x] Avoid baking lesson-only assumptions into lab state names if challenge mode will reuse the same workbench

## Data and Schema Decisions to Prepare Early

The current schema is sufficient for Lesson Engine MVP, but several decisions should be made now because they will affect UI and service boundaries later.

### Current Useful Relations

- `challenges.lessonId` already makes challenges lesson-scoped
- `learning_sessions.challengeVersionId` is optional, which is the correct shape for lesson-first learning
- `challenge_attempts` already links a challenge attempt back to a `queryExecutionId`

### Decisions to Lock Soon

- [ ] Decide whether challenge scoring remains one `score` field or becomes split fields:
  - `correctnessScore`
  - `performanceScore`
  - optional `indexScore`
- [ ] Decide whether `points` belong on:
  - `challenges`
  - `challenge_versions`
  - evaluation output only
- [ ] Decide whether leaderboard ranking uses:
  - best attempt
  - latest passing attempt
  - weighted score with tie-breakers
- [ ] Decide whether index-based optimization challenges require:
  - explicit baseline query metrics
  - explicit baseline schema snapshot
  - reset-to-baseline affordance between attempts

### Design Debt Already Visible

- Docs mention `challenge_evaluations`, but the current implementation stores evaluation inside `challenge_attempts`
- The current evaluator only supports basic correctness logic and a single score
- Performance and index-optimization scoring are not modeled cleanly yet

These do not block Lesson Engine MVP, but the lesson/challenge UI should not assume the scoring model is final.

## UI Reservation Points for Future Challenge Engine

The lesson page and lab should intentionally leave room for challenge features.

### Lesson Page

Reserve space for:

- `Challenge summary rail` or `Practice after this lesson` section
- challenge count
- challenge difficulty badge
- point value badge
- `Try Challenge` CTA
- `Best score` or `Community benchmark` teaser

Recommended MVP display:

- simple cards under the lesson content
- show title, difficulty, and short description only
- if challenge details are not ready, the cards can link to lab with a placeholder status

### Track Detail Page

Reserve card metadata for:

- lesson completion state
- challenge count per lesson
- optional advanced badge if a lesson contains optimization-focused challenges

Recommended MVP display:

- lesson row remains compact
- append a subtle challenge count like `2 challenges`

### Lab Header / Side Panel

Reserve for:

- current lesson title
- current challenge title if challenge mode is active
- mode chip:
  - `Lesson`
  - `Challenge`
- benchmark summary:
  - target result correctness
  - optional target latency / cost
- reset-to-baseline control for optimization challenges

Recommended MVP behavior:

- show lesson context only now
- structure the component so a future `challenge context` block can be added without redesigning the header

## Action Checklist

### Phase 1: Contract Cleanup

- [x] Audit and normalize the frontend `Track` and `Lesson` types in `apps/web/src/lib/api.ts` against API responses
- [x] Remove or replace unsupported frontend assumptions such as `estimatedHours`, `tags`, `thumbnailUrl`, and `isPublished` unless the API is extended to provide them
- [x] Decide whether `/v1/tracks` should truly support difficulty filtering; if yes, add backend schema/service support, otherwise remove the unused frontend query param
- [x] Add explicit frontend types for `LessonVersion`, `LessonVersionWithDetails`, and any nested lesson/challenge summary payloads

### Phase 2: Lesson Data Access

- [x] Extend `lessonsApi` in `apps/web/src/lib/api.ts` with `getVersion(versionId)`
- [x] Decide the canonical learner route:
  - recommended: `/tracks/[trackId]/lessons/[lessonId]`
  - alternative: `/lesson-versions/[versionId]`
- [x] Add route-level fetching logic for lesson metadata plus published version details
- [x] Define not-found and unpublished-state behavior for lesson access

### Phase 3: Markdown Rendering

- [x] Add a Markdown rendering stack to `apps/web` with safe defaults
- [x] Support the minimum Markdown feature set:
  - headings
  - paragraphs
  - ordered/unordered lists
  - inline code
  - fenced code blocks
  - blockquotes
- [x] Implement a reusable lesson content component, e.g. `LessonMarkdown`
- [x] Add SQL code block styling that visually matches the product's lab/editor aesthetic
- [x] Explicitly block raw HTML rendering unless a later requirement justifies it

### Phase 4: Lesson Page UI

- [x] Build the learner lesson page shell and content layout
- [x] Include a lesson header with:
  - track context
  - lesson title
  - difficulty
  - estimated minutes
  - lesson order within the track
- [x] Include primary CTAs:
  - `Start Lab`
  - `Continue Lab` when an active session exists
  - optional `Back to Track`
- [x] Include an optional right rail or footer area for:
  - starter query preview
  - challenge summary count
  - schema/template context
- [x] Ensure the page is readable on mobile and comfortable on wide desktop screens

### Phase 5: Track Detail Improvements

- [x] Change lesson cards on `/tracks/[trackId]` so the primary click target opens the lesson page instead of starting the lab immediately
- [x] Decide against a secondary `Start Lab` shortcut to keep the lesson-first flow strict
- [x] Revisit lock, available, in-progress, completed states so they map to real backend/user state instead of placeholder-only assumptions
- [x] Add clearer structure cues on the track page:
  - lesson numbering
  - estimated time
  - completion status

### Phase 6: Lab Handoff

- [x] Update the lesson page CTA to create a session using the lesson's `publishedVersionId`
- [x] Preload `starterQuery` into lab state when launching from a lesson
- [x] Add a compact `Back to lesson` affordance in the lab header
- [x] Decide not to add a lesson reference panel in lab MVP; keep lesson context lightweight
- [x] Verify the lab still behaves correctly when a session is opened outside the lesson page

### Phase 7: Content States and Error Handling

- [x] Design clear empty/error states for:
  - missing published version
  - fetch failure
  - lesson exists but not yet published
  - session creation failure
- [x] Add loading skeletons for:
  - lesson page
  - track lesson navigation transitions
- [x] Prevent duplicate session creation from repeated CTA clicks

### Phase 8: Validation

- [x] Add or update API tests for any changed track filtering or lesson payload behavior
- [x] Add web component/page tests for:
  - lesson page render
  - Markdown block rendering
  - CTA state transitions
- [x] Add at least one end-to-end happy-path test:
  - open track
  - open lesson
  - start lab
  - verify lesson title and starter query handoff
- [x] Re-run `pnpm test`
- [x] Re-run targeted checks such as `pnpm lint` and `pnpm typecheck`
- [x] Separate pre-existing baseline failures from feature-introduced failures in the final verification report

### Phase 9: Challenge Extension Hooks

- [x] Add a nested challenge route under lesson context:
  - `/tracks/[trackId]/lessons/[lessonId]/challenges/[challengeId]`
- [x] Link lesson challenge summary cards to the nested challenge route
- [x] Allow challenge mode session creation using both:
  - `lessonVersionId`
  - `challengeVersionId`
- [x] Surface challenge counts on the track detail lesson cards using published lesson version data
- [x] Extend lab bootstrap context so the lab can show:
  - lesson mode vs challenge mode
  - back link to lesson or challenge entry point
  - optional challenge title
- [x] Replace placeholder challenge route with full challenge detail, evaluation, scoring, and leaderboard UI in feature 4

## Suggested Implementation Order

1. Fix frontend/API type drift for tracks and lessons
2. Add `lesson version` client support
3. Introduce the learner lesson route and page shell
4. Add safe Markdown rendering and code block styling
5. Rewire track detail page to open lessons first
6. Wire `Start Lab` and starter query handoff
7. Add loading/error states
8. Add tests and final verification

## Risks

- The current frontend relies on fields not returned by the track API, so UI refactors may expose more drift than expected
- Pre-existing API test failures can mask regression signals until the workspace baseline is repaired
- Progress state on lesson cards is currently more aspirational than real, so the UI may need temporary simplification
- If Markdown support is implemented too loosely, raw HTML/XSS concerns will appear immediately

## Definition of Done

- Learners can browse tracks and lessons without placeholder-only assumptions
- A learner can open a lesson page and read published Markdown content cleanly
- SQL code blocks inside lesson content are styled and readable
- `Start Lab` launches a learning session from the published lesson version
- The lab reflects lesson context and receives the starter query when present
- Track detail and lesson routes feel coherent as one guided learning flow
- Validation coverage exists for the new lesson page and lesson-to-lab handoff
