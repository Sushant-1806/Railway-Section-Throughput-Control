# Railway Section Throughput Control

Railway Section Throughput Control is a full-stack railway operations demo for monitoring trains, detecting section conflicts, and recommending control actions in real time.

It combines a Flask API, Socket.IO updates, a React frontend, and PostgreSQL-backed scenario data so operators can inspect traffic, review analysis results, and test mitigation strategies.

## Features

- Real-time train and scenario updates over Socket.IO.
- Authentication with seeded admin and operator users.
- Scenario management with train conflict analysis.
- AI-assisted recommendations for conflict resolution.
- PostgreSQL persistence with seed data for demo scenarios.
- Docker Compose support for the full stack.

## Tech Stack

- Backend: Flask, Flask-SocketIO, Flask-JWT-Extended
- Database: PostgreSQL with psycopg3
- Frontend: React, Vite, Zustand, Socket.IO client
- Deployment: Gunicorn and Nginx in Docker

## Prerequisites

- Python 3.14+
- Node.js 20+
- PostgreSQL 16+

## Local Setup

### 1. Clone and install backend dependencies

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and update the database credentials if needed.

The main variables are:

- `DB_HOST`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_PORT`
- `SECRET_KEY`
- `SOCKETIO_ASYNC_MODE`
- `CORS_ORIGINS`

### 3. Create and seed the database

```bash
python setup_database.py
```

This creates the `railway_control` database, builds the tables, and inserts demo users and scenarios.

### 4. Start the backend

```bash
python run.py
```

The API runs on `http://localhost:5000`.

### 5. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite development server runs on `http://localhost:5173`.

## Docker

Run the full stack with Docker Compose:

```bash
docker compose up --build
```

The API container boots the database schema and seeds the five built-in sample scenarios automatically, so no manual initialization step is needed for Docker.

This starts:

- PostgreSQL on port `5432`
- Backend API on port `5000`
- Frontend on port `3000`

## Default Demo Accounts

The database seed script creates these users:

- `admin` / `admin123`
- `operator` / `operator123`

## Project Structure

- `app/` - Flask app, routes, services, database code, and schemas
- `frontend/` - React UI and client-side state management
- `setup_database.py` - One-time database initializer and seed script
- `run.py` - Backend entrypoint
- `docker-compose.yml` - Full-stack local deployment

## Testing

```bash
pytest
```

## Notes

- The backend is configured to use `SOCKETIO_ASYNC_MODE=threading`.
- Logs are written to the `logs/` directory.