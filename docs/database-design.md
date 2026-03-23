# Database Design

## 1. Purpose
Define the V1 metadata schema and design decisions for platform persistence.

## 2. Database Split
### 2.1 Metadata Database
Stores platform state:
- users
- roles
- tracks / lessons / challenges
- versioned content
- learning sessions
- sandbox records
- query records
- evaluation records
- jobs and audit logs

### 2.2 Sandbox Databases
Ephemeral learner-facing databases provisioned from templates. These are not part of the platform metadata schema.

## 3. Design Principles
1. Separate content entities from content versions.
2. Separate session state from sandbox state.
3. Separate query execution metadata from plan payloads.
4. Prefer append-friendly event tables for operational history.
5. Keep learner sandbox state disposable.

## 4. Core Table Groups

### 4.1 Identity
- users
- roles
- user_roles

### 4.2 Learning Content
- tracks
- lessons
- lesson_versions
- challenges
- challenge_versions
- tags
- lesson_tags

### 4.3 Templates
- schema_templates
- dataset_templates

### 4.4 Runtime
- learning_sessions
- sandbox_instances
- sandbox_events
- sandbox_resets

### 4.5 Query and Evaluation
- query_executions
- query_execution_plans
- query_metrics
- challenge_attempts
- challenge_evaluations

### 4.6 Platform Ops
- audit_logs
- system_jobs
- job_events

## 5. Key Entity Definitions

### users
Represents a platform account. Unique email and username. Contains provider and status.

### lessons vs lesson_versions
`lessons` is the stable identity of a lesson.
`lesson_versions` stores mutable published content, template linkage, and validation configuration.

### challenges vs challenge_versions
Same pattern as lessons. This avoids breaking historical attempts when challenge prompts or validators evolve.

### learning_sessions
Tracks a learner’s runtime engagement with a published lesson/challenge version.

### sandbox_instances
Tracks provisioned runtime DB environments. A learning session may have multiple sandbox instances over time due to resets/re-provisioning.

### query_executions
Central fact table for query history. Stores timing, status, row counts, and preview data.

### query_execution_plans
Stores raw and summarized plan data separately because plans can be large and are not always needed in normal list views.

## 6. Suggested Indexes

### users
- unique(email)
- unique(username)

### tracks
- unique(slug)
- index(status, sort_order)

### lessons
- unique(track_id, slug)
- index(track_id, sort_order)
- index(status)

### lesson_versions
- unique(lesson_id, version_no)
- partial index on `(lesson_id)` where `is_published = true`
- index(schema_template_id, dataset_template_id)

### challenges
- unique(lesson_id, slug)
- index(lesson_id, sort_order)

### challenge_versions
- unique(challenge_id, version_no)
- partial index on `(challenge_id)` where `is_published = true`

### learning_sessions
- index(user_id, status, started_at desc)
- index(lesson_version_id, status)
- index(last_activity_at)

### sandbox_instances
- index(learning_session_id, status)
- index(status, expires_at)
- unique(container_ref) where container_ref is not null

### query_executions
- index(learning_session_id, submitted_at desc)
- index(sandbox_instance_id, submitted_at desc)
- index(user_id, submitted_at desc)
- index(status)
- GIN or trigram optional on `normalized_sql` for search

### challenge_attempts
- unique(learning_session_id, challenge_version_id, attempt_no)
- index(challenge_version_id, submitted_at desc)

## 7. Data Retention Guidelines
- query_executions: retain core metadata long-term for learning history
- query_execution_plans: may be archived or compressed after retention threshold
- sandbox_events: retain for operational troubleshooting
- audit_logs: retain per policy
- sandbox data itself: short-lived, disposable

## 8. Normalization Notes
- normalized around stable entities and versioned content
- denormalized preview JSON is allowed in query_executions for fast UI rendering
- event tables intentionally denormalized for operational simplicity

## 9. Example Status Enumerations
### users.status
- active
- disabled
- invited

### lessons.status / challenges.status
- draft
- published
- archived

### learning_sessions.status
- provisioning
- active
- paused
- ended
- expired
- failed

### sandbox_instances.status
- requested
- provisioning
- ready
- busy
- resetting
- expiring
- destroyed
- failed

### query_executions.status
- accepted
- running
- succeeded
- failed
- timed_out
- blocked

## 10. Migration Strategy
- use timestamped migrations
- seed canonical roles and size tiers
- never mutate published version rows in place unless metadata-only and safe
- prefer new version rows for content evolution

## 11. Open Questions
- whether raw plan payload should stay in DB or move to object storage when very large
- whether challenge reference solutions should be encrypted or separately stored
- whether query preview rows should be truncated by bytes, row count, or both
