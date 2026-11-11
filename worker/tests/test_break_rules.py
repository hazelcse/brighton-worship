"""'N weeks between services' rules: misses (and their highlights) only for real short gaps."""

from datetime import date, timedelta

from worship_worker.roster_engine import Person, Rule, Session, d, solve

QUARTER = ("2026-10-01", "2026-12-31")
SUNDAYS = [(date(2026, 10, 4) + timedelta(weeks=i)).isoformat() for i in range(13)]
BREAK = Rule("brk", False, 1.0, "break", {"subject": {"kind": "everyone"}, "except": [], "op": ">=", "weeks": 1})


def _sessions(n=len(SUNDAYS), need=1):
    return [Session(f"s{i}", dt, "EM Sunday Service", "em", 1.0, {"keys": need}, "em_sunday") for i, dt in enumerate(SUNDAYS[:n])]


def _fixed(sessions, who):
    return {s.id: [{"member": pid, "role": "keys", "also": []}] for s, pid in zip(sessions, who)}


def _miss(r):
    return next(e for e in r.soft if e["rule"] == "brk")


def test_one_week_off_between_services_is_met():
    sessions = _sessions(4)
    people = [Person("ann", "Ann", ["keys"], 100), Person("ben", "Ben", ["keys"], 100)]
    r = solve(sessions, people, [BREAK], QUARTER, time_limit=5, fixed=_fixed(sessions, ["ann", "ben", "ann", "ben"]))
    assert _miss(r)["violations"] == 0
    assert _miss(r)["where"] == []


def test_back_to_back_is_missed_and_highlighted():
    sessions = _sessions(4)
    people = [Person("ann", "Ann", ["keys"], 100), Person("ben", "Ben", ["keys"], 100)]
    r = solve(sessions, people, [BREAK], QUARTER, time_limit=5, fixed=_fixed(sessions, ["ann", "ann", "ben", "ann"]))
    miss = _miss(r)
    assert miss["violations"] == 1
    assert miss["where"] == [{"members": ["ann"], "dates": SUNDAYS[:2]}]


def test_generated_roster_only_flags_real_back_to_back():
    # A realistic quarter with the variety second pass on. That pass only minimises variety, so miss
    # counters used to drift above zero for people whose gaps were fine and got highlighted.
    sessions = []
    for i, dt in enumerate(SUNDAYS):
        for kind, ministry in (("em_sunday", "em"), ("cm_sunday", "cm")):
            sessions.append(Session(f"{ministry}{i}", dt, kind, ministry, 1.0, {"keys": 1, "drums": 1, "lead": 1}, kind))
    roles = ["keys", "drums", "lead"]
    people = [Person(f"p{i}", f"P{i}", [roles[i % 3], roles[(i + 1) % 3]], 50) for i in range(14)]
    r = solve(sessions, people, [BREAK, Rule("var", False, 1.0, "variety", {})], QUARTER, time_limit=10)
    served = {p.id: sorted({s.date for s in sessions if any(a["member"] == p.id for a in r.assignments[s.id])}) for p in people}
    real = sum(1 for ds in served.values() for a, b in zip(ds, ds[1:]) if (d(b) - d(a)).days < 14)
    miss = _miss(r)
    assert miss["violations"] == real
    for w in miss["where"]:
        mine = [dt for dt in w["dates"] if dt in served[w["members"][0]]]
        assert len(mine) >= 2 and (d(mine[-1]) - d(mine[0])).days < 14, w


def _two_week_rule():
    return Rule("brk", False, 1.0, "break", {"subject": {"kind": "everyone"}, "except": [], "op": ">=", "weeks": 2})


def _score(dates_for_ann):
    # Ann serves on the given dates, Ben on the rest; everyone else's gaps don't matter here.
    q = ("2026-01-01", "2026-03-31")
    all_dates = sorted({*dates_for_ann, "2026-01-11", "2026-01-15", "2026-01-18", "2026-01-25"})
    sessions = [Session(f"s{i}", dt, "Session", "em", 1.0, {"keys": 1}, "custom") for i, dt in enumerate(all_dates)]
    people = [Person("ann", "Ann", ["keys"], 100), Person("ben", "Ben", ["keys"], 100), Person("cat", "Cat", ["keys"], 100)]
    other = ["ben", "cat"]
    who = [("ann" if s.date in dates_for_ann else other[i % 2]) for i, s in enumerate(sessions)]
    r = solve(sessions, people, [_two_week_rule()], q, time_limit=5, fixed=_fixed(sessions, who))
    return [w for w in _miss(r)["where"] if w["members"] == ["ann"]]


def test_two_clear_weeks_between_a_sunday_and_a_later_thursday():
    # Sun 4 Jan, then Thu 22 Jan: the weeks of 5 and 12 Jan are free, so 2 clear weeks.
    assert _score(["2026-01-04", "2026-01-22"]) == []


def test_only_one_clear_week_is_missed():
    # Sun 4 Jan, then Thu 15 Jan: only the week of 5 Jan is free.
    assert len(_score(["2026-01-04", "2026-01-15"])) == 1


def test_sunday_to_sunday_still_needs_three_weeks_apart():
    assert _score(["2026-01-04", "2026-01-25"]) == []
    assert len(_score(["2026-01-04", "2026-01-18"])) == 1
