"""Singer balance: bands with 2+ singers get a mix of male and female WLs / vocalists."""

from worship_worker.roster_engine import Person, Rule, Session, solve

QUARTER = ("2026-10-01", "2026-12-31")
BALANCE = Rule("bal", False, 0.5, "singer_balance", {})


def _session(sid="s", date="2026-11-15", wl=1, vox=1):
    return Session(sid, date, "EM Sunday Service", "em", 1.0, {"worship leader": wl, "vocalist": vox}, "em_sunday")


def _singer(pid, gender, roles=("worship leader", "vocalist")):
    return Person(pid, pid.title(), list(roles), 100, gender=gender)


def _miss(r):
    return next(e for e in r.soft if e["rule"] == "bal")


def _singers(r, sid="s"):
    return sorted(a["member"] for a in r.assignments[sid])


def test_picks_one_man_and_one_woman():
    people = [_singer("adam", "male"), _singer("ben", "male"), _singer("cara", "female")]
    r = solve([_session()], people, [BALANCE], QUARTER, time_limit=5)
    assert "cara" in _singers(r)
    assert _miss(r)["violations"] == 0


def test_all_one_gender_is_missed_and_highlights_the_singers():
    sessions = [_session()]
    people = [_singer("adam", "male"), _singer("ben", "male"), _singer("cara", "female")]
    fixed = {"s": [{"member": "adam", "role": "worship leader", "also": []}, {"member": "ben", "role": "vocalist", "also": []}]}
    r = solve(sessions, people, [BALANCE], QUARTER, time_limit=5, fixed=fixed)
    miss = _miss(r)
    assert miss["violations"] == 1
    assert miss["where"] == [{"members": ["adam", "ben"], "dates": ["2026-11-15"]}]


def test_three_singers_allow_two_and_one():
    sessions = [_session(vox=2)]
    people = [_singer("adam", "male"), _singer("ben", "male"), _singer("cara", "female")]
    fixed = {"s": [{"member": "adam", "role": "worship leader", "also": []},
                   {"member": "ben", "role": "vocalist", "also": []},
                   {"member": "cara", "role": "vocalist", "also": []}]}
    r = solve(sessions, people, [BALANCE], QUARTER, time_limit=5, fixed=fixed)
    assert _miss(r)["violations"] == 0


def test_unknown_gender_and_single_singer_bands_are_not_counted():
    people = [_singer("adam", "male"), _singer("sam", None)]
    two = {"s": [{"member": "adam", "role": "worship leader", "also": []}, {"member": "sam", "role": "vocalist", "also": []}]}
    r = solve([_session()], people, [BALANCE], QUARTER, time_limit=5, fixed=two)
    assert _miss(r)["violations"] == 0
    r = solve([_session(vox=0)], people, [BALANCE], QUARTER, time_limit=5)
    assert _miss(r) == {"rule": "bal", "violations": 0, "checks": 0, "where": [], "penalty": 0}


def test_soft_rule_gives_way_when_only_one_gender_is_available():
    people = [_singer("adam", "male"), _singer("ben", "male")]
    r = solve([_session()], people, [BALANCE], QUARTER, time_limit=5)
    assert not r.unfilled
    assert _miss(r)["violations"] == 1
