"""
setup_database.py — Idempotent database bootstrapper.

Run:  python setup_database.py

Creates the railway_control database if needed, ensures the schema exists,
and seeds the canonical demo users plus five sample scenarios.
"""

import hashlib
import os
import secrets

import psycopg
from dotenv import load_dotenv

from app.data.sample_scenarios import SAMPLE_SCENARIOS

load_dotenv()

ROOT_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "dbname": "postgres",
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", ""),
    "port": int(os.getenv("DB_PORT", 5432)),
}

DB_NAME = os.getenv("DB_NAME", "railway_control")


def get_conn(dbname: str = DB_NAME) -> psycopg.Connection:
    return psycopg.connect(
        host=ROOT_CONFIG["host"],
        dbname=dbname,
        user=ROOT_CONFIG["user"],
        password=ROOT_CONFIG["password"],
        port=ROOT_CONFIG["port"],
        autocommit=(dbname == "postgres"),
    )


def create_database() -> None:
    print(f"📦 Creating database '{DB_NAME}'...")
    conn = get_conn("postgres")
    cur = conn.cursor()
    try:
        cur.execute(f"CREATE DATABASE {DB_NAME}")
        print(f"✅ Database '{DB_NAME}' created.")
    except Exception as e:
        if "already exists" in str(e):
            print(f"ℹ️  Database '{DB_NAME}' already exists — skipping.")
        else:
            raise
    finally:
        cur.close()
        conn.close()


def create_tables(conn) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            user_id       SERIAL PRIMARY KEY,
            username      VARCHAR(50)  UNIQUE NOT NULL,
            email         VARCHAR(255) UNIQUE NOT NULL,
            password_hash TEXT         NOT NULL,
            role          VARCHAR(20)  NOT NULL DEFAULT 'operator'
                              CHECK (role IN ('admin', 'operator')),
            created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    print("✅ Table 'users' ready.")

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS scenarios (
            scenario_id  SERIAL PRIMARY KEY,
            name         VARCHAR(255) NOT NULL,
            description  TEXT,
            user_id      INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            sample_key   TEXT,
            is_sample    BOOLEAN NOT NULL DEFAULT FALSE,
            sample_order INTEGER,
            created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    print("✅ Table 'scenarios' ready.")

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS trains (
            id                      SERIAL PRIMARY KEY,
            scenario_id             INTEGER REFERENCES scenarios(scenario_id) ON DELETE CASCADE,
            train_id                VARCHAR(50)  NOT NULL,
            train_type              VARCHAR(50)  NOT NULL,
            priority                INTEGER      NOT NULL,
            current_speed           INTEGER      NOT NULL,
            current_section         VARCHAR(50)  NOT NULL,
            destination             VARCHAR(100) NOT NULL,
            distance_to_destination INTEGER      NOT NULL,
            direction               VARCHAR(10)  NOT NULL DEFAULT 'forward',
            status                  VARCHAR(50)  NOT NULL DEFAULT 'active',
            created_at              TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    print("✅ Table 'trains' ready.")

    _ensure_schema_extensions(cur)
    conn.commit()
    cur.close()


def _ensure_schema_extensions(cur) -> None:
    cur.execute("ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS sample_key TEXT")
    cur.execute("ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE")
    cur.execute("ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS sample_order INTEGER")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_scenarios_sample_key ON scenarios (sample_key)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_trains_scenario_train_id ON trains (scenario_id, train_id)")


def _password_hash(password: str) -> str:
    salt = secrets.token_hex(16)
    return f"{salt}:{hashlib.sha256(f'{salt}{password}'.encode()).hexdigest()}"


def _upsert_user(cur, username: str, email: str, password: str, role: str) -> None:
    cur.execute(
        """
        INSERT INTO users (username, email, password_hash, role)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (username) DO UPDATE SET
            email = EXCLUDED.email,
            password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role
        """,
        (username, email, _password_hash(password), role),
    )


def _find_sample_row(cur, sample: dict) -> int | None:
    cur.execute("SELECT scenario_id FROM scenarios WHERE sample_key = %s", (sample["sample_key"],))
    row = cur.fetchone()
    if row:
        return row[0]

    for legacy_name in sample.get("legacy_names", []):
        cur.execute(
            "SELECT scenario_id FROM scenarios WHERE name = %s ORDER BY created_at ASC LIMIT 1",
            (legacy_name,),
        )
        row = cur.fetchone()
        if row:
            return row[0]

    return None


def _insert_train(cur, scenario_id: int, train: dict) -> None:
    cur.execute(
        """
        INSERT INTO trains
            (scenario_id, train_id, train_type, priority, current_speed,
             current_section, destination, distance_to_destination, direction)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (scenario_id, train_id) DO NOTHING
        """,
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


def seed_data(conn) -> None:
    cur = conn.cursor()

    _upsert_user(cur, "admin", "admin@railway.local", "admin123", "admin")
    _upsert_user(cur, "operator", "operator@railway.local", "operator123", "operator")
    conn.commit()

    for sample in SAMPLE_SCENARIOS:
        scenario_id = _find_sample_row(cur, sample)
        if scenario_id is None:
            cur.execute(
                """
                INSERT INTO scenarios (name, description, user_id, sample_key, is_sample, sample_order)
                VALUES (%s, %s, NULL, %s, TRUE, %s)
                RETURNING scenario_id
                """,
                (
                    sample["name"],
                    sample["description"],
                    sample["sample_key"],
                    sample["sample_order"],
                ),
            )
            scenario_id = cur.fetchone()[0]
        else:
            cur.execute(
                """
                UPDATE scenarios
                SET name = %s,
                    description = %s,
                    user_id = NULL,
                    sample_key = %s,
                    is_sample = TRUE,
                    sample_order = %s
                WHERE scenario_id = %s
                """,
                (
                    sample["name"],
                    sample["description"],
                    sample["sample_key"],
                    sample["sample_order"],
                    scenario_id,
                ),
            )
            cur.execute("DELETE FROM trains WHERE scenario_id = %s", (scenario_id,))

        for train in sample["trains"]:
            _insert_train(cur, scenario_id, train)

        print(f"✅ Sample scenario ready: {sample['name']} ({len(sample['trains'])} trains)")

    conn.commit()
    cur.close()


if __name__ == "__main__":
    try:
        create_database()
        conn = get_conn()
        conn.autocommit = False
        create_tables(conn)
        seed_data(conn)
        conn.close()
        print("\n✨ Database setup complete!")
        print("👤 Default users:")
        print("   admin    / admin123    (role: admin)")
        print("   operator / operator123 (role: operator)")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        raise
