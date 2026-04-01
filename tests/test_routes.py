"""tests/test_routes.py — API route integration tests."""

import pytest
from unittest.mock import patch


class TestAuth:

    def test_register_success(self, client):
        with patch("app.db.repository.fetch_user_by_username", return_value=None), \
             patch("app.db.repository.insert_user", return_value=1):
            resp = client.post("/api/auth/register", json={
                "username": "newuser",
                "email": "new@test.com",
                "password": "secure123",
                "role": "operator",
            })
        assert resp.status_code == 201
        data = resp.get_json()
        assert "access_token" in data

    def test_register_duplicate_user(self, client):
        existing = {"user_id": 1, "username": "existing", "email": "e@e.com",
                    "password_hash": "x", "role": "operator"}
        with patch("app.db.repository.fetch_user_by_username", return_value=existing):
            resp = client.post("/api/auth/register", json={
                "username": "existing",
                "email": "new@test.com",
                "password": "secure123",
            })
        assert resp.status_code == 409

    def test_login_invalid_credentials(self, client):
        with patch("app.db.repository.fetch_user_by_username", return_value=None):
            resp = client.post("/api/auth/login", json={
                "username": "nobody",
                "password": "wrong",
            })
        assert resp.status_code == 401

    def test_register_invalid_email(self, client):
        resp = client.post("/api/auth/register", json={
            "username": "user",
            "email": "not-an-email",
            "password": "password123",
        })
        assert resp.status_code == 400


class TestScenarios:

    def test_list_scenarios_requires_auth(self, client):
        resp = client.get("/api/scenarios")
        assert resp.status_code == 401

    def test_list_scenarios_authenticated(self, client, auth_headers):
        with patch("app.db.repository.fetch_all_scenarios", return_value=[]):
            resp = client.get("/api/scenarios", headers=auth_headers)
        assert resp.status_code == 200
        assert isinstance(resp.get_json(), list)

    def test_create_scenario_success(self, client, auth_headers):
        with patch("app.db.repository.insert_scenario", return_value=1), \
             patch("app.db.repository.insert_train", return_value=None):
            resp = client.post("/api/scenario", headers=auth_headers, json={
                "name": "Test Scenario",
                "description": "A test",
                "trains": [{
                    "train_id": "T001",
                    "train_type": "Express",
                    "priority": 1,
                    "current_speed": 80,
                    "current_section": "A",
                    "destination": "E",
                    "distance_to_destination": 300,
                }],
            })
        assert resp.status_code == 201
        assert resp.get_json()["scenario_id"] == 1

    def test_create_scenario_missing_field(self, client, auth_headers):
        resp = client.post("/api/scenario", headers=auth_headers, json={
            "name": "Test",
            # missing trains
        })
        assert resp.status_code == 400

    def test_create_scenario_duplicate_train_ids(self, client, auth_headers):
        resp = client.post("/api/scenario", headers=auth_headers, json={
            "name": "Bad",
            "trains": [
                {"train_id": "T1", "train_type": "Express", "priority": 1,
                 "current_speed": 80, "current_section": "A",
                 "destination": "E", "distance_to_destination": 200},
                {"train_id": "T1", "train_type": "Freight", "priority": 3,
                 "current_speed": 50, "current_section": "B",
                 "destination": "L", "distance_to_destination": 400},
            ],
        })
        assert resp.status_code == 400

    def test_get_scenario_not_found(self, client, auth_headers):
        with patch("app.db.repository.fetch_scenario_by_id", return_value=None):
            resp = client.get("/api/scenario/9999", headers=auth_headers)
        assert resp.status_code == 404


class TestAnalysis:

    def test_analyze_endpoint(self, client, auth_headers):
        payload = {
            "trains": [{
                "train_id": "T1",
                "train_type": "Express",
                "priority": 1,
                "current_speed": 80,
                "current_section": "C",
                "destination": "E",
                "distance_to_destination": 180,
            }],
            "lookahead_seconds": 60,
        }
        resp = client.post("/api/analyze", headers=auth_headers, json=payload)
        assert resp.status_code == 200
        data = resp.get_json()
        assert "conflicts" in data
        assert "solutions" in data

    def test_network_endpoint_public(self, client):
        resp = client.get("/api/network")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "nodes" in data
        assert "edges" in data
        assert len(data["nodes"]) == 12
