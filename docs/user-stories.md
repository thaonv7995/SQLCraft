# User Stories

## 1. Learner Stories

### US-001 Start a lesson
As a learner, I want to open a lesson and start an isolated session so that I can practice without affecting others.

Acceptance Criteria:
- I can select a published lesson.
- The platform provisions a sandbox.
- I see a loading/provisioning state until sandbox is ready.

### US-002 Run a query
As a learner, I want to run SQL and see result rows so that I can validate my understanding.

Acceptance Criteria:
- I can submit SQL from the editor.
- If allowed, the query executes in my sandbox.
- I see columns, rows, and execution time.

### US-003 Understand failure
As a learner, I want clear blocked-query and runtime error messages so that I know what to fix.

### US-004 Inspect execution plan
As a learner, I want to see EXPLAIN / EXPLAIN ANALYZE output so that I understand optimizer behavior.

### US-005 Reset environment
As a learner, I want to reset my sandbox to a clean state so that I can retry from the beginning.

### US-006 Submit challenge
As a learner, I want the platform to evaluate my query so that I know whether I solved the challenge.

## 2. Maintainer Stories

### US-101 Create lesson shell
As a maintainer, I want to create a lesson record and version it so that content can evolve safely.

### US-102 Publish lesson version
As a maintainer, I want to publish a specific lesson version so that learners see stable content.

### US-103 Attach templates
As a maintainer, I want to associate schema and dataset templates with a lesson version so that the learner environment matches lesson content.

## 3. Admin Stories

### US-201 Audit privileged changes
As an admin, I want content publication and role changes logged so that I can review important actions.

### US-202 Monitor jobs
As an admin/operator, I want visibility into sandbox and dataset jobs so that I can debug failures.

## 4. Contributor Stories

### US-301 Add a new lesson
As a contributor, I want a documented workflow for adding lessons and tests so that I can contribute without guessing.
