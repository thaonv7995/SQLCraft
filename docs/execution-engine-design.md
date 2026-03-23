# Execution Engine Design

## 1. Purpose
Describe how SQL is validated, executed, measured, and persisted.

## 2. Responsibilities
- classify statement type
- enforce allowlist/blocklist
- execute query in sandbox
- capture execution metadata
- optionally collect EXPLAIN / EXPLAIN ANALYZE
- format preview payload for UI

## 3. Pipeline
1. Receive request with learning_session_id and SQL text.
2. Fetch sandbox assignment.
3. Normalize SQL and classify statement type.
4. Reject if blocked.
5. Apply execution context:
   - statement timeout
   - max row preview
   - role/user connection settings
6. Execute query.
7. Persist `query_executions`.
8. If requested, capture plan and persist `query_execution_plans`.
9. Return structured response.

## 4. Validation Rules
- no unsupported statement categories
- multi-statement submissions may be blocked in V1 unless explicitly safe
- max SQL length enforced
- comments stripped/normalized for classification where needed

## 5. Result Preview Strategy
- return limited rows only
- include column metadata
- truncate large values when necessary
- persist preview, not full result set

## 6. Metrics Captured
- duration_ms
- rows_returned
- rows_scanned when derivable
- planning time / execution time from plan
- optional block hit/read metrics if available

## 7. Error Handling
- blocked query
- timeout
- execution failure
- connection failure
- sandbox not ready
