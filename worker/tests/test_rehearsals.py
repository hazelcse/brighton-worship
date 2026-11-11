"""Rehearsals: someone away on a service's rehearsal date is never rostered for it."""

from worship_worker.roster_engine import Person, Session, check_assignments, solve

QUARTER = ("2026-10-01", "2026-12-31")


def _setup(absent_on: str):
    sunday = Session("s1", "2026-11-15", "EM Sunday Service", "em", 1.0, {"keys": 1}, "em_sunday", "2026-11-10")
    ann = Person("ann", "Ann", ["keys"], 100, absent={absent_on})
    ben = Person("ben", "Ben", ["keys"], 100)
    return sunday, ann, ben


def test_away_at_rehearsal_is_never_rostered():
    sunday, ann, ben = _setup("2026-11-10")
    r = solve([sunday], [ann, ben], [], QUARTER, time_limit=5)
    assert [a["member"] for a in r.assignments["s1"]] == ["ben"]


def test_only_player_away_at_rehearsal_leaves_the_place_unfilled():
    sunday, ann, _ = _setup("2026-11-10")
    r = solve([sunday], [ann], [], QUARTER, time_limit=5)
    assert r.assignments.get("s1", []) == []
    assert r.unfilled


def test_away_on_other_days_does_not_matter():
    sunday, ann, _ = _setup("2026-11-11")
    r = solve([sunday], [ann], [], QUARTER, time_limit=5)
    assert [a["member"] for a in r.assignments["s1"]] == ["ann"]


def test_hand_edit_flags_missed_rehearsal():
    sunday, ann, _ = _setup("2026-11-10")
    issues, _ = check_assignments([sunday], [ann], {"s1": [{"member": "ann", "role": "keys"}]})
    assert [i["kind"] for i in issues] == ["absent_rehearsal"]
