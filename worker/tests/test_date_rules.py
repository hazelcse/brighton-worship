"""'Serve at a session' rules: a rule can name one session on a day, not just the day."""

from worship_worker.roster_engine import Person, Rule, Session, solve

QUARTER = ("2026-10-01", "2026-12-31")


def _sessions():
    em = Session("em", "2026-11-15", "EM Sunday Service", "em", 1.0, {"keys": 1}, "em_sunday")
    cm = Session("cm", "2026-11-15", "CM Sunday Service", "cm", 1.0, {"keys": 1}, "cm_sunday")
    return [em, cm]


def _people():
    # Both serve EM and CM, so either could take either session.
    return [Person("ann", "Ann", ["keys"], 50), Person("ben", "Ben", ["keys"], 50)]


def _who(r, sid):
    return [a["member"] for a in r.assignments.get(sid, [])]


def test_must_serve_at_a_named_session():
    for kind, sid in (("em_sunday", "em"), ("cm_sunday", "cm")):
        rule = Rule("r1", True, 1.0, "date", {"member": "ann", "polarity": "must", "date": "2026-11-15", "sessionKind": kind})
        r = solve(_sessions(), _people(), [rule], QUARTER, time_limit=5)
        assert _who(r, sid) == ["ann"], kind
        assert not r.hard_broken


def test_must_not_serve_at_a_named_session_still_allows_the_other():
    rule = Rule("r1", True, 1.0, "date", {"member": "ann", "polarity": "must_not", "date": "2026-11-15", "sessionKind": "em_sunday"})
    r = solve(_sessions(), _people(), [rule], QUARTER, time_limit=5)
    assert "ann" not in _who(r, "em")
    assert not r.hard_broken


def test_older_rule_without_a_session_means_any_session_that_day():
    rule = Rule("r1", True, 1.0, "date", {"member": "ann", "polarity": "must_not", "date": "2026-11-15"})
    r = solve(_sessions(), _people(), [rule], QUARTER, time_limit=5)
    assert "ann" not in _who(r, "em") + _who(r, "cm")
