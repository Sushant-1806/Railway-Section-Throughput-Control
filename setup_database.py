"""
setup_database.py — One-time database initializer.

Run:  python setup_database.py

Creates the railway_control database, all tables (with users + direction
column), and inserts rich seed data including an admin user.
"""

import psycopg
from dotenv import load_dotenv
import os

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
    cur.execute("DROP TABLE IF EXISTS trains, scenarios, users CASCADE")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id       SERIAL PRIMARY KEY,
            username      VARCHAR(50)  UNIQUE NOT NULL,
            email         VARCHAR(255) UNIQUE NOT NULL,
            password_hash TEXT         NOT NULL,
            role          VARCHAR(20)  NOT NULL DEFAULT 'operator'
                              CHECK (role IN ('admin', 'operator')),
            created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("✅ Table 'users' ready.")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS scenarios (
            scenario_id SERIAL PRIMARY KEY,
            name        VARCHAR(255) NOT NULL,
            description TEXT,
            user_id     INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("✅ Table 'scenarios' ready.")

    cur.execute("""
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
    """)
    print("✅ Table 'trains' ready.")
    conn.commit()
    cur.close()


def seed_data(conn) -> None:
    cur = conn.cursor()

    # Admin user (password: admin123)
    import hashlib, secrets
    salt = secrets.token_hex(16)
    pw_hash = f"{salt}:{hashlib.sha256(f'{salt}admin123'.encode()).hexdigest()}"
    try:
        cur.execute(
            "INSERT INTO users (username, email, password_hash, role) VALUES (%s, %s, %s, 'admin') ON CONFLICT DO NOTHING",
            ("admin", "admin@railway.local", pw_hash),
        )
    except Exception:
        pass

    # Seed operator user (password: operator123)
    salt2 = secrets.token_hex(16)
    pw_hash2 = f"{salt2}:{hashlib.sha256(f'{salt2}operator123'.encode()).hexdigest()}"
    try:
        cur.execute(
            "INSERT INTO users (username, email, password_hash, role) VALUES (%s, %s, %s, 'operator') ON CONFLICT DO NOTHING",
            ("operator", "operator@railway.local", pw_hash2),
        )
    except Exception:
        pass

    conn.commit()

    cur.execute("SELECT user_id FROM users WHERE username = 'admin'")
    admin_id = cur.fetchone()[0]

    # ── Scenario 1: Simple Conflict ──────────────────────────────────────────
    cur.execute(
        "INSERT INTO scenarios (name, description, user_id) VALUES (%s, %s, %s) RETURNING scenario_id",
        ("Simple Section Conflict", "Two trains converging on Section C", admin_id),
    )
    s1 = cur.fetchone()[0]

    trains_s1 = [
        ("T101", "Express",   1, 85, "B", "E", 340, "forward"),
        ("T202", "Freight",   3, 55, "B", "L", 420, "forward"),
    ]
    for t in trains_s1:
        cur.execute(
            """INSERT INTO trains
               (scenario_id, train_id, train_type, priority, current_speed,
                current_section, destination, distance_to_destination, direction)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (s1,) + t,
        )
    print("✅ Scenario 1: Simple Section Conflict")

    # ── Scenario 2: Multi-Train ──────────────────────────────────────────────
    cur.execute(
        "INSERT INTO scenarios (name, description, user_id) VALUES (%s, %s, %s) RETURNING scenario_id",
        ("Multi-Train Rush", "Multiple trains across the network at peak hour", admin_id),
    )
    s2 = cur.fetchone()[0]

    trains_s2 = [
        ("T301", "Passenger", 1, 90,  "A", "E", 490, "forward"),
        ("T302", "Express",   2, 110, "C", "L", 410, "forward"),
        ("T303", "Freight",   4, 50,  "F", "H", 150, "forward"),
        ("T304", "Local",     3, 70,  "I", "L", 210, "forward"),
        ("T305", "Passenger", 2, 80,  "D", "A", 330, "backward"),
    ]
    for t in trains_s2:
        cur.execute(
            """INSERT INTO trains
               (scenario_id, train_id, train_type, priority, current_speed,
                current_section, destination, distance_to_destination, direction)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (s2,) + t,
        )
    print("✅ Scenario 2: Multi-Train Rush")

    # ── Scenario 3: Normal Operations ────────────────────────────────────────
    cur.execute(
        "INSERT INTO scenarios (name, description, user_id) VALUES (%s, %s, %s) RETURNING scenario_id",
        ("Normal Operations", "Trains on separate tracks with no conflicts", admin_id),
    )
    s3 = cur.fetchone()[0]

    trains_s3 = [
        ("T401", "Express",   1, 120, "A", "E", 490, "forward"),
        ("T402", "Passenger", 2, 80,  "H", "A", 500, "backward"),
        ("T403", "Freight",   3, 55,  "I", "L", 210, "forward"),
    ]
    for t in trains_s3:
        cur.execute(
            """INSERT INTO trains
               (scenario_id, train_id, train_type, priority, current_speed,
                current_section, destination, distance_to_destination, direction)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (s3,) + t,
        )
    print("✅ Scenario 3: Normal Operations")

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