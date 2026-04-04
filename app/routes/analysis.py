"""app/routes/analysis.py — AI analysis and solution application endpoints."""

from __future__ import annotations
import logging
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from pydantic import ValidationError

from app.db import repository as repo
from app.schemas.validators import AnalyzeRequest, ApplySolutionRequest
from app.services import ai_engine
from app.services.simulator import (
    start_simulation,
    stop_simulation,
    get_train_states,
    update_train_override,
)
from app.models.graph import get_nodes, get_edges

logger = logging.getLogger(__name__)
analysis_bp = Blueprint("analysis", __name__, url_prefix="/api")


@analysis_bp.post("/analyze")
@jwt_required()
def analyze():
    try:
        body = AnalyzeRequest.model_validate(request.get_json(force=True) or {})
    except ValidationError as e:
        return jsonify({"status": "error", "message": e.errors()}), 400

    trains_raw = [t.model_dump() for t in body.trains]
    result = ai_engine.analyze(trains_raw, body.lookahead_seconds)
    return jsonify(result)


@analysis_bp.post("/apply-solution")
@jwt_required()
def apply_solution():
    try:
        body = ApplySolutionRequest.model_validate(request.get_json(force=True) or {})
    except ValidationError as e:
        return jsonify({"status": "error", "message": e.errors()}), 400

    trains_raw = [t.model_dump() for t in body.trains]

    # Re-run analysis to get the actual solutions
    result = ai_engine.analyze(trains_raw)
    target = next(
        (s for s in result["solutions"] if s["solution_id"] == body.solution_id),
        None,
    )
    if not target:
        return jsonify({"status": "error", "message": "Solution not found"}), 404

    # Build a Solution-like object for apply_solution
    from app.services.ai_engine import Solution
    sol = Solution(
        solution_id=target["solution_id"],
        solution_type=target["type"],
        description=target["description"],
        actions=target["actions"],
        impact=target["impact"],
        delay_seconds=target["delay_seconds"],
        confidence=target["confidence"],
        priority=target["priority"],
        addresses_conflict=target["addresses_conflict"],
    )

    updated = ai_engine.apply_solution(sol, trains_raw)

    if body.scenario_id is not None:
        for train in updated:
            repo.update_train_state(body.scenario_id, train["train_id"], train)

    return jsonify({"status": "ok", "trains": updated})


@analysis_bp.post("/simulation/start/<int:scenario_id>")
@jwt_required()
def start_sim(scenario_id: int):
    from app.db import repository as repo
    trains = repo.fetch_trains_by_scenario(scenario_id)
    if not trains:
        return jsonify({"status": "error", "message": "No trains in scenario"}), 404
    start_simulation(scenario_id, trains)
    return jsonify({"status": "ok", "message": f"Simulation started for scenario {scenario_id}"})


@analysis_bp.post("/simulation/stop/<int:scenario_id>")
@jwt_required()
def stop_sim(scenario_id: int):
    stop_simulation(scenario_id)
    return jsonify({"status": "ok", "message": f"Simulation stopped for scenario {scenario_id}"})


@analysis_bp.get("/simulation/state/<int:scenario_id>")
@jwt_required()
def sim_state(scenario_id: int):
    trains = get_train_states(scenario_id)
    return jsonify({"trains": trains})


@analysis_bp.post("/simulation/override")
@jwt_required()
def manual_override():
    data = request.get_json(force=True) or {}
    scenario_id = data.get("scenario_id")
    train_id = data.get("train_id")
    updates = data.get("updates", {})
    if not scenario_id or not train_id:
        return jsonify({"status": "error", "message": "scenario_id and train_id required"}), 400
    update_train_override(scenario_id, train_id, updates)
    repo.update_train_state(scenario_id, train_id, updates)
    return jsonify({"status": "ok"})


@analysis_bp.get("/network")
def get_network():
    """Return the railway graph nodes and edges for visualization."""
    return jsonify({"nodes": get_nodes(), "edges": get_edges()})
