import json
import sqlite3
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, String, Text, Enum as SAEnum
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.types import TypeDecorator
from unittest.mock import AsyncMock, patch

from screenwriter.models.database import Base
from screenwriter.main import app
from screenwriter.db import get_db

SQLALCHEMY_TEST_DATABASE_URL = "sqlite://"


class VectorAsText(TypeDecorator):
    """Serialize vector lists to JSON text for SQLite test engine.

    SafeVector uses a custom bind_processor that formats list to pgvector's
    "[v1,v2,...]" notation. When replaced with plain Text(), SQLite receives
    a raw Python list and fails. This TypeDecorator stores lists as JSON
    strings so SQLite can round-trip them without error.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, (list, tuple)):
            return json.dumps(value)
        return value

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, str):
            try:
                return json.loads(value)
            except (ValueError, TypeError):
                return value
        return value


def _patch_uuid_columns_for_sqlite():
    """Patch PostgreSQL UUID columns, Enum columns, and SafeVector columns to work with SQLite."""
    from sqlalchemy.dialects.postgresql import UUID as PG_UUID
    from screenwriter.models.database import SafeVector

    # Tell sqlite3 how to adapt Python UUID objects to strings
    sqlite3.register_adapter(uuid.UUID, lambda u: str(u))

    for table in Base.metadata.tables.values():
        for column in table.columns:
            if isinstance(column.type, PG_UUID):
                column.type = String(36)
                if column.default is not None and callable(column.default.arg):
                    # Check by function name+module (not identity) since SQLAlchemy
                    # may wrap the callable, making `is uuid.uuid4` fail.
                    fn = column.default.arg
                    if getattr(fn, '__name__', '') == 'uuid4' and getattr(fn, '__module__', '') == 'uuid':
                        # Accept optional ctx arg (SQLAlchemy passes execution context
                        # when using RETURNING-based inserts)
                        column.default.arg = lambda *_args: str(uuid.uuid4())
            elif isinstance(column.type, SAEnum):
                # SQLite doesn't support native enums; use String instead
                column.type = String(50)
            elif isinstance(column.type, SafeVector):
                # SQLite doesn't support vector types; use VectorAsText to
                # serialize/deserialize list values as JSON strings.
                column.type = VectorAsText()


@pytest.fixture(scope="session")
def test_engine():
    """Create a test database engine (SQLite in-memory)."""
    _patch_uuid_columns_for_sqlite()
    engine = create_engine(
        SQLALCHEMY_TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="function")
def db_session(test_engine):
    """Create a fresh database session for each test."""
    TestSessionLocal = sessionmaker(
        autocommit=False, autoflush=False, bind=test_engine
    )
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()

@pytest.fixture(scope="function")
def client(db_session):
    """Create a test client with overridden DB dependency."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()

@pytest.fixture
def mock_auth_headers():
    """Return headers with mock authentication token."""
    return {"Authorization": "Bearer mock-token"}


@pytest.fixture
def mock_embed():
    """Mock embedding_service.embed_text to return a fixed 1536-float vector.

    Use this fixture in any test that triggers snippet creation or editing,
    so no live OpenAI calls are made during the test suite.
    """
    fake_embedding = [0.1] * 1536
    with patch(
        "app.services.embedding_service.embedding_service.embed_text",
        new_callable=AsyncMock,
        return_value=fake_embedding,
    ) as mock:
        yield mock
