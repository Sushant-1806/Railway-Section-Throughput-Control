"""app/db/repository.py — All database queries in one place."""

import logging
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Generator

from psycopg.rows import dict_row
from app.db.pool import get_pool

logger = logging.getLogger(__name__)


@contextmanager
def get_conn() -> Generator:
    """Context manager that yields a connection from the pool with dict rows."""
    pool = get_pool()
    with pool.connection() as conn:
        conn.row_factory = dict_row
        try:
            yield conn
        except Exception:
            conn.rollback()
            raise


# ── Scenarios ─────────────────────────────────────────────────────────────────

def fetch_all_scenarios(user_id: int | None = None) -> list[dict]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            if user_id is not None:
                cur.execute(
                    "SELECT * FROM scenarios WHERE user_id = %s OR user_id IS NULL ORDER BY created_at DESC",
                    (user_id,),
                )
            else:
                cur.execute("SELECT * FROM scenarios ORDER BY created_at DESC")
            return cur.fetchall()


def fetch_scenario_by_id(scenario_id: int) -> dict | None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM scenarios WHERE scenario_id = %s", (scenario_id,))
            return cur.fetchone()


def fetch_trains_by_scenario(scenario_id: int) -> list[dict]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM trains WHERE scenario_id = %s ORDER BY train_id",
                (scenario_id,),
            )
            return cur.fetchall()


def insert_scenario(name: str, description: str, user_id: int | None = None) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO scenarios (name, description, user_id) VALUES (%s, %s, %s) RETURNING scenario_id",
                (name, description, user_id),
            )
            row = cur.fetchone()
        conn.commit()
    return row["scenario_id"]


def insert_train(scenario_id: int, train: dict) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO trains
                   (scenario_id, train_id, train_type, priority, current_speed,
                    current_section, destination, distance_to_destination,
                    direction, status)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'active')""",
                (
                    scenario_id,
                    train["train_id"],
                    train["train_type"],
                    train["priority"],
                    train["current_speed"],
                    train["current_section"],
                    train["destination"],
                    train["distance_to_destination"],
                    train.get("direction", "forward"),
                ),
            )
        conn.commit()


def delete_scenario(scenario_id: int) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM scenarios WHERE scenario_id = %s RETURNING scenario_id",
                (scenario_id,),
            )
            deleted = cur.fetchone()
        conn.commit()
    return deleted is not None


# ── Users ─────────────────────────────────────────────────────────────────────

def fetch_user_by_username(username: str) -> dict | None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE username = %s", (username,))
            return cur.fetchone()


def fetch_user_by_id(user_id: int) -> dict | None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE user_id = %s", (user_id,))
            return cur.fetchone()


def insert_user(username: str, email: str, password_hash: str, role: str = "operator") -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (username, email, password_hash, role) VALUES (%s, %s, %s, %s) RETURNING user_id",
                (username, email, password_hash, role),
            )
            row = cur.fetchone()
        conn.commit()
    return row["user_id"]


# ── Train State (in-memory overlay for simulation) ────────────────────────────

def update_train_state(scenario_id: int, train_id: str, updates: dict) -> None:
    """Update a train's mutable fields in the database."""
    allowed = {"current_speed", "current_section", "status", "distance_to_destination", "direction"}
    fields = {k: v for k, v in updates.items() if k in allowed}
    if not fields:
        return

    set_clause = ", ".join(f"{k} = %s" for k in fields)
    values = list(fields.values()) + [train_id, scenario_id]

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE trains SET {set_clause} WHERE train_id = %s AND scenario_id = %s",
                values,
            )
        conn.commit()
