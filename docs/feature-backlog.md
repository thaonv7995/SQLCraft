# Feature Backlog

## Prioritization Key
- P0: mandatory for V1
- P1: high value for V1.x / near-term
- P2: future / optional

## P0 Features
### Identity
- [ ] user registration/login
- [ ] role model
- [ ] profile basics

### Content
- [ ] tracks
- [ ] lessons
- [ ] lesson versions
- [ ] challenges
- [ ] challenge versions
- [ ] published content read APIs
- [ ] schema templates CRUD
- [ ] dataset templates CRUD
- [ ] async dataset generation (Tiny, Small, Medium, Large scaling)

### Runtime
- [ ] learning session creation
- [ ] sandbox provisioning
- [x] sandbox reset
- [ ] sandbox cleanup
- [ ] sandbox status polling

### Query
- [ ] CodeMirror SQL editor integration (syntax highlighting & autocompletion)
- [ ] execute allowed SQL
- [ ] result preview
- [x] query history
- [ ] EXPLAIN / EXPLAIN ANALYZE visualizer tree
- [ ] plan storage
- [ ] timeout handling
- [ ] blocked statement feedback
- [x] safe index creation/dropping (CREATE/DROP INDEX)
- [ ] visual schema & database explorer UI

### Evaluation
- [ ] challenge attempts
- [ ] result-set validation
- [ ] correctness scoring
- [x] basic performance scoring for selected labs
- [ ] leaderboard and competitive rankings

### Ops
- [ ] audit logs
- [ ] system jobs
- [ ] queue workers
- [ ] structured logs
- [ ] service metrics

## P1 Features
- [ ] saved drafts per lesson
- [ ] admin lesson/challenge editor (Rich Markdown + SQL validator)
- [ ] user contribution workflow & admin approval dashboard
- [ ] auto-scan and parse uploaded SQL database dumps
- [x] query compare side-by-side
- [x] schema diff view and reset sandbox to base
- [ ] plan diff view
- [ ] lesson search
- [ ] tag filters
- [ ] admin moderation for contributed lessons
- [ ] richer plan summaries
- [ ] prewarmed sandbox pools

## P2 Features
- [ ] multiple DB engines
- [ ] instructor dashboard
- [ ] team mode
- [ ] classroom assignments
- [ ] public lesson marketplace
- [ ] AI hints
