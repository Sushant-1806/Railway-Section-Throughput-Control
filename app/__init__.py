"""app/__init__.py — Application factory with SocketIO, JWT, and CORS configured."""

from __future__ import annotations
import logging
import logging.handlers
import os
from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO
from flask_jwt_extended import JWTManager

from app.config import Config
from app.db.pool import init_pool, close_pool
from app.services.simulator import init_simulator

# Global SocketIO instance (used in simulator)
socketio = SocketIO()
jwt = JWTManager()

def create_app() -> Flask:
    """Flask application factory."""
    app = Flask(__name__, static_folder="../static", static_url_path="/static")

    # ── Config ────────────────────────────────────────────────────────────────
    app.config["SECRET_KEY"] = Config.SECRET_KEY
    app.config["JWT_SECRET_KEY"] = Config.SECRET_KEY
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = Config.JWT_ACCESS_TOKEN_EXPIRES
    app.config["DEBUG"] = Config.DEBUG

    # ── Logging ───────────────────────────────────────────────────────────────
    _configure_logging()

    # ── Extensions ────────────────────────────────────────────────────────────
    CORS(app, origins=Config.CORS_ORIGINS, supports_credentials=True)
    jwt.init_app(app)
    socketio.init_app(
        app,
        cors_allowed_origins=Config.CORS_ORIGINS,
        async_mode=Config.SOCKETIO_ASYNC_MODE,
    )

    # ── Database pool ─────────────────────────────────────────────────────────
    init_pool()
    init_simulator(socketio)

    # ── Blueprints ────────────────────────────────────────────────────────────
    from app.routes.auth import auth_bp
    from app.routes.scenarios import scenarios_bp
    from app.routes.analysis import analysis_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(scenarios_bp)
    app.register_blueprint(analysis_bp)

    # ── SocketIO event handlers ───────────────────────────────────────────────
    _register_socket_events()

    # ── Teardown ──────────────────────────────────────────────────────────────
    @app.teardown_appcontext
    def shutdown_pool(exc):
        pass  # Pool is app-lifetime; close_pool() called on process exit

    import atexit
    atexit.register(close_pool)

    logging.getLogger(__name__).info("Railway Control API ready.")
    return app


def _register_socket_events() -> None:
    """Register WebSocket connection / room management events."""
    from flask_socketio import join_room, leave_room, emit

    @socketio.on("connect")
    def on_connect(auth):
        logging.getLogger(__name__).info("Client connected via WebSocket")

    @socketio.on("disconnect")
    def on_disconnect():
        logging.getLogger(__name__).info("Client disconnected")

    @socketio.on("join_scenario")
    def on_join(data):
        scenario_id = data.get("scenario_id")
        room = f"scenario_{scenario_id}"
        join_room(room)
        emit("joined", {"room": room})

    @socketio.on("leave_scenario")
    def on_leave(data):
        scenario_id = data.get("scenario_id")
        leave_room(f"scenario_{scenario_id}")


def _configure_logging() -> None:
    """Set up structured logging to console and a rotating file."""
    log_dir = os.path.join(os.path.dirname(__file__), "..", "logs")
    os.makedirs(log_dir, exist_ok=True)

    fmt = logging.Formatter(
        "[%(asctime)s] %(levelname)s %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    root = logging.getLogger()
    root.setLevel(logging.DEBUG if Config.DEBUG else logging.INFO)

    # Console
    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    root.addHandler(ch)

    # Rotating file
    fh = logging.handlers.RotatingFileHandler(
        os.path.join(log_dir, "railway.log"), maxBytes=5_000_000, backupCount=3
    )
    fh.setFormatter(fmt)
    root.addHandler(fh)
