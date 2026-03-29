-- Deployments that already ran 0018 when it grandfathered to `ready` without fingerprint:
-- move back to `pending` so worker scan can enqueue golden-bake jobs. Rows with a fingerprint keep `ready`.
UPDATE "dataset_templates"
SET "sandbox_golden_status" = 'pending',
    "sandbox_golden_error" = NULL
WHERE "status" = 'published'
  AND "sandbox_golden_artifact_fingerprint" IS NULL
  AND "sandbox_golden_status" = 'ready';
