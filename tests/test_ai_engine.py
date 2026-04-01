"""tests/test_ai_engine.py — Unit tests for the AI engine."""

import pytest
from app.services.ai_engine import (
    TrainState, ConflictDetector, SolutionGenerator, analyze
)


def _make_train(**kwargs) -> dict:
    defaults = {
        "train_id": "T1",
        "train_type": "Express",
        "priority": 1,
        "current_speed": 80,
        "current_section": "A",
        "destination": "E",
        "distance_to_destination": 300,
        "direction": "forward",
        "status": "active",
    }
    defaults.update(kwargs)
    return defaults


class TestConflictDetection:

    def test_no_conflict_different_sections(self):
        trains = [
            TrainState.from_dict(_make_train(train_id="T1", current_section="A")),
            TrainState.from_dict(_make_train(train_id="T2", current_section="D")),
        ]
        conflicts = ConflictDetector.detect(trains, lookahead_seconds=60)
        same_sec = [c for c in conflicts if c.conflict_type == "same_section"]
        assert len(same_sec) == 0

    def test_immediate_conflict_same_section(self):
        trains = [
            TrainState.from_dict(_make_train(train_id="T1", current_section="C")),
            TrainState.from_dict(_make_train(train_id="T2", current_section="C")),
        ]
        conflicts = ConflictDetector.detect(trains, lookahead_seconds=0)
        assert any(c.conflict_type == "same_section" for c in conflicts)
        assert any("T1" in c.trains and "T2" in c.trains for c in conflicts)

    def test_conflict_severity_is_critical_for_same_section(self):
        trains = [
            TrainState.from_dict(_make_train(train_id="T1", current_section="B", priority=1)),
            TrainState.from_dict(_make_train(train_id="T2", current_section="B", priority=3)),
        ]
        conflicts = ConflictDetector.detect(trains, lookahead_seconds=60)
        same = [c for c in conflicts if c.conflict_type == "same_section"]
        assert all(c.severity == "critical" for c in same)


class TestSolutionGeneration:

    def test_no_conflict_returns_single_solution(self):
        result = analyze([_make_train(train_id="T1", current_section="A")])
        assert len(result["conflicts"]) == 0
        assert len(result["solutions"]) == 1
        assert result["solutions"][0]["type"] == "none"

    def test_conflict_generates_multiple_solutions(self):
        trains = [
            _make_train(train_id="T1", current_section="C", priority=1),
            _make_train(train_id="T2", current_section="C", priority=3),
        ]
        result = analyze(trains)
        assert len(result["conflicts"]) > 0
        assert len(result["solutions"]) >= 2

    def test_solutions_have_required_fields(self):
        trains = [
            _make_train(train_id="T1", current_section="C", priority=1),
            _make_train(train_id="T2", current_section="C", priority=3),
        ]
        result = analyze(trains)
        for sol in result["solutions"]:
            assert "solution_id" in sol
            assert "type" in sol
            assert "confidence" in sol
            assert "delay_seconds" in sol
            assert "actions" in sol
            assert 0.0 <= sol["confidence"] <= 1.0

    def test_solutions_sorted_by_confidence(self):
        trains = [
            _make_train(train_id="T1", current_section="C", priority=1),
            _make_train(train_id="T2", current_section="C", priority=3),
        ]
        result = analyze(trains)
        confidences = [s["confidence"] for s in result["solutions"]]
        assert confidences == sorted(confidences, reverse=True)

    def test_higher_priority_train_not_in_actions(self):
        trains = [
            _make_train(train_id="HIGHPRI", current_section="C", priority=1),
            _make_train(train_id="LOWPRI",  current_section="C", priority=4),
        ]
        result = analyze(trains)
        for sol in result["solutions"]:
            if sol["type"] != "none":
                action_train_ids = [a["train_id"] for a in sol["actions"]]
                assert "HIGHPRI" not in action_train_ids
