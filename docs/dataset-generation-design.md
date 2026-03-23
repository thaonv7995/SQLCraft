# Dataset Generation Design

## 1. Goal
Generate realistic datasets across multiple size tiers while preserving schema semantics and relational integrity.

## 2. Size Tiers
- tiny
- small
- medium
- large

## 3. Data Generation Principles
- deterministic when seeded
- maintain FK integrity
- preserve realistic cardinality distributions
- support skew where relevant for performance lessons
- support precomputed artifacts for large datasets

## 4. Template Components
- schema DDL
- seed config
- generator code or import source
- validation checks
- artifact manifest

## 5. Generation Strategies
### Generated Data
Good for small/medium labs with flexible parameters.

### Imported Prepared Artifacts
Good for large labs where generation cost is too high.

## 6. Job Flow
1. job created in `system_jobs`
2. generator loads schema template
3. rows produced or artifact restored
4. integrity checks run
5. artifact manifest stored
6. dataset template status updated

## 7. V1 Recommendation
Support a few canonical schemas:
- ecommerce
- social network
- analytics/events

Each schema should have multiple dataset tiers.
