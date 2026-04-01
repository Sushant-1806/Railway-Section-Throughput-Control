"""app/routes/auth.py — Registration and login endpoints."""

from __future__ import annotations
import logging
from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token
from pydantic import ValidationError

from app.db import repository as repo
from app.schemas.validators import RegisterRequest, LoginRequest
from app.services.auth_service import hash_password, verify_password

logger = logging.getLogger(__name__)
auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.post("/register")
def register():
    try:
        body = RegisterRequest.model_validate(request.get_json(force=True) or {})
    except ValidationError as e:
        return jsonify({"status": "error", "message": e.errors()}), 400

    if repo.fetch_user_by_username(body.username):
        return jsonify({"status": "error", "message": "Username already taken"}), 409

    pw_hash = hash_password(body.password)
    user_id = repo.insert_user(body.username, body.email, pw_hash, body.role)

    token = create_access_token(
        identity=str(user_id),
        additional_claims={"role": body.role, "username": body.username},
    )
    return jsonify({"status": "ok", "access_token": token, "role": body.role}), 201


@auth_bp.post("/login")
def login():
    try:
        body = LoginRequest.model_validate(request.get_json(force=True) or {})
    except ValidationError as e:
        return jsonify({"status": "error", "message": e.errors()}), 400

    user = repo.fetch_user_by_username(body.username)
    if not user or not verify_password(body.password, user["password_hash"]):
        return jsonify({"status": "error", "message": "Invalid credentials"}), 401

    token = create_access_token(
        identity=str(user["user_id"]),
        additional_claims={"role": user["role"], "username": user["username"]},
    )
    return jsonify({
        "status": "ok",
        "access_token": token,
        "role": user["role"],
        "username": user["username"],
    })
