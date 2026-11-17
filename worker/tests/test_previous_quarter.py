"""Break and spacing rules count services from the end of the previous quarter (Person.served_before)."""

from datetime import date, timedelta

from worship_worker.roster_engine import Person, Rule, Session, solve

QUARTER = ("2027-01-01", "2027-03-31")  # starts on a Friday; its first week is Mon 28 Dec 2026
SUNDAYS = [(date(2027, 1, 3) + timedelta(weeks=i)).isoformat() for i in range(13)]


def _sessions(n=len(SUNDAYS)):
    return [Session(f"s{i}", dt, "EM Sunday Service", "em", 1.0, {"keys": 1}, "em_sunday") for i, dt in enumerate(SUNDAYS[:n])]


def _fixed(sessions, who):
    return {s.id: [{"member": pid, "role": "keys", "also": []}] for s, pid in zip(sessions, who)}


def _break(weeks, op=">=", hard=False):
    # Ann's own rule (Ben, the other keys player, can serve every week).
    return Rule("brk", hard, 1.0, "break", {"subject": {"kind": "member", "value": "ann"}, "except": [], "op": op, "weeks": weeks})


def _misses(r):
    return next(e for e in r.soft + r.hard_broken if e["rule"] == "brk")["violations"]


def _people(ann_before=()):
    return [Person("ann", "Ann", ["keys"], 100, served_before=list(ann_before)), Person("ben", "Ben", ["keys"], 100)]


def test_break_counts_the_last_service_of_the_previous_quarter():
    sessions = _sessions(4)
    who = ["ann", "ben", "ben", "ben"]  # Ann on Sun 3 Jan
    without = solve(sessions, _people(), [_break(7)], QUARTER, time_limit=5, fixed=_fixed(sessions, who))
    assert _misses(without) == 0
    # She also served on Sun 27 Dec: only one week apart, under a 7-week break.
    with_prev = solve(sessions, _people(["2026-12-27"]), [_break(7)], QUARTER, time_limit=5, fixed=_fixed(sessions, who))
    assert _misses(with_prev) == 1
    miss = next(e for e in with_prev.soft if e["rule"] == "brk")
    assert miss["where"] == [{"members": ["ann"], "dates": ["2027-01-03"]}]


def test_only_the_latest_previous_service_counts():
    sessions = _sessions(4)
    who = ["ann", "ben", "ben", "ben"]
    r = solve(sessions, _people(["2026-12-13", "2026-12-20", "2026-12-27"]), [_break(7)], QUARTER, time_limit=5, fixed=_fixed(sessions, who))
    assert _misses(r) == 1  # 3 Jan is one miss, not one per December service


def test_a_service_long_enough_ago_is_fine():
    sessions = _sessions(4)
    who = ["ann", "ben", "ben", "ben"]
    # Sun 8 Nov to Sun 3 Jan: the weeks of 9 Nov to 21 Dec are clear, seven of them.
    r = solve(sessions, _people(["2026-11-08"]), [_break(7)], QUARTER, time_limit=5, fixed=_fixed(sessions, who))
    assert _misses(r) == 0


def test_generator_keeps_the_break_across_the_new_year():
    sessions = _sessions()
    r = solve(sessions, _people(["2026-12-27"]), [_break(7, hard=True)], QUARTER, time_limit=10)
    ann = [s.date for s in sessions if any(a["member"] == "ann" for a in r.assignments[s.id])]
    # 7 clear weeks after the week of 27 Dec (weeks of 28 Dec to 8 Feb): not before Sun 21 Feb.
    assert ann and min(ann) >= "2027-02-21", ann
    assert not r.hard_broken


def test_maximum_gap_starts_from_the_previous_quarter():
    sessions = _sessions(6)
    who = ["ben", "ben", "ann", "ben", "ann", "ben"]  # Ann's first: Sun 17 Jan
    rule = _break(2, op="<=")
    without = solve(sessions, _people(), [rule], QUARTER, time_limit=5, fixed=_fixed(sessions, who))
    # Last served Sun 13 Dec: by 17 Jan that's four clear weeks, more than two.
    with_prev = solve(sessions, _people(["2026-12-13"]), [rule], QUARTER, time_limit=5, fixed=_fixed(sessions, who))
    assert _misses(with_prev) > _misses(without)


def test_maximum_gap_met_by_a_recent_previous_service():
    sessions = _sessions(6)
    who = ["ben", "ann", "ben", "ann", "ben", "ann"]  # Ann on 10 Jan, 24 Jan, 7 Feb
    rule = _break(2, op="<=")
    # (The quarter's later weeks have no sessions here, so both count the same misses there.)
    without = solve(sessions, _people(), [rule], QUARTER, time_limit=5, fixed=_fixed(sessions, who))
    with_prev = solve(sessions, _people(["2026-12-27"]), [rule], QUARTER, time_limit=5, fixed=_fixed(sessions, who))
    assert _misses(with_prev) == _misses(without)


def test_spacing_counts_the_previous_quarter():
    sessions = _sessions(4)
    who = ["ann", "ben", "ben", "ben"]
    spacing = Rule("sp", False, 1.0, "spacing", {})
    without = solve(sessions, _people(), [spacing], QUARTER, time_limit=5, fixed=_fixed(sessions, who))
    with_prev = solve(sessions, _people(["2026-12-27"]), [spacing], QUARTER, time_limit=5, fixed=_fixed(sessions, who))
    assert with_prev.objective.get("spacing", 0) > without.objective.get("spacing", 0)
