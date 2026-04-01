"""
app/services/ai_engine.py — Intelligent conflict detection and resolution engine.

Replaces the naive same-section check with:
  1. Future-aware collision prediction (simulate N seconds ahead)
  2. Graph-based rerouting via Dijkstra / alternate_paths
  3. Solution scoring (delay, confidence, impact)
"""

from __future__ import annotations
import logging
import math
from dataclasses import dataclass, field
from typing import Any

from app.models.graph import NETWORK, alternate_paths, shortest_path, path_distance

logger = logging.getLogger(__name__)

# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class TrainState:
    train_id: str
    train_type: str
    priority: int          # 1 = highest
    current_speed: float   # km/h
    current_section: str   # current node (station ID)
    destination: str       # target node
    distance_to_destination: float  # km remaining
    direction: str = "forward"
    status: str = "active"

    @classmethod
    def from_dict(cls, d: dict) -> "TrainState":
        return cls(
            train_id=d["train_id"],
            train_type=d.get("train_type", "Local"),
            priority=int(d.get("priority", 3)),
            current_speed=float(d.get("current_speed", 0)),
            current_section=d.get("current_section", "A"),
            destination=d.get("destination", "L"),
            distance_to_destination=float(d.get("distance_to_destination", 0)),
            direction=d.get("direction", "forward"),
            status=d.get("status", "active"),
        )


@dataclass
class Conflict:
    conflict_id: str
    conflict_type: str          # "same_section" | "head_on" | "rear_end" | "merge"
    section: str
    trains: list[str]
    predicted_in_seconds: float  # 0 = immediate, >0 = predicted future
    severity: str               # "critical" | "high" | "medium"


@dataclass
class Solution:
    solution_id: int
    solution_type: str          # "reduce_speed" | "reroute" | "hold"
    description: str
    actions: list[dict]
    impact: str
    delay_seconds: float
    confidence: float           # 0.0–1.0
    priority: str               # "high" | "medium" | "low"
    addresses_conflict: str     # conflict_id it resolves


# ── Conflict Detection ────────────────────────────────────────────────────────

class ConflictDetector:
    """Future-aware collision predictor."""

    @staticmethod
    def project_position(train: TrainState, seconds: float) -> dict[str, Any]:
        """
        Estimate where a train will be `seconds` from now.
        Returns {"section": str, "distance_remaining": float, "eta_to_dest": float}.
        """
        if train.current_speed <= 0 or train.status == "stopped":
            return {
                "section": train.current_section,
                "distance_remaining": train.distance_to_destination,
                "eta_to_dest": float("inf"),
            }

        speed_ms = train.current_speed / 3.6  # convert km/h → m/s
        distance_covered_m = speed_ms * seconds
        distance_covered_km = distance_covered_m / 1000

        remaining = max(0, train.distance_to_destination - distance_covered_km)

        # Try to resolve the next node along the graph path
        path = shortest_path(train.current_section, train.destination)
        projected_section = train.current_section
        if path and len(path) > 1:
            elapsed = 0.0
            for i in range(len(path) - 1):
                edge = NETWORK.edges[path[i], path[i + 1]]
                seg_dist = edge["distance"]
                if elapsed + seg_dist >= distance_covered_km:
                    projected_section = path[i]
                    break
                elapsed += seg_dist
                projected_section = path[i + 1]

        eta = (remaining / (train.current_speed / 3.6)) if train.current_speed > 0 else float("inf")

        return {
            "section": projected_section,
            "distance_remaining": remaining,
            "eta_to_dest": eta / 3600,  # hours
        }

    @staticmethod
    def detect(trains: list[TrainState], lookahead_seconds: float = 120) -> list[Conflict]:
        """Detect conflicts — immediate and predicted within `lookahead_seconds`."""
        conflicts: list[Conflict] = []
        cid = 0

        def new_id() -> str:
            nonlocal cid
            cid += 1
            return f"C{cid:03d}"

        # ── 1. Immediate: multiple trains on same section ──────────────────
        section_map: dict[str, list[TrainState]] = {}
        for t in trains:
            section_map.setdefault(t.current_section, []).append(t)

        for section, occupants in section_map.items():
            if len(occupants) > 1:
                conflicts.append(
                    Conflict(
                        conflict_id=new_id(),
                        conflict_type="same_section",
                        section=section,
                        trains=[t.train_id for t in occupants],
                        predicted_in_seconds=0,
                        severity="critical",
                    )
                )

        # ── 2. Future: simulate positions and check for collisions ─────────
        checkpoints = [t * lookahead_seconds / 4 for t in range(1, 5)]  # 4 time slices
        for t_secs in checkpoints:
            fut_map: dict[str, list[str]] = {}
            for train in trains:
                if train.status in ("stopped",):
                    continue
                proj = ConflictDetector.project_position(train, t_secs)
                fut_map.setdefault(proj["section"], []).append(train.train_id)

            for section, ids in fut_map.items():
                if len(ids) > 1:
                    # Skip if already detected as immediate
                    if any(c.section == section and c.predicted_in_seconds == 0 for c in conflicts):
                        continue
                    # Skip if already captured at earlier checkpoint
                    if any(c.section == section and set(c.trains) == set(ids) for c in conflicts):
                        continue
                    severity = "high" if t_secs <= lookahead_seconds / 2 else "medium"
                    conflicts.append(
                        Conflict(
                            conflict_id=new_id(),
                            conflict_type="head_on" if len(ids) == 2 else "merge",
                            section=section,
                            trains=ids,
                            predicted_in_seconds=t_secs,
                            severity=severity,
                        )
                    )

        # ── 3. Head-on: two trains on opposite edges ───────────────────────
        train_paths: dict[str, list[str]] = {}
        for train in trains:
            p = shortest_path(train.current_section, train.destination)
            if p:
                train_paths[train.train_id] = p

        ids = list(train_paths.keys())
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                p1 = train_paths[ids[i]]
                p2 = train_paths[ids[j]]
                # Check if they are on opposing edges
                for k in range(len(p1) - 1):
                    for m in range(len(p2) - 1):
                        if p1[k] == p2[m + 1] and p1[k + 1] == p2[m]:
                            sec = f"{p1[k]}-{p1[k+1]}"
                            already = any(c.section == sec for c in conflicts)
                            if not already:
                                conflicts.append(
                                    Conflict(
                                        conflict_id=new_id(),
                                        conflict_type="head_on",
                                        section=sec,
                                        trains=[ids[i], ids[j]],
                                        predicted_in_seconds=30,
                                        severity="critical",
                                    )
                                )

        return conflicts


