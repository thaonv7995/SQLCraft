# Testing Strategy

## 1. Test Layers
- unit tests
- integration tests
- end-to-end tests
- sandbox smoke tests
- migration tests

## 2. Critical Paths to Test
- auth
- publish/read content flow
- session creation and polling
- sandbox create/reset/destroy
- query execution
- blocked query handling
- challenge evaluation

## 3. Non-Functional Testing
- query timeout behavior
- cleanup correctness
- provisioning throughput
- load tests on queue and sandbox hosts
