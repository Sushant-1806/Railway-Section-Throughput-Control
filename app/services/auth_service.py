"""
app/services/auth_service.py — JWT-based authentication helpers.
"""

from __future__ import annotations
import logging
import hashlib
import secrets

logger = logging.getLogger(__name__)


def hash_password(password: str) -> str:
    """Hash a password using SHA-256 with a random salt."""
    salt = secrets.token_hex(16)
    hashed = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
    return f"{salt}:{hashed}"


def verify_password(plain: str, stored: str) -> bool:
    """Verify a plaintext password against a stored salt:hash string."""
    try:
        salt, hashed = stored.split(":")
        return hashlib.sha256(f"{salt}{plain}".encode()).hexdigest() == hashed
    except ValueError:
        return False
