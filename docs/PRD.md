# Product Requirements Document (PRD)

## 1. Document Control
- Product: Open Source SQL Learning Platform
- Version: 1.0
- Scope: V1 release
- Audience: Product Owner, Business Analyst, Tech Lead, Engineering Team, Contributors

## 2. Product Vision
Build an open-source learning platform that teaches SQL from fundamentals to production-grade query optimization using realistic schemas, progressive data scale, and isolated sandbox databases per learning session.

## 3. Problem Statement
Most existing SQL learning platforms are strong in syntax training but weak in:
- realistic schemas
- large datasets
- execution plan learning
- index experiments
- performance trade-off analysis
- safe hands-on sandboxing

Learners can often write a correct query, but they do not understand:
- why it is slow
- how it scales
- how indexes change behavior
- how execution plans reflect optimizer decisions

## 4. Product Goals
### 4.1 Business / Community Goals
- create a high-quality open-source learning platform with strong contributor appeal
- become a reference project for SQL education and query performance labs
- support community-authored lessons, datasets, and learning tracks

### 4.2 User Goals
- learn SQL interactively
- understand how query behavior changes from 10 rows to 100M+ rows
- practice optimization safely
- inspect result sets, query plans, and performance metrics in one place

### 4.3 Engineering Goals
- isolate user work in sandbox databases
- support content versioning
- support lesson authoring and future extensibility
- operate with clear observability and security boundaries

## 5. Target Users
### 5.1 Beginner Learners
Need guided lessons, instant feedback, and simple datasets.

### 5.2 Backend Developers
Need realistic schemas, joins, indexes, and execution plan learning.

### 5.3 Data Engineers / Analysts
Need aggregate-heavy workloads, large-scale datasets, and performance comparison.

### 5.4 Instructors / Contributors
Need lesson authoring workflow, versioning, and maintainable documentation.

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
- learning tracks and lessons
- versioned lesson and challenge content
- isolated sandbox database per learning session
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
**Learn SQL from correctness to performance.**
The platform combines:
- guided lessons
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
- learners may only choose scales at or below the imported database's source scale
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
- monthly active learners
- lesson completion rate
- median session length
- average queries per learning session
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
- consistent learning progression
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
- users can sign in and start a learning session
- a sandbox is provisioned from a template
- lessons can load published content
- queries can execute safely
- results and plans are visible
- attempts and history are persisted
- learners can compare two executions side-by-side inside the lab
- schema drift and reset-to-base workflows operate correctly inside the sandbox
- idle sandboxes are cleaned up
- core observability is enabled
- docs are sufficient for contributor onboarding
