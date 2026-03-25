# Product Requirements Document (PRD)

## 1. Document Control
- Product: Open Source SQL Platform
- Version: 1.0
- Scope: V1 release
- Audience: Product Owner, Business Analyst, Tech Lead, Engineering Team, Contributors

## 1.1 Canonical Product Language
- SQLCraft is a SQL platform, not a guided learning product.
- The only system roles are `user` and `admin`.
- User submissions are a workflow; they are not backed by a separate RBAC role.
- Legacy names such as `tracks`, `lessons`, `challenges`, and `learning_sessions` may still appear in code and schema until a dedicated rename track is completed.

## 2. Product Vision
Build an open-source SQL platform centered on sandboxed execution, realistic schemas, progressive data scale, versioned content, reviewed submissions, and production-grade query optimization workflows.

## 3. Problem Statement
Most existing SQL playgrounds and practice tools are strong in basic query execution but weak in:
- realistic schemas
- large datasets
- execution plan learning
- index experiments
- performance trade-off analysis
- safe hands-on sandboxing

Users can often write a correct query, but they do not understand:
- why it is slow
- how it scales
- how indexes change behavior
- how execution plans reflect optimizer decisions

## 4. Product Goals
### 4.1 Business / Community Goals
- create a high-quality open-source SQL platform with strong contributor appeal
- become a reference project for SQL execution, dataset operations, and query performance labs
- support community-authored content, datasets, and versioned resources

### 4.2 User Goals
- run SQL interactively
- understand how query behavior changes from 10 rows to 100M+ rows
- test optimization safely
- inspect result sets, query plans, and performance metrics in one place

### 4.3 Engineering Goals
- isolate user work in sandbox databases
- support content versioning
- support content authoring and future extensibility
- operate with clear observability and security boundaries

## 5. Target Users
### 5.1 SQL Users
Need reliable execution environments, clear feedback, and realistic datasets.

### 5.2 Backend Developers
Need realistic schemas, joins, indexes, and execution plan learning.

### 5.3 Data Engineers / Analysts
Need aggregate-heavy workloads, large-scale datasets, and performance comparison.

### 5.4 Admins / Maintainers
Need content governance, moderation workflow, versioning, and maintainable documentation.

## 6. User Problems
1. “I can write SELECT queries but don’t understand joins deeply.”
2. “I know syntax, but not how to optimize queries.”
3. “Online SQL tools use toy data, so performance lessons feel fake.”
4. “I want to compare two queries and see why one is faster.”
5. “I want to experiment safely without breaking shared state.”
6. “I want to see exactly what I changed in the schema while optimizing.”

## 7. Product Scope
### 7.1 In Scope for V1
- user authentication
- versioned content tracks and entries
- versioned lesson and challenge content
- isolated sandbox database per active session
- query execution with restrictions
- result preview
- EXPLAIN / EXPLAIN ANALYZE viewer
- query history and reopening prior executions
- side-by-side query comparison within a session
- challenge attempts and evaluation with correctness + performance scoring
- schema templates and dataset templates
- progressive dataset sizes
- sandbox schema diff against the published base template
- reset sandbox to the published base state
- observability baseline
- contributor workflow docs

### 7.2 Out of Scope for V1
- native mobile app
- enterprise SSO
- billing/payments
- live collaborative editing
- instructor classroom grading console
- multi-engine support beyond PostgreSQL in initial V1
- AI assistant for SQL generation

## 8. Value Proposition
**Run SQL from correctness to performance.**
The platform combines:
- versioned content
- realistic relational schemas
- scalable datasets
- sandbox isolation
- query execution plans
- optimization experimentation

## 9. Key Capabilities
### 9.1 Interactive SQL Lab
Users can write SQL and view:
- tabular results
- query duration
- row counts
- scanned rows (when available)
- execution plan
- errors and hints

### 9.2 Progressive Dataset Scaling
Same lesson concepts can be practiced against the same schema and a canonical imported dataset across multiple size tiers:
- tiny: around 100 rows
- small: around 10K rows
- medium: 1M–5M rows
- large: 10M+ rows

Additional product rules:
- imported canonical datasets are classified by total row count, while the exact row count is preserved as metadata
- users may only choose scales at or below the imported database's source scale
- no dataset upscaling in V1
- changing scale reprovisions the sandbox from the selected dataset template; worker restores from artifact when available or falls back to deterministic synthetic loading rather than resizing the live sandbox in place

### 9.3 Query Optimization Labs
Users can:
- compare two valid queries side-by-side
- keep experimental runs in session query history
- create and drop indexes within controlled boundaries
- inspect schema drift from the published base schema, including indexes, views, materialized views, functions, and partitions
- reset the sandbox back to the published base state after experiments
- analyze plan changes
- learn trade-offs between readability and performance
- receive a score breakdown that can include correctness, performance, and index optimization

### 9.4 Lesson Engine
Structured learning:
- track → lesson → challenge
- versioned content
- challenge validators
- difficulty tiers

## 10. Success Metrics
### 10.1 Product Metrics
- monthly active users
- content completion rate
- median session length
- average queries per session
- percentage of users using plan viewer
- number of successful challenge submissions

### 10.2 Community Metrics
- number of contributors
- merged PRs per month
- number of community-authored lessons
- documentation coverage

### 10.3 Platform Metrics
- median sandbox creation time
- query success rate
- query timeout rate
- sandbox cleanup success rate
- p95 query execution time for UI requests

## 11. User Experience Principles
- immediate feedback
- visible cause-and-effect for optimization
- safe experimentation
- consistent execution workflow
- low friction contributor onboarding

## 12. Assumptions
- PostgreSQL is sufficient as the first engine for V1
- users accept sandbox limits in exchange for safety and stability
- lessons and datasets will evolve frequently, so versioning is mandatory
- open-source adoption depends heavily on documentation quality

## 13. Risks
- sandbox cost/resource usage may grow faster than expected
- lesson authoring may become hard without strong conventions
- large datasets can increase infrastructure complexity
- query restriction logic may be bypassed if implemented weakly

## 14. Release Criteria for V1
V1 is ready when:
- users can sign in and start a session
- a sandbox is provisioned from a template
- lessons can load published content
- queries can execute safely
- results and plans are visible
- attempts and history are persisted
- users can compare two executions side-by-side inside the lab
- schema drift and reset-to-base workflows operate correctly inside the sandbox
- idle sandboxes are cleaned up
- core observability is enabled
- docs are sufficient for contributor onboarding