# ── Solution Generator ────────────────────────────────────────────────────────

class SolutionGenerator:
    """
    Generates ranked solutions for detected conflicts.
    Each solution includes a confidence score and delay estimate.
    """

    @staticmethod
    def generate(trains: list[TrainState], conflicts: list[Conflict]) -> list[Solution]:
        if not conflicts:
            return [
                Solution(
                    solution_id=1,
                    solution_type="none",
                    description="All trains operating normally — no conflicts detected.",
                    actions=[],
                    impact="No action required.",
                    delay_seconds=0,
                    confidence=1.0,
                    priority="low",
                    addresses_conflict="none",
                )
            ]

        solutions: list[Solution] = []
        sid = 0

        train_map = {t.train_id: t for t in trains}

        for conflict in conflicts:
            conflict_trains = sorted(
                [train_map[tid] for tid in conflict.trains if tid in train_map],
                key=lambda t: t.priority,
            )

            if not conflict_trains:
                continue

            highest = conflict_trains[0]   # highest priority (lowest number)
            victims = conflict_trains[1:]  # to be acted upon

            # ── Solution A: Reduce speed of lower-priority trains ──────────
            sid += 1
            speed_actions = []
            total_delay = 0.0
            for v in victims:
                new_speed = max(20, int(v.current_speed * 0.5))
                delay = ((v.distance_to_destination / (v.current_speed / 3.6)) -
                         (v.distance_to_destination / (new_speed / 3.6))) if new_speed > 0 else 0
                total_delay += delay
                speed_actions.append({
                    "train_id": v.train_id,
                    "action": "reduce_speed",
                    "new_speed": new_speed,
                    "target_section": conflict.section,
                })

            solutions.append(
                Solution(
                    solution_id=sid,
                    solution_type="reduce_speed",
                    description=(
                        f"Reduce speed of {', '.join(v.train_id for v in victims)} "
                        f"to clear {conflict.section} for {highest.train_id}."
                    ),
                    actions=speed_actions,
                    impact=f"Adds ~{int(total_delay)}s delay to lower-priority trains.",
                    delay_seconds=total_delay,
                    confidence=0.85 if conflict.conflict_type == "same_section" else 0.75,
                    priority="high",
                    addresses_conflict=conflict.conflict_id,
                )
            )

            # ── Solution B: Reroute lowest-priority train ──────────────────
            if victims:
                lowest = victims[-1]
                # Find occupied edges to avoid
                occupied_edge = None
                if "-" in conflict.section:
                    parts = conflict.section.split("-")
                    occupied_edge = (parts[0], parts[1])

                exclude = [occupied_edge] if occupied_edge else []
                alt_paths = alternate_paths(lowest.current_section, lowest.destination, exclude)

                if alt_paths and len(alt_paths) > 1:
                    best_alt = alt_paths[1]  # skip shortest (which has the conflict)
                    new_dist = path_distance(best_alt)
                    base_dist = lowest.distance_to_destination
                    extra_km = max(0, new_dist - base_dist)
                    extra_secs = (extra_km / (lowest.current_speed / 3.6)) if lowest.current_speed > 0 else 300
                    next_section = best_alt[1] if len(best_alt) > 1 else lowest.current_section

                    sid += 1
                    solutions.append(
                        Solution(
                            solution_id=sid,
                            solution_type="reroute",
                            description=(
                                f"Reroute {lowest.train_id} via "
                                f"{' → '.join(best_alt)} to avoid {conflict.section}."
                            ),
                            actions=[{
                                "train_id": lowest.train_id,
                                "action": "reroute",
                                "new_section": next_section,
                                "full_path": best_alt,
                                "extra_distance_km": extra_km,
                            }],
                            impact=f"Adds ~{int(extra_km)}km ({int(extra_secs)}s) to {lowest.train_id}'s route.",
                            delay_seconds=extra_secs,
                            confidence=0.80,
                            priority="medium",
                            addresses_conflict=conflict.conflict_id,
                        )
                    )

            # ── Solution C: Hold lowest-priority train ─────────────────────
            if victims:
                lowest = victims[-1]
                hold_time = 300  # 5 minutes
                sid += 1
                solutions.append(
                    Solution(
                        solution_id=sid,
                        solution_type="hold",
                        description=(
                            f"Hold {lowest.train_id} at {lowest.current_section} "
                            f"for 5 minutes until {conflict.section} clears."
                        ),
                        actions=[{
                            "train_id": lowest.train_id,
                            "action": "stop",
                            "new_speed": 0,
                            "hold_seconds": hold_time,
                        }],
                        impact=f"Delays {lowest.train_id} by {hold_time}s, zero impact on other trains.",
                        delay_seconds=hold_time,
                        confidence=0.95,
                        priority="low",
                        addresses_conflict=conflict.conflict_id,
                    )
                )

        # Sort by confidence descending (best first)
        solutions.sort(key=lambda s: (-s.confidence, s.delay_seconds))
        return solutions


