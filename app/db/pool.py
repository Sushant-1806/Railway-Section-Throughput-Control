"""app/db/pool.py — Connection pool singleton using psycopg_pool."""

import logging
from psycopg_pool import ConnectionPool
from app.config import Config

logger = logging.getLogger(__name__)

_pool: ConnectionPool | None = None


def init_pool() -> None:
    """Initialize the global connection pool. Called once at app startup."""
    global _pool
    if _pool is not None:
        return

    conninfo = Config.get_conninfo()
    _pool = ConnectionPool(
        conninfo=conninfo,
        min_size=Config.DB_POOL_MIN,
        max_size=Config.DB_POOL_MAX,
        open=True,
    )
    logger.info(
        "DB pool initialized (min=%d, max=%d)", Config.DB_POOL_MIN, Config.DB_POOL_MAX
    )


def get_pool() -> ConnectionPool:
    """Return the active connection pool, raising if not initialized."""
    if _pool is None:
        raise RuntimeError("Connection pool not initialized. Call init_pool() first.")
    return _pool


def close_pool() -> None:
    """Gracefully close the pool on shutdown."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
        logger.info("DB pool closed.")
