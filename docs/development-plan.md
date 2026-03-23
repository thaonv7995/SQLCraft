# Development Plan

## 1. Planning Principles
- ship vertical slices, not disconnected components
- complete core learner flow early
- keep docs updated alongside implementation
- use feature flags if partial work lands

## 2. Team Assumptions
Initial team:
- 1 Product/BA owner
- 1 Tech Lead
- 2–4 Full-stack / backend engineers
- 1 frontend-focused engineer optional
- contributors can join gradually

## 3. Workstreams
1. Platform foundation
2. Learning content system
3. Sandbox/runtime
4. Query execution and evaluation
5. Infra and observability
6. Documentation and contributor enablement

## 4. Milestones

### Milestone 1: Foundation
Duration: 2–3 weeks
Deliverables:
- monorepo setup
- auth skeleton
- metadata schema initial migrations
- CI pipeline
- coding standards
- docs skeleton

### Milestone 2: Content and Session Flow
Duration: 3–4 weeks
Deliverables:
- tracks/lessons/challenges CRUD
- publish flow
- learning session creation
- basic lesson rendering
- sandbox provisioning stub

### Milestone 3: Sandbox Execution
Duration: 4–5 weeks
Deliverables:
- real sandbox creation
- query execution path
- result preview
- timeout and allowlist enforcement
- reset flow

### Milestone 4: Evaluation and History
Duration: 3 weeks
Deliverables:
- query history
- challenge attempts
- evaluation engine (result-set validation)
- plan persistence and viewer baseline

### Milestone 5: Hardening
Duration: 2–3 weeks
Deliverables:
- observability
- cleanup workers
- repair jobs
- admin audit logging
- staging readiness

### Milestone 6: Release Readiness
Duration: 2 weeks
Deliverables:
- contributor docs
- seed lessons
- test coverage targets
- bug bash
- release notes

## 5. Suggested Sprint Breakdown
- Sprint 1: repo, CI, auth, base schema
- Sprint 2: content models and read APIs
- Sprint 3: session creation, queue, status polling
- Sprint 4: sandbox create/reset/destroy
- Sprint 5: query execution and UI integration
- Sprint 6: challenge evaluation and plan viewer
- Sprint 7: hardening and observability
- Sprint 8: launch prep

## 6. Definition of Done
A story is done when:
- acceptance criteria pass
- tests added or updated
- docs updated
- logs/metrics considered
- security implications reviewed
- migration and rollback considered if schema changes

## 7. Risks and Mitigations
- sandbox complexity → build thin abstraction early, start with one engine
- docs drift → require doc updates in PR template
- queue retries causing duplicates → enforce idempotency keys
- large template startup times → pre-generate artifacts, monitor p95

## 8. V1 Exit Criteria
- documented architecture and APIs
- stable end-to-end learning flow
- enough seeded content for demo and real usage
- acceptable observability and cleanup
- contributor onboarding path works
