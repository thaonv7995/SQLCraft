# Observability Design

## 1. Goals
- detect failures quickly
- understand query and sandbox bottlenecks
- support operator troubleshooting
- support capacity planning

## 2. Metrics
### API
- request count
- latency
- error rate

### Sandbox
- create time
- ready count
- active count
- cleanup count
- failed count

### Query
- success/fail/timeout counts
- duration distribution
- blocked statement counts

### Worker
- job queue depth
- retry counts
- job duration

## 3. Logs
- request logs
- sandbox lifecycle logs
- query execution outcome logs
- admin audit logs

## 4. Alerts
- sandbox creation failure spike
- queue backlog spike
- metadata DB connectivity loss
- elevated timeout rate
