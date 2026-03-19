-- Migration: Add Custom Workflows Support
-- Date: 2026-03-13
-- Description: Create custom_workflows table for the Workflow Builder feature.
--              Stores workflow configurations with JSONB columns for variable
--              and section definitions. Supports the dynamic feature renderer.

-- ============================================================================
-- STEP 1: Create custom_workflows table
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'custom_workflows'
    ) THEN
        CREATE TABLE custom_workflows (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            description TEXT,

            -- Workflow template reference
            template_filename TEXT NOT NULL,
            original_workflow JSONB NOT NULL,

            -- Configuration (JSONB for flexible schema evolution)
            variable_config JSONB NOT NULL DEFAULT '[]'::jsonb,
            section_config JSONB NOT NULL DEFAULT '[]'::jsonb,

            -- Feature metadata
            output_type TEXT NOT NULL DEFAULT 'image'
                CHECK (output_type IN ('image', 'video', 'audio')),
            studio TEXT,
            icon TEXT DEFAULT '⚡',
            gradient TEXT DEFAULT 'from-blue-500 to-purple-600',

            -- Status
            is_published BOOLEAN NOT NULL DEFAULT false,

            -- Metadata
            created_by UUID REFERENCES auth.users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        RAISE NOTICE 'Created custom_workflows table';
    ELSE
        RAISE NOTICE 'custom_workflows table already exists';
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Create indexes
-- ============================================================================

-- Slug lookup (unique index via UNIQUE constraint above, explicit for clarity)
CREATE INDEX IF NOT EXISTS idx_custom_workflows_slug
    ON custom_workflows(slug);

-- Published workflow filtering
CREATE INDEX IF NOT EXISTS idx_custom_workflows_published
    ON custom_workflows(is_published);

-- Studio filtering for published workflows only (partial index)
CREATE INDEX IF NOT EXISTS idx_custom_workflows_studio
    ON custom_workflows(studio)
    WHERE is_published = true;

-- ============================================================================
-- STEP 3: Add column comments
-- ============================================================================

COMMENT ON TABLE custom_workflows IS 'Custom workflow configurations created via the Workflow Builder';
COMMENT ON COLUMN custom_workflows.slug IS 'URL-safe identifier derived from name, used as template filename';
COMMENT ON COLUMN custom_workflows.template_filename IS 'Filename in backend/workflows/custom/ directory';
COMMENT ON COLUMN custom_workflows.original_workflow IS 'Raw ComfyUI API-format JSON as uploaded, preserved for re-parsing';
COMMENT ON COLUMN custom_workflows.variable_config IS 'JSONB array of variable definitions: [{node_id, input_name, label, type, default, ...}]';
COMMENT ON COLUMN custom_workflows.section_config IS 'JSONB array of section definitions: [{name, variable_ids}]';
COMMENT ON COLUMN custom_workflows.output_type IS 'Type of output this workflow produces: image, video, or audio';
COMMENT ON COLUMN custom_workflows.is_published IS 'Whether this workflow is visible to non-admin users';

-- ============================================================================
-- STEP 4: Verify migration
-- ============================================================================

DO $$
DECLARE
    table_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'custom_workflows'
    ) INTO table_exists;

    IF table_exists THEN
        RAISE NOTICE 'Migration 008_add_custom_workflows completed successfully!';
        RAISE NOTICE 'custom_workflows table ready for Workflow Builder';
    ELSE
        RAISE WARNING 'Migration may have failed - please check table creation';
    END IF;
END $$;
