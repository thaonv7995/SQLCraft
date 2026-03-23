# Scaling Strategy

## 1. Main Scaling Bottleneck
Sandbox density and provisioning throughput are likely to be the first bottlenecks, not basic API throughput.

## 2. Scaling Levers
- horizontal API replicas
- horizontal worker replicas
- more sandbox hosts
- prewarmed template pools for expensive lessons
- better TTL cleanup
- artifact-based restores for large datasets

## 3. Practical V1 Strategy
- keep API stateless
- keep workers idempotent
- monitor queue depth closely
- separate heavy lessons if needed
- cap concurrent sessions per user if abuse risk appears
