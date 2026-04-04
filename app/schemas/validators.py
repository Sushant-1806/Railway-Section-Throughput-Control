"""
app/schemas/validators.py — Pydantic v2 request/response schemas.
All API inputs are validated here before touching business logic.
"""

from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field, field_validator


# ── Auth ──────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., pattern=r"^[\w\.\+\-]+@[\w\-]+\.[a-z]{2,}$")
    password: str = Field(..., min_length=6)
    role: Literal["admin", "operator"] = "operator"


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


# ── Trains ────────────────────────────────────────────────────────────────────

class TrainInput(BaseModel):
    train_id: str = Field(..., min_length=1, max_length=20, pattern=r"^[A-Z0-9\-]+$")
    train_type: Literal["Express", "Passenger", "Freight", "Local"]
    priority: int = Field(..., ge=1, le=5)
    current_speed: int = Field(..., ge=0, le=250)
    current_section: str = Field(..., min_length=1)
    destination: str = Field(..., min_length=1)
    distance_to_destination: int = Field(..., ge=0)
    direction: Literal["forward", "backward"] = "forward"

    @field_validator("train_id")
    @classmethod
    def train_id_uppercase(cls, v: str) -> str:
        return v.upper()


# ── Scenarios ─────────────────────────────────────────────────────────────────

class CreateScenarioRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field("", max_length=1000)
    trains: list[TrainInput] = Field(..., min_length=1)

    @field_validator("trains")
    @classmethod
    def unique_train_ids(cls, trains: list[TrainInput]) -> list[TrainInput]:
        ids = [t.train_id for t in trains]
        if len(ids) != len(set(ids)):
            raise ValueError("All train IDs in a scenario must be unique")
        return trains


# ── Analysis ──────────────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    trains: list[TrainInput] = Field(..., min_length=1)
    lookahead_seconds: int = Field(120, ge=10, le=600)


class ApplySolutionRequest(BaseModel):
    solution_id: int = Field(..., ge=1)
    trains: list[TrainInput]
    scenario_id: int | None = Field(None, ge=1)


# ── Train update (via websocket or manual) ────────────────────────────────────

class TrainUpdateRequest(BaseModel):
    train_id: str
    scenario_id: int
    current_speed: int | None = Field(None, ge=0, le=250)
    current_section: str | None = None
    status: Literal["active", "stopped", "speed_reduced", "rerouted", "conflict"] | None = None
    direction: Literal["forward", "backward"] | None = None
