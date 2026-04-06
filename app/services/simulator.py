"""
app/services/simulator.py — Real-time train movement simulation.

Runs as a background thread via Flask-SocketIO, updating train positions
every TICK_SECONDS and broadcasting via WebSocket events.

Uses SIM_TIME_MULTIPLIER to accelerate simulation time so that demo
scenarios play out in seconds rather than hours.

Stopped trains auto-restart once the conflict that caused them to stop
has been resolved (no active conflict involving them).
"""

from __future__ import annotations
import logging
import threading
import time
from typing import Any

from app.models.graph import NETWORK, shortest_path, path_distance, mark_edge_occupied, clear_edge_occupation
from app.services import ai_engine

logger = logging.getLogger(__name__)

TICK_SECONDS = 0.5           # real-world seconds between ticks (2 ticks/sec for smoother updates)
SIM_TIME_MULTIPLIER = 600    # each tick simulates 600x real seconds (demo speed)
RESTART_DELAY_TICKS = 2      # ticks to wait after conflict clears before restarting

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

    _scenarios[scenario_id] = [
        {**t, "origin": t.get("current_section", "A"), "edge_progress": 0.0, "next_section": None, "path_progress": 0.0}
        for t in trains
    ]
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
            # If stopping, save original speed for later restart
            if updates.get("status") == "stopped" and t.get("current_speed", 0) > 0:
                t["_original_speed"] = t["current_speed"]
            t.update(updates)
            break


# ── Simulation loop ───────────────────────────────────────────────────────────

