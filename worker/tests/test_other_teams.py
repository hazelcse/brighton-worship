"""Someone on two teams: a day they already serve with the other team counts like an absence."""

from worship_worker.roster_engine import Person, Session, check_assignments, solve

QUARTER = ("2026-10-01", "2026-12-31")


def _sessions():
    return [Session("sun", "2026-11-15", "EM Sunday Service", "em", 1.0, {"keys": 1}, "em_sunday")]


def test_never_rostered_on_a_day_they_serve_with_another_team():
    ann = Person("ann", "Ann", ["keys"], 50, elsewhere={"2026-11-15": "Brighton Media"})
    ben = Person("ben", "Ben", ["keys"], 50)
    r = solve(_sessions(), [ann, ben], [], QUARTER, time_limit=5)
    assert [a["member"] for a in r.assignments["sun"]] == ["ben"]


def test_a_hand_edit_onto_that_day_is_flagged():
    ann = Person("ann", "Ann", ["keys"], 50, elsewhere={"2026-11-15": "Brighton Media"})
    issues, _ = check_assignments(_sessions(), [ann], {"sun": [{"member": "ann", "role": "keys", "also": []}]})
    assert {"kind": "other_team", "team": "Brighton Media", "session": "sun", "member": "ann", "role": "keys"} in issues
