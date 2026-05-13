from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from screenwriter.config import settings

# Create database engine — use Supabase URL if configured, local PG otherwise
_db_url = settings.effective_database_url
_connect_args = {}
if "supabase" in _db_url:
    _connect_args["sslmode"] = "require"

engine = create_engine(_db_url, connect_args=_connect_args)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """Initialize the database connection and apply any pending migrations."""
    from screenwriter.services.db_migrator import run_migrations
    run_migrations(engine)