"""
app/models/graph.py — Railway network graph model.

Models the railway as a directed NetworkX graph:
  - Nodes  → stations / sections with (x, y) coordinates for visualization
  - Edges  → track segments with distance, speed_limit, and capacity

The graph is built once at startup and reused across all requests/threads.
"""

import networkx as nx
from typing import Any

# ── Network definition ────────────────────────────────────────────────────────
#
# Station layout (roughly west→east, with a branch):
#
#   A ── B ── C ── D ── E
#             |         |
#             F ── G ── H
#             |
#             I ── J ── K ── L
#
# Coordinates are in "SVG units" (0–1000 range) for the frontend renderer.

_STATIONS: dict[str, dict[str, Any]] = {
    "A": {"label": "Station A", "x": 50,  "y": 150},
    "B": {"label": "Station B", "x": 200, "y": 150},
    "C": {"label": "Station C", "x": 350, "y": 150},
    "D": {"label": "Station D", "x": 500, "y": 150},
    "E": {"label": "Station E", "x": 650, "y": 150},
    "F": {"label": "Station F", "x": 350, "y": 300},
    "G": {"label": "Station G", "x": 500, "y": 300},
    "H": {"label": "Station H", "x": 650, "y": 300},
    "I": {"label": "Station I", "x": 350, "y": 450},
    "J": {"label": "Station J", "x": 500, "y": 450},
    "K": {"label": "Station K", "x": 650, "y": 450},
    "L": {"label": "Station L", "x": 800, "y": 450},
}

# (from, to, distance_km, speed_limit_kmh)
_EDGES: list[tuple[str, str, int, int]] = [
    # Main line (top)
    ("A", "B", 80,  120),
    ("B", "A", 80,  120),
    ("B", "C", 70,  130),
    ("C", "B", 70,  130),
    ("C", "D", 90,  120),
    ("D", "C", 90,  120),
    ("D", "E", 80,  130),
    ("E", "D", 80,  130),
    # Branch A (middle)
    ("C", "F", 60,  100),
    ("F", "C", 60,  100),
    ("F", "G", 80,  110),
    ("G", "F", 80,  110),
    ("G", "H", 70,  110),
    ("H", "G", 70,  110),
    ("E", "H", 100, 90),
    ("H", "E", 100, 90),
    # Branch B (south)
    ("F", "I", 50,  80),
    ("I", "F", 50,  80),
    ("I", "J", 70,  90),
    ("J", "I", 70,  90),
    ("J", "K", 60,  100),
    ("K", "J", 60,  100),
    ("K", "L", 80,  110),
    ("L", "K", 80,  110),
]


def build_network() -> nx.DiGraph:
    """Construct and return the railway network as a directed graph."""
    G = nx.DiGraph()
    for node_id, attrs in _STATIONS.items():
        G.add_node(node_id, **attrs)
    for frm, to, dist, speed_limit in _EDGES:
        G.add_edge(frm, to, distance=dist, speed_limit=speed_limit, occupied_by=[])
    return G


# Singleton graph — initialised at module import time.
NETWORK: nx.DiGraph = build_network()


# ── Graph query helpers ───────────────────────────────────────────────────────

def get_nodes() -> list[dict]:
    """Return all station nodes as serialisable dicts."""
    return [
        {"id": n, **NETWORK.nodes[n]}
        for n in NETWORK.nodes
    ]


def get_edges() -> list[dict]:
    """Return all track edges as serialisable dicts."""
    return [
        {"from": u, "to": v, **NETWORK.edges[u, v]}
        for u, v in NETWORK.edges
    ]


def get_station_names() -> list[str]:
    return list(NETWORK.nodes.keys())


def shortest_path(source: str, target: str, weight: str = "distance") -> list[str] | None:
    """Return the shortest path between two stations by distance, or None."""
    try:
        return nx.shortest_path(NETWORK, source, target, weight=weight)
    except nx.NetworkXNoPath:
        return None


def path_distance(path: list[str]) -> int:
    """Sum edge distances along a node path."""
    total = 0
    for i in range(len(path) - 1):
        total += NETWORK.edges[path[i], path[i + 1]]["distance"]
    return total


def alternate_paths(
    source: str, target: str, exclude_edges: list[tuple[str, str]] | None = None
) -> list[list[str]]:
    """
    Return up to 3 simple paths from source→target, excluding congested edges.
    Used by the AI engine to find rerouting options.
    """
    G = NETWORK.copy()
    for edge in (exclude_edges or []):
        if G.has_edge(*edge):
            G.remove_edge(*edge)
    try:
        paths = list(nx.shortest_simple_paths(G, source, target, weight="distance"))
        return paths[:3]
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return []


def mark_edge_occupied(frm: str, to: str, train_id: str) -> None:
    """Mark an edge as occupied by a train (used during simulation)."""
    if NETWORK.has_edge(frm, to):
        occupied = NETWORK.edges[frm, to].get("occupied_by", [])
        if train_id not in occupied:
            occupied.append(train_id)
        NETWORK.edges[frm, to]["occupied_by"] = occupied


def clear_edge_occupation(frm: str, to: str, train_id: str) -> None:
    """Remove a train from edge occupancy."""
    if NETWORK.has_edge(frm, to):
        occupied = NETWORK.edges[frm, to].get("occupied_by", [])
        NETWORK.edges[frm, to]["occupied_by"] = [t for t in occupied if t != train_id]