def _simulation_loop(scenario_id: int) -> None:
    """Main tick loop: advance trains, detect conflicts, auto-restart, broadcast."""
    while _running.get(scenario_id, False):
        try:
            trains = _scenarios.get(scenario_id, [])
            if not trains:
                time.sleep(TICK_SECONDS)
                continue

            # Advance all active trains
            for train in trains:
                _advance_train(train)

            # Run AI analysis for conflict detection
            result = ai_engine.analyze(trains, lookahead_seconds=60)
            active_conflicts = result["conflicts"]

            # Auto-restart stopped trains whose conflicts have cleared
            _auto_restart_trains(trains, active_conflicts)

            # Emit updates to all clients in the scenario's SocketIO room
            if _socketio:
                # Strip internal fields (prefixed with _) before sending
                clean_trains = [
                    {k: v for k, v in t.items() if not k.startswith("_")}
                    for t in trains
                ]
                _socketio.emit(
                    "train_update",
                    {
                        "scenario_id": scenario_id,
                        "trains": clean_trains,
                        "conflicts": active_conflicts,
                    },
                    room=f"scenario_{scenario_id}",
                )

                if active_conflicts:
                    _socketio.emit(
                        "conflict_detected",
                        {
                            "scenario_id": scenario_id,
                            "conflicts": active_conflicts,
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
    Uses SIM_TIME_MULTIPLIER to accelerate movement for demo purposes.

    Tracks fractional edge progress so the frontend can interpolate
    smooth positions between nodes.
    """
    if train.get("status") == "arrived":
        return
    if train.get("status") == "stopped":
        train["_stopped_ticks"] = train.get("_stopped_ticks", 0) + 1
        return
    if train.get("current_speed", 0) <= 0:
        return

    speed_kmh = float(train["current_speed"])
    speed_ms = speed_kmh / 3.6
    # Accelerated distance: multiply by SIM_TIME_MULTIPLIER for demo speed
    distance_covered_km = (speed_ms * TICK_SECONDS * SIM_TIME_MULTIPLIER) / 1000

    current = train.get("current_section", "A")
    destination = train.get("destination", "L")

    if current == destination:
        train["status"] = "arrived"
        train["current_speed"] = 0
        train["edge_progress"] = 0.0
        train["next_section"] = None
        return

    # Get the full path from the train's origin to destination for progress tracking
    origin = train.get("origin", current)
    full_path = shortest_path(origin, destination)
    full_total = _path_total_distance(full_path) if full_path else 0

    # Get path from current position
    path = shortest_path(current, destination)
    if not path or len(path) < 2:
        train["status"] = "arrived"
        train["edge_progress"] = 0.0
        train["next_section"] = None
        return

    # Start with any leftover edge progress from previous tick
    edge_progress = float(train.get("edge_progress", 0.0))
    first_edge_data = NETWORK.edges.get((path[0], path[1]))
    if first_edge_data and edge_progress > 0:
        # Convert fractional progress back to km remaining on current edge
        edge_km = first_edge_data["distance"]
        remaining_on_edge = edge_km * (1.0 - edge_progress)
    else:
        remaining_on_edge = None

    # Walk along the path, potentially crossing multiple edges in one tick
    remaining_distance = distance_covered_km
    current_node = current
    frac_progress = 0.0
    next_section = None

    for i in range(len(path) - 1):
        if path[i] != current_node:
            continue

        next_node = path[i + 1]
        edge_data = NETWORK.edges.get((current_node, next_node))
        if not edge_data:
            break

        edge_distance_km = edge_data["distance"]

        # On the first edge, account for already-traversed fraction
        if remaining_on_edge is not None:
            effective_edge_distance = remaining_on_edge
            remaining_on_edge = None  # Only applies to the first edge
        else:
            effective_edge_distance = edge_distance_km

        if remaining_distance >= effective_edge_distance:
            # Cross this edge entirely
            clear_edge_occupation(current_node, next_node, train["train_id"])
            remaining_distance -= effective_edge_distance
            current_node = next_node
            frac_progress = 0.0
            next_section = None
        else:
            # Partially along this edge
            mark_edge_occupied(current_node, next_node, train["train_id"])
            # Calculate fractional position along this edge
            already_covered = edge_distance_km - effective_edge_distance
            frac_progress = (already_covered + remaining_distance) / edge_distance_km
            frac_progress = max(0.0, min(1.0, frac_progress))
            next_section = next_node
            remaining_distance = 0
            break

    train["current_section"] = current_node
    train["edge_progress"] = frac_progress
    train["next_section"] = next_section

    # Compute overall path progress (0.0 to 1.0) from origin to destination
    if full_path and full_total > 0:
        # Distance from origin to current_node
        dist_to_current = 0
        for i in range(len(full_path) - 1):
            if full_path[i] == current_node:
                break
            edge = NETWORK.edges.get((full_path[i], full_path[i + 1]))
            if edge:
                dist_to_current += edge["distance"]
        # Add fractional edge progress
        if next_section and NETWORK.has_edge(current_node, next_section):
            dist_to_current += NETWORK.edges[current_node, next_section]["distance"] * frac_progress
        train["path_progress"] = max(0.0, min(1.0, dist_to_current / full_total))
    else:
        train["path_progress"] = 0.0

    # Check if arrived
    if current_node == destination:
        train["status"] = "arrived"
        train["current_speed"] = 0
        train["edge_progress"] = 0.0
        train["next_section"] = None
        train["path_progress"] = 1.0
        return

    # Update distance
    remaining = float(train.get("distance_to_destination", 0))
    train["distance_to_destination"] = max(0, remaining - distance_covered_km)

    # Respect speed limit on current edge
    next_path = shortest_path(current_node, destination)
    if next_path and len(next_path) > 1:
        edge_data = NETWORK.edges.get((current_node, next_path[1]))
        if edge_data:
            speed_limit = edge_data.get("speed_limit", 130)
            if speed_kmh > speed_limit:
                train["current_speed"] = speed_limit


def _path_total_distance(path: list[str] | None) -> float:
    """Sum edge distances along a path."""
    if not path:
        return 0
    total = 0
    for i in range(len(path) - 1):
        edge = NETWORK.edges.get((path[i], path[i + 1]))
        if edge:
            total += edge["distance"]
    return total


def _auto_restart_trains(trains: list[dict], active_conflicts: list[dict]) -> None:
    """
    Check stopped trains and restart them if their conflict has cleared.
    A train restarts when:
      1. It's been stopped for at least RESTART_DELAY_TICKS
      2. It's not involved in any active conflict
    """
    conflicting_train_ids = set()
    for conflict in active_conflicts:
        for tid in conflict.get("trains", []):
            conflicting_train_ids.add(tid)

    for train in trains:
        if train.get("status") != "stopped":
            continue

        train_id = train["train_id"]
        stopped_ticks = train.get("_stopped_ticks", 0)

        # Don't restart if still in an active conflict
        if train_id in conflicting_train_ids:
            continue

        # Wait a realistic delay before restarting
        if stopped_ticks < RESTART_DELAY_TICKS:
            continue

        # Restart the train
        original_speed = train.get("_original_speed", 60)
        train["current_speed"] = original_speed
        train["status"] = "active"

        # Clean up internal state
        train.pop("_stopped_ticks", None)
        train.pop("_original_speed", None)

        logger.info(
            "Auto-restarted train %s at %d km/h (conflict cleared after %d ticks)",
            train_id, original_speed, stopped_ticks,
        )
