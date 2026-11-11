"""'Serve less': a share of f gives about f times a normal load (0.5 = about half)."""

from datetime import date, timedelta

import pytest

from worship_worker.roster_engine import Person, Rule, Session, solve

QUARTER = ("2026-10-01", "2026-12-31")
START = date(2026, 10, 4)


def _counts(share: float) -> tuple[int, int]:
    """Two keys players, 12 Sundays, only the fairness rule: how many does each get?"""
    sessions = [
        Session(f"s{i}", (START + timedelta(weeks=i)).isoformat(), "EM Sunday Service", "em", 1.0, {"keys": 1}, "em_sunday")
        for i in range(12)
    ]
    people = [Person("a", "A", ["keys"], 100), Person("b", "B", ["keys"], 100)]
    rules = [Rule("fair", False, 0.5, "fairness", {"reduced": {"b": share}})]
    r = solve(sessions, people, rules, QUARTER, time_limit=10)
    n = {p: sum(1 for lst in r.assignments.values() for x in lst if x["member"] == p) for p in ("a", "b")}
    return n["a"], n["b"]


@pytest.mark.parametrize(("share", "expected_b"), [(1.0, 6), (0.5, 4), (0.25, 2)])
def test_share_scales_load(share, expected_b):
    # B's load is about share x A's: 6/6, 4/8 (half), 2/10 (a fifth, the closest to a quarter).
    a, b = _counts(share)
    assert a + b == 12
    assert b == expected_b
