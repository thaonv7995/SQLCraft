# Sandbox Design

## 1. Goal
Provide a safe, isolated, resettable SQL execution environment for each active learning session.

## 2. Sandbox Principles
- one learner session must not affect another
- sandbox state must be disposable
- reset must return to known clean template state
- sandbox network access must be restricted
- lifecycle must be observable
- scale changes must recreate the sandbox from a selected dataset template, never delete rows in place inside the live sandbox

## 3. Sandbox Model
### Recommended V1 Model
**One PostgreSQL sandbox container per active learning session**, provisioned from a selected schema template and dataset template.

Why:
- strongest isolation
- easiest mental model
- easy reset by recreate/reseed
- contributor-friendly ops model

## 4. Sandbox Lifecycle
### States
- requested
- provisioning
- ready
- busy
- resetting
- expiring
- destroyed
- failed

### Lifecycle Steps
1. Session created.
2. Sandbox creation job enqueued.
3. Container started using base image.
4. Schema template applied.
5. Selected dataset is restored from artifact or seeded deterministically from template row counts.
6. Readiness checks pass.
7. Status becomes `ready`.
8. User runs queries.
9. Reset or TTL expiration eventually destroys sandbox.

## 5. Provisioning Strategies
### 5.1 DDL + Seed Scripts
Best for tiny/small datasets.
Pros:
- simple
- transparent
Cons:
- slower for large datasets

### 5.2 Snapshot/Artifact Restore
Best for medium/large datasets.
Pros:
- faster restore
- deterministic
- avoids expensive live downscale operations during session startup
Cons:
- more artifact management complexity

### V1 Recommendation
- tiny/small: seed scripts
- medium/large: restore from prepared artifact when available
- scale switching: hard reprovision from the target template, not in-place resize

## 6. Reset Strategies
### Hard Reset
Destroy container and recreate from template.
Best default for V1.

### Scale Change
Changing dataset scale should follow the same hard reprovision model as reset:
- current sandbox is discarded
- a new sandbox is provisioned from the selected derived dataset template
- query history may remain, but the runtime database state starts clean for the new scale

### Soft Reset
Truncate/reload tables inside same container.
May be used later for optimization, but more error-prone.

## 7. Access Model
- sandbox is never directly exposed to end user network
- API/Query Executor connects over internal network
- learner interacts only through platform APIs

## 8. Resource Controls
Per sandbox:
- CPU limit
- memory limit
- max connections
- disk quota if feasible
- statement timeout
- idle timeout

## 9. Allowed SQL Policy
Default V1 allowlist:
- SELECT
- WITH ... SELECT
- EXPLAIN
- EXPLAIN ANALYZE
- CREATE INDEX
- DROP INDEX

Default V1 blocklist:
- DROP TABLE
- ALTER SYSTEM
- CREATE EXTENSION
- COPY ... PROGRAM
- VACUUM FULL
- transaction control beyond allowed scope if it risks stuck sessions

## 10. Health Checks
A sandbox is ready only when:
- container is running
- DB connection succeeds
- expected tables exist
- user role and permissions are correct
- statement timeout settings are applied

## 11. Cleanup Strategy
### TTL-Based Cleanup
Destroy sandbox after configured idle period.

### Session-End Cleanup
When session ends explicitly, sandbox enters expedited cleanup.

### Repair Cleanup
Periodic worker scans for orphaned containers or metadata drift.

## 12. Observability
Tracked events:
- create_requested
- create_started
- template_applied
- dataset_loaded
- ready
- reset_requested
- reset_completed
- expired
- destroyed
- failed

## 13. Open Questions
- whether to prewarm large-template sandboxes
- whether to support pooled dormant sandboxes for faster startup
- whether future engines need a common sandbox abstraction layer
