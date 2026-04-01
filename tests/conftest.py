"""tests/conftest.py — Shared pytest fixtures."""

import pytest
from unittest.mock import patch, MagicMock


@pytest.fixture
def app():
    """Create test Flask app with mocked DB pool."""
    with patch("app.db.pool.init_pool"), \
         patch("app.services.simulator.init_simulator"):
        from app import create_app
        test_app = create_app()
        test_app.config["TESTING"] = True
        test_app.config["JWT_SECRET_KEY"] = "test-secret"
        yield test_app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def auth_headers(client):
    """Register + login and return Bearer token headers."""
    with patch("app.db.repository.fetch_user_by_username", return_value=None), \
         patch("app.db.repository.insert_user", return_value=1):
        client.post("/api/auth/register", json={
            "username": "testuser",
            "email": "test@test.com",
            "password": "password123",
            "role": "operator",
        })

    from app.services.auth_service import hash_password
    pw_hash = hash_password("password123")
    mock_user = {
        "user_id": 1,
        "username": "testuser",
        "email": "test@test.com",
        "password_hash": pw_hash,
        "role": "operator",
    }
    with patch("app.db.repository.fetch_user_by_username", return_value=mock_user):
        resp = client.post("/api/auth/login", json={
            "username": "testuser",
            "password": "password123",
        })
    token = resp.get_json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
