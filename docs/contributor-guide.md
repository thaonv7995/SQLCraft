# Contributor Guide

## 1. Purpose
This guide helps contributors understand repository structure, setup, workflow, and expectations.

## 2. Repository Layout
```text
/apps
  /web        # learner/admin frontend
  /api        # REST API
  /worker     # background jobs

/packages
  /ui         # shared UI components
  /types      # shared types
  /config     # eslint, tsconfig, shared config
  /sql-core   # sql parsing/classification helpers
  /content    # lesson/challenge schemas and helpers

/infra
  /docker
  /k8s
  /scripts
  /templates

/docs
```

## 3. Local Setup
1. Clone repo.
2. Install dependencies.
3. Copy environment example files.
4. Start metadata DB and Redis.
5. Start API, worker, and web app.
6. Start local sandbox runtime support.

## 4. Branching and PRs
- create a feature branch from main
- keep PRs small where possible
- include docs updates for user-facing or architectural changes
- use conventional commit style if adopted by repo

## 5. Coding Expectations
- TypeScript strict mode where applicable
- tests for core modules
- avoid hidden coupling between content and runtime domains
- prefer explicit status enums and typed DTOs
- log meaningful structured events

## 6. Documentation Expectations
Update docs when changing:
- API behavior
- schema
- architecture decisions
- contributor workflow
- template format

## 7. Testing Expectations
- unit tests for domain logic
- integration tests for API flows
- sandbox smoke tests
- migration tests where practical

## 8. Security Expectations
- do not commit secrets
- be careful with SQL parsing and execution paths
- flag any security-sensitive change in PR description

## 9. Good First Contribution Areas
- docs improvements
- lesson content
- plan viewer UI
- admin content screens
- audit and job visibility improvements
