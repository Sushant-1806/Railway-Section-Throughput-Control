"""
app/services/simulator.py — Real-time train movement simulation.

Runs as a background thread via Flask-SocketIO, updating train positions
every TICK_SECONDS and broadcasting via WebSocket events.
"""

from __future__ import annotations
import logging
import threading
import time
from typing import Any

from app.models.graph import NETWORK, shortest_path, path_distance, mark_edge_occupied, clear_edge_occupation
from app.services import ai_engine

logger = logging.getLogger(__name__)

TICK_SECONDS = 2.0  # simulation tick rate

# ── In-memory state (keyed by scenario_id) ────────────────────────────────────
_scenarios: dict[int, list[dict]] = {}
_running: dict[int, bool] = {}
_threads: dict[int, threading.Thread] = {}
_socketio = None  # injected at init


def init_simulator(socketio_instance) -> None:
    """Inject the SocketIO instance (called from app factory)."""
    global _socketio
    _socketio = socketio_instance


def start_simulation(scenario_id: int, trains: list[dict]) -> None:
    """Start real-time simulation for a scenario."""
    if scenario_id in _running and _running[scenario_id]:
        logger.warning("Simulation already running for scenario %d", scenario_id)
        return

    _scenarios[scenario_id] = [dict(t) for t in trains]
    _running[scenario_id] = True

    thread = threading.Thread(
        target=_simulation_loop,
        args=(scenario_id,),
        daemon=True,
        name=f"sim-{scenario_id}",
    )
    _threads[scenario_id] = thread
    thread.start()
    logger.info("Started simulation for scenario %d", scenario_id)


def stop_simulation(scenario_id: int) -> None:
    """Stop real-time simulation for a scenario."""
    _running[scenario_id] = False
    logger.info("Stopped simulation for scenario %d", scenario_id)


def get_train_states(scenario_id: int) -> list[dict]:
    """Return current in-memory train states for a scenario."""
    return _scenarios.get(scenario_id, [])


def update_train_override(scenario_id: int, train_id: str, updates: dict) -> None:
    """Apply manual override to a train in the simulation."""
    trains = _scenarios.get(scenario_id, [])
    for t in trains:
        if t["train_id"] == train_id:
            t.update(updates)
            break


# ── Simulation loop ───────────────────────────────────────────────────────────

def _simulation_loop(scenario_id: int) -> None:
    """Main tick loop: advance trains, detect conflicts, broadcast updates."""
    while _running.get(scenario_id, False):
        try:
            trains = _scenarios.get(scenario_id, [])
            if not trains:
                time.sleep(TICK_SECONDS)
                continue

            for train in trains:
                _advance_train(train)

            # Run AI analysis
            result = ai_engine.analyze(trains, lookahead_seconds=60)

            # Emit updates to all clients in the scenario's SocketIO room
            if _socketio:
                _socketio.emit(
                    "train_update",
                    {
                        "scenario_id": scenario_id,
                        "trains": trains,
                        "conflicts": result["conflicts"],
                    },
                    room=f"scenario_{scenario_id}",
                )

                if result["conflicts"]:
                    _socketio.emit(
                        "conflict_detected",
                        {
                            "scenario_id": scenario_id,
                            "conflicts": result["conflicts"],
                            "solutions": result["solutions"],
                        },
                        room=f"scenario_{scenario_id}",
                    )

        except Exception as exc:
            logger.exception("Simulation tick error for scenario %d: %s", scenario_id, exc)

        time.sleep(TICK_SECONDS)


def _advance_train(train: dict) -> None:
    """
    Move a train one tick forward along its graph path.
    Updates current_section, distance_to_destination, and status.
    """
    if train.get("status") in ("stopped", "arrived"):
        return
    if train.get("current_speed", 0) <= 0:
        return

    speed_kmh = float(train["current_speed"])
    speed_ms = speed_kmh / 3.6
    distance_covered_km = (speed_ms * TICK_SECONDS) / 1000

    current = train.get("current_section", "A")
    destination = train.get("destination", "L")

    if current == destination:
        train["status"] = "arrived"
        train["current_speed"] = 0
        return

    # Get path
    path = shortest_path(current, destination)
    if not path or len(path) < 2:
        train["status"] = "arrived"
        return

    # Move to next node if we've covered the edge distance
    next_node = path[1]
    edge_data = NETWORK.edges.get((current, next_node))
    if not edge_data:
        return

    edge_distance_km = edge_data["distance"]

    # Simple: if covered distance >= edge distance, advance to next node
    if distance_covered_km >= edge_distance_km:
        clear_edge_occupation(current, next_node, train["train_id"])
        train["current_section"] = next_node
        mark_edge_occupied(next_node, destination, train["train_id"])
    else:
        mark_edge_occupied(current, next_node, train["train_id"])

    # Update distance
    remaining = float(train.get("distance_to_destination", 0))
    train["distance_to_destination"] = max(0, remaining - distance_covered_km)

    # Respect speed limit
    speed_limit = edge_data.get("speed_limit", 130)
    if speed_kmh > speed_limit:
        train["current_speed"] = speed_limit
