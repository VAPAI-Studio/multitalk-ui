# Delta Migrations

Files here are applied automatically at backend startup by `db_migrator.py`.

## Naming convention

```
NNN_short_description.sql
```

Examples: `001_add_user_preferences.sql`, `002_index_on_books_title.sql`

## Rules

- Files must match `^\d+_` — leading digits followed by underscore.
- Use **idempotent SQL** (`IF NOT EXISTS`, `IF NOT EXIST`, `ON CONFLICT DO NOTHING`).
- Never modify or delete an already-applied file — add a new one instead.
- `000_baseline` is reserved; it marks databases created before migration tracking existed.

## Current baseline

The full schema lives in `../init_db.sql`.  Everything in that file is
already applied on fresh databases via docker-entrypoint-initdb.d.
Only *new* changes since that baseline need a delta file.
