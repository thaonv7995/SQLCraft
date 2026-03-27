-- Dataset scale for challenge sandboxes (set at challenge create/edit, not per submission)

ALTER TABLE "challenges"
ADD COLUMN IF NOT EXISTS "dataset_scale" "dataset_size" NOT NULL DEFAULT 'small';
