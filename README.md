# Railway Control

Railway Control is a full-stack railway operations dashboard for monitoring train movement, analyzing section conflicts, and applying control actions in real time.

It combines a Flask API, Socket.IO updates, a React frontend, and PostgreSQL-backed scenario data so operators can inspect traffic, review AI recommendations, and watch a live animated track map.

## Features

- Real-time train movement and conflict updates over Socket.IO.
- Dark and light theme support.
- Authentication with seeded admin and operator users.
- Scenario management with five built-in sample scenarios.
- AI-assisted conflict analysis and solution application.
- A dynamic track map that animates train movement.
- Docker Compose support for the full stack.

## Sample Scenarios

Five canonical demo scenarios are seeded automatically:

1. Section Convergence - 2 trains
2. Morning Commuter Merge - 3 trains
3. Mixed Corridor Pressure - 4 trains
4. Harbor Freight Release - 5 trains
5. Peak Hour Network Surge - 6 trains

Sample scenarios are protected from deletion in the UI and API.

## Tech Stack

- Backend: Flask, Flask-SocketIO, Flask-JWT-Extended
- Database: PostgreSQL with psycopg3
- Frontend: React, Vite, Zustand, Socket.IO client
- Deployment: Gunicorn and Nginx in Docker

## Quick Start

Docker is the simplest way to run the project:

```bash
docker compose up --build
```

This starts:

- PostgreSQL on port `5432`
- Backend API on port `5000`
- Frontend on port `3000`

The API container bootstraps the database schema and seeds the demo data automatically, so no manual database setup is required when running through Docker.

Open the app at `http://localhost:3000`.

## Local Development

### Backend

PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SOCKETIO_ASYNC_MODE = 'threading'
python setup_database.py
python run.py
```

The API runs on `http://localhost:5000`.

If you are using a non-Windows shell, set `SOCKETIO_ASYNC_MODE=threading` with your shell's environment syntax before starting the backend.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite development server runs on `http://localhost:5173` and proxies `/api` and `/socket.io` to the backend.

## Default Demo Accounts

The database seed script creates these users:

- `admin` / `admin123`
- `operator` / `operator123`

## Typical Demo Flow

1. Sign in with a seeded account.
2. Load a sample scenario from the dashboard.
3. Run traffic analysis to inspect conflicts and recommended solutions.
4. Apply a solution to update train state.
5. Start or stop the simulation to watch the live map animate the trains.

## Testing

```bash
python -m pytest -q
cd frontend
npm run build
```

## Project Structure

- `app/` - Flask app, routes, services, database code, and schemas
- `frontend/` - React UI and client-side state management
- `setup_database.py` - Database bootstrapper and seed script
- `run.py` - Backend entrypoint
- `docker-compose.yml` - Full-stack local deployment

## Notes

- The backend uses `SOCKETIO_ASYNC_MODE=threading` for local Python startup.
- Logs are written to the `logs/` directory.