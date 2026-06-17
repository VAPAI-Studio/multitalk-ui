-- Migration 010: register the Image Grid Seedream workflow
--
-- The backend resolves a job's workflow_name against the `workflows` table.
-- Image Grid Seedream is a new Image Studio app, so it needs a row here or
-- job creation fails with "Unknown workflow: image-grid-seedream".
--
-- Idempotent: only inserts if the row does not already exist.

INSERT INTO workflows (name, output_type, display_name, description)
SELECT 'image-grid-seedream',
       'image',
       'Image Grid Seedream',
       'Generate a 3x3 grid of image variations using ByteDance Seedream'
WHERE NOT EXISTS (
    SELECT 1 FROM workflows WHERE name = 'image-grid-seedream'
);
