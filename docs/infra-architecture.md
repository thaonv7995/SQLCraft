# Infrastructure Architecture

## 1. Goal
Provide a deployable infrastructure model for hosted and self-hosted environments.

## 2. Baseline V1 Deployment Topology
- Web app deployment
- API deployment
- Worker deployment
- Metadata PostgreSQL
- Redis
- Object storage
- Sandbox runtime hosts or Kubernetes node pool

## 3. Environment Types
### Local Development
- docker compose
- single-node metadata DB
- single redis
- local object storage emulator or filesystem
- sandbox containers on local Docker

### Staging
- lower-scale hosted deployment
- realistic observability
- template artifacts similar to production
- load and failure testing

### Production
- multiple API replicas
- multiple worker replicas
- managed or HA metadata DB
- durable object storage
- dedicated sandbox capacity

## 4. Compute Layout
### Option A: Docker Hosts
- simpler ops for self-hosting
- sandbox manager talks to Docker daemon/API
- good for early hosted deployments

### Option B: Kubernetes
- easier scaling and scheduling long term
- sandbox per pod or per job model
- stronger automation ecosystem

### V1 Recommendation
Start with Docker-host based reference deployment and keep abstractions compatible with Kubernetes migration.

## 5. Storage Components
### Metadata PostgreSQL
Durable state for platform data.

### Object Storage
Stores:
- dataset artifacts
- schema/template artifacts
- exported logs or large plan payloads if needed

### Redis
Stores:
- job queues
- transient coordination state
- rate limiting counters

## 6. Networking
- public ingress only for web/API
- internal-only metadata DB access
- internal-only sandbox connectivity
- sandbox outbound access minimized

## 7. Observability Stack
- Prometheus for metrics
- Grafana for dashboards
- structured logs to standard sink
- OpenTelemetry traces if feasible in V1 hosted deployment

## 8. Backup and Recovery
### Metadata DB
- automated daily backups
- PITR if supported by chosen deployment

### Object Storage
- versioning recommended for critical artifacts
- periodic artifact integrity checks

### Sandboxes
- no backup required; disposable by design

## 9. Capacity Planning Considerations
- number of concurrent sandboxes
- average memory per sandbox
- heavy templates needing more disk
- worker throughput for provisioning/reset
- queue depth alerts

## 10. Example Hosted Topology
```text
Internet
  |
Load Balancer / Ingress
  |
  +-- Web App
  +-- API Service (replicas)
         |
         +-- Metadata PostgreSQL
         +-- Redis
         +-- Worker Service (replicas)
                |
                +-- Docker Sandbox Hosts / K8s Cluster
                +-- Object Storage
```
