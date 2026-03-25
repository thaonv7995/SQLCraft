# Security Model

## 1. Security Objectives
- protect platform metadata and infrastructure
- isolate learner environments
- prevent harmful SQL execution
- protect secrets and internal connectivity
- audit privileged operations

## 2. Threat Model
### Threats considered
- malicious SQL attempting destructive actions
- privilege escalation from learner query path
- sandbox breakout via filesystem or network
- abuse via heavy query spam / denial of service
- mistakes in user-submitted content exposing secrets
- admin misuse without auditability

## 3. Trust Boundaries
1. Browser to Web/API boundary
2. API to internal services boundary
3. Internal services to metadata DB boundary
4. Internal services to sandbox DB boundary
5. Runtime sandbox to infrastructure boundary

## 4. Identity and Access
- role-based access control is limited to `user` and `admin`
- signed-in users can access learner-facing APIs and submission workflows
- publish, moderation, and system operations remain admin-only
- service credentials separated by purpose
- no direct learner credentials for infrastructure or metadata DB

## 5. Sandbox Isolation
- isolated container or equivalent runtime
- no inbound public access to sandbox
- outbound network restricted or disabled if possible
- restricted DB role inside sandbox
- no superuser privileges for learner execution role

## 6. Query Safety Controls
### Pre-execution controls
- SQL parsing / statement classification
- allowlist enforcement
- multi-statement policy restriction
- row preview limits
- timeout configuration

### Runtime controls
- statement timeout
- max result size
- connection pool isolation
- per-user/session rate limit

## 7. Secrets Management
- secrets never committed to repo
- environment variables or secret manager for deployment
- separate credentials for metadata DB, sandbox provisioner, and worker subsystems
- credential rotation documented for hosted deployment

## 8. API Security
- HTTPS only
- bearer authentication
- CSRF protection if cookie-based auth is used
- standard input validation and output encoding
- rate limiting for auth and query endpoints

## 9. Auditability
Audit log actions include:
- content create/update/publish/archive
- role changes
- template changes
- manual sandbox admin intervention
- system job overrides

## 10. Supply Chain Security
- pinned container images where possible
- dependency scanning in CI
- signed releases encouraged
- CODEOWNERS / review rules for sensitive paths

## 11. Incident Response Baseline
- detect via logs/metrics/alerts
- revoke affected credentials if needed
- isolate affected nodes or workers
- preserve audit data
- document postmortem

## 12. Security Non-Goals for V1
- full enterprise compliance
- tenant-level custom network policies
- advanced data masking for arbitrary user-provided imports
