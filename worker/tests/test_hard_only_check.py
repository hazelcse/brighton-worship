"""The quick check after a hand edit: hard problems only, no scoring, no "extra people" issue."""

from worship_worker.roster_engine import Person, Rule, Session, check_assignments, solve

QUARTER = ("2026-10-01", "2026-12-31")


def _sundays():
    return [
        Session("s1", "2026-11-01", "EM Sunday Service", "em", 1.0, {"keys": 1, "drums": 1}, "em_sunday"),
        Session("s2", "2026-11-08", "EM Sunday Service", "em", 1.0, {"keys": 1, "drums": 1}, "em_sunday"),
    ]


def _people():
    return [Person("ann", "Ann", ["keys"], 100), Person("ben", "Ben", ["keys", "drums"], 100)]


def _at_most_once(hard: bool) -> Rule:
    params = {"template": "frequency", "subject": {"kind": "member", "value": "ann"}, "polarity": "should",
              "op": "<=", "count": 1, "period": "quarter"}
    return Rule("r1", hard, 1.0, "frequency", params)


def test_more_people_than_needed_is_not_a_problem():
    s = _sundays()[0]
    fixed = {"s1": [{"member": "ann", "role": "keys"}, {"member": "ben", "role": "keys"}]}
    issues, _ = check_assignments([s], _people(), fixed)
    assert issues == []


def test_reports_broken_hard_rules_and_unfilled_places():
    fixed = {"s1": [{"member": "ann", "role": "keys", "also": []}], "s2": [{"member": "ann", "role": "keys", "also": []}]}
    r = solve(_sundays(), _people(), [_at_most_once(True)], QUARTER, 5, fixed=fixed, hard_only=True)
    assert [h["rule"] for h in r.hard_broken] == ["r1"]
    assert {u["session"] for u in r.unfilled} == {"s1", "s2"}  # no drummer
    assert {row["member"]: row["services"] for row in r.loads}["ann"] == 2


def test_skips_soft_rules_and_scores():
    fixed = {"s1": [{"member": "ann", "role": "keys", "also": []}], "s2": [{"member": "ann", "role": "keys", "also": []}]}
    r = solve(_sundays(), _people(), [_at_most_once(False)], QUARTER, 5, fixed=fixed, hard_only=True)
    assert r.soft == [] and r.hard_broken == []
    assert not any(k in r.objective for k in ("soft_rule", "fairness", "spacing", "split", "variety"))
