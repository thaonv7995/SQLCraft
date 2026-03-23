# Software Requirements Specification (SRS)

## 1. Introduction
This document defines the functional and non-functional requirements for the V1 release of the Open Source SQL Learning Platform.

## 2. System Context
The system provides:
- a web application for learners
- a backend API for content and session orchestration
- a query execution subsystem
- isolated sandbox databases
- persistent metadata storage
- background workers for lifecycle and dataset operations

## 3. Functional Requirements

### FR-01 Authentication and Identity
The system shall:
- allow users to register, sign in, sign out
- support local auth and pluggable OAuth providers
- maintain roles for admin, maintainer, contributor, learner

### FR-02 Learning Tracks
The system shall:
- support tracks with metadata such as title, slug, summary, difficulty
- list published tracks
- list lessons within a track in defined order

### FR-03 Lessons
The system shall:
- support lesson entities independent from lesson versions
- allow multiple published and draft lesson versions over time
- associate a lesson version with one schema template and one dataset template
- render lesson content in markdown or structured content blocks

### FR-04 Challenges
The system shall:
- support one or more challenges under a lesson
- version challenge prompts and validation configs
- accept multiple attempts from a user
- mark attempts as pending, passed, failed, or errored

### FR-05 Learning Sessions
The system shall:
- create a learning session for a user and selected lesson version
- track session status: active, paused, ended, expired
- store last activity timestamp
- associate the session with a sandbox instance

### FR-06 Sandbox Provisioning
The system shall:
- create an isolated PostgreSQL sandbox for each active learning session
- provision the sandbox from a schema template and dataset template
- support reset to template state
- destroy idle or expired sandboxes
- record sandbox lifecycle events

### FR-07 Query Execution
The system shall:
- accept SQL submitted from the UI
- validate statement type before execution
- run SQL only inside the assigned sandbox
- enforce timeouts and row preview limits
- persist execution records and result metadata
- return structured errors when execution fails

### FR-08 Query Plan Inspection
The system shall:
- support EXPLAIN and EXPLAIN ANALYZE
- store full raw plan output separately from execution metadata
- expose simplified plan summaries to the UI

### FR-09 Evaluation Engine
The system shall:
- evaluate challenge attempts based on configured validation strategy
- support result-set validation in V1
- support optional performance thresholds in V1 for selected challenges
- store correctness score and performance score separately

### FR-10 Dataset and Schema Templates
The system shall:
- store schema template metadata and versioned DDL artifacts
- store dataset template metadata, size tier, and seed configuration
- support at least tiny, small, medium, large size tiers
- allow internal jobs to generate dataset artifacts

### FR-11 Query History
The system shall:
- display query history within a learning session
- show execution status, duration, submitted time, and whether evaluation passed
- allow reopening a prior query in the editor

### FR-12 Content Operations
The system shall:
- allow authorized maintainers to create and publish tracks, lessons, and challenge versions
- prevent unpublished content from appearing in learner-facing APIs
- keep audit logs for publish and content management actions

### FR-13 Observability and Operations
The system shall:
- log sandbox lifecycle events
- log query execution outcomes
- expose service metrics
- support job visibility for cleanup and seeding tasks

## 4. Non-Functional Requirements

### NFR-01 Performance
- p95 lesson page load API < 500 ms excluding sandbox creation
- p95 sandbox creation < 5 seconds for tiny/small templates
- p95 query metadata API < 300 ms
- UI query execution must return within configured timeout or fail clearly

### NFR-02 Scalability
- design for horizontal scaling of stateless services
- support thousands of concurrent active sessions through distributed workers and sandbox capacity planning
- avoid single points of failure in API and worker tiers

### NFR-03 Availability
- target service availability: 99.5% for hosted deployments
- degraded mode acceptable when sandbox capacity is limited; learner receives explicit error

### NFR-04 Security
- all sandbox connections are internal-only
- only allowed SQL categories execute
- destructive platform-level operations are blocked
- secrets are stored outside repo and injected at runtime
- audit logs are retained for privileged actions

### NFR-05 Reliability
- failed sandbox creation must not leave orphan metadata
- worker retries must be idempotent where possible
- cleanup routines must tolerate partial failures

### NFR-06 Maintainability
- modules must have clear boundaries
- APIs must be versioned
- content and runtime data models must be separated
- docs must be sufficient for external contributors

### NFR-07 Observability
- structured logs
- metrics for API, worker, sandbox, and query paths
- traceability across session creation, sandbox creation, and query execution

## 5. Constraints
- V1 uses PostgreSQL as the only learner-facing database engine
- V1 does not expose arbitrary DDL/DML beyond controlled allowlist
- sandbox provisioning is bounded by infrastructure capacity

## 6. External Interfaces
- Web UI over HTTPS
- Backend REST API
- Internal queue for async jobs
- Internal PostgreSQL connection to metadata DB
- Internal PostgreSQL connection to sandboxes

## 7. Acceptance Criteria Summary
The V1 system shall be accepted when the end-to-end flow works:
1. user logs in
2. user opens a lesson
3. system provisions a sandbox from the lesson’s published template
4. user runs allowed SQL
5. system shows results and plan
6. challenge attempt can be evaluated
7. reset returns sandbox to original state
8. idle sandbox is eventually cleaned up
