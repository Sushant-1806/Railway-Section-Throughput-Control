"""app/routes/scenarios.py — Scenario CRUD endpoints."""

from __future__ import annotations
import logging
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from pydantic import ValidationError

from app.db import repository as repo
from app.schemas.validators import CreateScenarioRequest

logger = logging.getLogger(__name__)
scenarios_bp = Blueprint("scenarios", __name__, url_prefix="/api")


@scenarios_bp.get("/scenarios")
@jwt_required()
def list_scenarios():
    user_id = int(get_jwt_identity())
    scenarios = repo.fetch_all_scenarios(user_id)
    return jsonify(scenarios)


@scenarios_bp.get("/scenario/<int:scenario_id>")
@jwt_required()
def get_scenario(scenario_id: int):
    scenario = repo.fetch_scenario_by_id(scenario_id)
    if not scenario:
        return jsonify({"status": "error", "message": "Scenario not found"}), 404

    trains = repo.fetch_trains_by_scenario(scenario_id)
    return jsonify({"scenario": scenario, "trains": trains})


@scenarios_bp.post("/scenario")
@jwt_required()
def create_scenario():
    user_id = int(get_jwt_identity())

    try:
        body = CreateScenarioRequest.model_validate(request.get_json(force=True) or {})
    except ValidationError as e:
        errors = []
        for error in e.errors():
            cleaned = dict(error)
            cleaned.pop("ctx", None)
            errors.append(cleaned)
        return jsonify({"status": "error", "message": "Invalid scenario payload", "errors": errors}), 400

    scenario_id = repo.insert_scenario(body.name, body.description, user_id)
    for train in body.trains:
        repo.insert_train(scenario_id, train.model_dump())

    return jsonify({"status": "ok", "scenario_id": scenario_id}), 201


@scenarios_bp.delete("/scenario/<int:scenario_id>")
@jwt_required()
def delete_scenario(scenario_id: int):
    scenario = repo.fetch_scenario_by_id(scenario_id)
    if not scenario:
        return jsonify({"status": "error", "message": "Scenario not found"}), 404

    if scenario.get("is_sample") or scenario.get("sample_key"):
        return jsonify({"status": "error", "message": "Sample scenarios cannot be deleted"}), 403

    deleted = repo.delete_scenario(scenario_id)
    if not deleted:
        return jsonify({"status": "error", "message": "Scenario not found"}), 404
    return jsonify({"status": "ok", "message": "Scenario deleted"})
