# Query Evaluation Design

## 1. Purpose
Evaluate learner submissions for correctness and selected performance goals.

## 2. Evaluation Types
### Result-Set Equality
Compare returned rows/columns to expected output.

### Canonical Check
For some challenges, validate against a reference query.

### Performance Threshold
Optional for advanced labs. Example:
- must complete under X ms
- must avoid sequential scan on table Y
- must use index scan or limit scanned rows threshold

## 3. V1 Scope
- result-set equality mandatory
- performance threshold optional for selected advanced challenges only

## 4. Evaluation Output
- is_correct
- correctness_score
- performance_score
- feedback_text
- evaluation_payload
