"""
Application configuration loaded from environment variables.
Never hardcode secrets — use .env file (see .env.example).
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # ── Database ──────────────────────────────────────────────────────────────
    DB_HOST: str = os.getenv("DB_HOST", "localhost")
    DB_NAME: str = os.getenv("DB_NAME", "railway_control")
    DB_USER: str = os.getenv("DB_USER", "postgres")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")
    DB_PORT: int = int(os.getenv("DB_PORT", 5432))

    DB_POOL_MIN: int = int(os.getenv("DB_POOL_MIN", 2))
    DB_POOL_MAX: int = int(os.getenv("DB_POOL_MAX", 10))

    # Connection string for psycopg3
    @classmethod
    def get_conninfo(cls) -> str:
        return (
            f"host={cls.DB_HOST} "
            f"dbname={cls.DB_NAME} "
            f"user={cls.DB_USER} "
            f"password={cls.DB_PASSWORD} "
            f"port={cls.DB_PORT}"
        )

    # ── Security ──────────────────────────────────────────────────────────────
    SECRET_KEY: str = os.getenv("SECRET_KEY", "dev-insecure-key-change-me")
    JWT_ACCESS_TOKEN_EXPIRES: int = 3600  # seconds

    # ── Flask ─────────────────────────────────────────────────────────────────
    DEBUG: bool = os.getenv("FLASK_DEBUG", "True").lower() == "true"
    ENV: str = os.getenv("FLASK_ENV", "development")

    # ── CORS ──────────────────────────────────────────────────────────────────
    CORS_ORIGINS: list[str] = os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"
    ).split(",")

    # ── SocketIO ──────────────────────────────────────────────────────────────
    SOCKETIO_ASYNC_MODE: str = os.getenv("SOCKETIO_ASYNC_MODE", "threading")
