-- Apportioned targets before FK-aware materialization (actual rows in `row_counts`).
ALTER TABLE "dataset_templates" ADD COLUMN IF NOT EXISTS "requested_row_counts" jsonb;
