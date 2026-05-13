# backend/app/services/db_migrator.py
#
# Startup migration runner.
# On every app start it:
#   1. Creates schema_migrations table if it doesn't exist (safety net for
#      databases created before migration tracking was added).
#   2. If schema_migrations is empty and the `projects` table already exists,
#      marks 000_baseline as applied (existing DB from before tracking).
#   3. Reads backend/migrations/delta/NNN_*.sql files in order and applies any
#      that haven't been recorded yet, then records them.
#
# Fresh DB flow:  docker-entrypoint-initdb.d runs init_db.sql which creates
#   schema_migrations and inserts 000_baseline.  Runner finds nothing to apply.
#
# Existing DB flow (no -v wipe):  schema_migrations already exists (or is
#   created here); runner applies only new delta files.
#
# Adding a schema change:
#   Create backend/migrations/delta/NNN_description.sql with idempotent SQL,
#   e.g. "ALTER TABLE foo ADD COLUMN IF NOT EXISTS bar TEXT DEFAULT '';"
#   It will be applied automatically on the next app restart.

import logging
import re
from pathlib import Path

from sqlalchemy import text

logger = logging.getLogger(__name__)

DELTA_DIR = Path(__file__).parent.parent / "migrations" / "delta"
INIT_SQL = Path(__file__).parent.parent / "migrations" / "init_db.sql"


def run_migrations(engine) -> None:
    """Apply any pending delta migrations.  Called once at app startup."""
    with engine.connect() as conn:
        # --- Step 1: ensure tracking table exists ---
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id         SERIAL PRIMARY KEY,
                migration  VARCHAR(255) UNIQUE NOT NULL,
                applied_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        conn.commit()

        # --- Step 2: baseline detection for pre-tracking databases ---
        baseline_recorded = conn.execute(
            text("SELECT COUNT(*) FROM schema_migrations WHERE migration = '000_baseline'")
        ).scalar()

        if not baseline_recorded:
            projects_exist = conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'projects'
                )
            """)).scalar()

            if projects_exist:
                conn.execute(
                    text("INSERT INTO schema_migrations (migration) VALUES ('000_baseline') ON CONFLICT DO NOTHING")
                )
                conn.commit()
                logger.info("db_migrator: marked existing database as baseline")
            elif INIT_SQL.exists():
                # Fresh database (e.g. first connection to Supabase) — bootstrap from init_db.sql
                logger.info("db_migrator: fresh database detected, bootstrapping from init_db.sql")
                init_sql = INIT_SQL.read_text()
                conn.execute(text(init_sql))
                conn.commit()
                logger.info("db_migrator: bootstrap complete")

        # --- Step 3: collect applied migrations ---
        applied = {
            row[0] for row in
            conn.execute(text("SELECT migration FROM schema_migrations")).fetchall()
        }

        # --- Step 4: apply pending delta files ---
        if not DELTA_DIR.exists():
            return

        delta_files = sorted(
            f for f in DELTA_DIR.iterdir()
            if f.suffix == ".sql" and re.match(r"^\d+_", f.name)
        )

        for migration_file in delta_files:
            migration_name = migration_file.stem
            if migration_name in applied:
                continue

            logger.info(f"db_migrator: applying {migration_name}")
            sql = migration_file.read_text()
            conn.execute(text(sql))
            conn.execute(
                text("INSERT INTO schema_migrations (migration) VALUES (:name)"),
                {"name": migration_name},
            )
            conn.commit()
            logger.info(f"db_migrator: applied {migration_name}")

        if delta_files:
            pending = [f.stem for f in delta_files if f.stem not in applied]
            if not pending:
                logger.info("db_migrator: all migrations up to date")