# ── Apply solution ────────────────────────────────────────────────────────────

def apply_solution(solution: Solution, trains: list[dict]) -> list[dict]:
    """Apply a chosen solution's actions and return updated train dicts."""
    action_map = {a["train_id"]: a for a in solution.actions}
    updated = []
    for train in trains:
        t = dict(train)
        if t["train_id"] in action_map:
            action = action_map[t["train_id"]]
            if action["action"] == "reduce_speed":
                t["current_speed"] = action["new_speed"]
                t["status"] = "speed_reduced"
            elif action["action"] == "reroute":
                t["current_section"] = action["new_section"]
                t["status"] = "rerouted"
            elif action["action"] == "stop":
                t["current_speed"] = 0
                t["status"] = "stopped"
        updated.append(t)
    return updated


# ── Public API ────────────────────────────────────────────────────────────────

def analyze(trains_raw: list[dict], lookahead_seconds: int = 120) -> dict:
    """
    Main entry point.
    Takes raw train dicts (from DB / request), returns conflicts + solutions.
    """
    trains = [TrainState.from_dict(t) for t in trains_raw]
    conflicts = ConflictDetector.detect(trains, lookahead_seconds)
    solutions = SolutionGenerator.generate(trains, conflicts)

    return {
        "conflicts": [
            {
                "conflict_id": c.conflict_id,
                "type": c.conflict_type,
                "section": c.section,
                "trains": c.trains,
                "predicted_in_seconds": c.predicted_in_seconds,
                "severity": c.severity,
            }
            for c in conflicts
        ],
        "solutions": [
            {
                "solution_id": s.solution_id,
                "type": s.solution_type,
                "description": s.description,
                "actions": s.actions,
                "impact": s.impact,
                "delay_seconds": s.delay_seconds,
                "confidence": round(s.confidence, 2),
                "priority": s.priority,
                "addresses_conflict": s.addresses_conflict,
            }
            for s in solutions
        ],
    }
