# Dataset Generation Design

## 1. Goal
Generate realistic datasets across multiple size tiers from a canonical imported dataset while preserving schema semantics, business coverage, and relational integrity.

## 2. Canonical Source Model
- admin imports schema definition plus canonical row-count metadata as the source-of-truth for scaling
- the platform stores:
  - schema structure
  - row count per table
  - total row count
  - source scale classification based on total row count
  - system job metadata for import / generation auditability
- the imported source is treated as read-only; learner sandboxes never mutate it directly

## 3. Supported Learner Tiers
- tiny: around 100 rows
- small: around 10,000 rows
- medium: around 1M–5M rows
- large: above 10M rows

## 4. Scaling Rules
- learners may only choose tiers less than or equal to the imported source scale
- no upscaling in V1
- each smaller tier is a derived dataset template produced deterministically from the canonical row counts
- changing scale always reprovisions a sandbox from the selected template

## 5. Data Generation Principles
- deterministic when seeded
- maintain FK integrity
- preserve realistic cardinality distributions
- support skew where relevant for performance lessons
- preserve minimum business coverage for important dimensions such as status, category, and time ranges
- support precomputed artifacts for medium/large datasets when available

## 6. Downscale Strategy
To avoid data becoming inconsistent (too much / too little) when scaling down:
- identify anchor/root tables from schema configuration or infer them from the FK graph
- sample anchor entities deterministically using a stable seed
- use stratified sampling over important dimensions such as status, category, and time bucket so rare but meaningful cases still exist
- expand the sampled set through FK closure:
  - include required parent rows referenced by sampled children
  - include dependent child rows owned by sampled parents where the lesson depends on those relationships
- keep low-cardinality lookup tables fully when needed instead of sampling them aggressively
- apply validation gates before publish:
  - no orphaned foreign keys
  - no broken uniqueness / nullability assumptions
  - minimum coverage for important categorical values
  - row counts remain within the target tier budget

## 7. Template Components
- schema DDL
- source metadata manifest
- derivation rules / seed config
- canonical row-count source
- validation checks
- optional artifact manifest per scale

## 8. Generation Strategies
### Imported Canonical Source
Best for preserving real-world structure and metadata from an admin-provided database.

### Derived Smaller Artifacts
Good for producing tiny/small/medium tiers from the canonical source while preserving representative behavior.

### Imported Prepared Artifacts
Good for medium/large labs where generation cost or restore time is too high.

## 9. Job Flow
1. admin imports canonical schema metadata through the Admin API
2. import and generation jobs are recorded in `system_jobs`
3. source scale is classified from total row count
4. allowed target tiers are resolved from the source scale
5. derived dataset templates are generated for each supported smaller tier
6. worker restores from artifact if one exists for a template, otherwise seeds deterministically from row counts during sandbox provisioning
7. dataset templates are published for learner use

## 10. V1 Recommendation
Support a few canonical schemas:
- ecommerce
- social network
- analytics/events

Each imported source should publish:
- its exact source metadata
- its source scale
- all supported downscale dataset templates for learner sandboxes
