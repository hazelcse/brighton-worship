"""Ad-hoc sessions with a band picked by root: each pick is a hard 'serve at this session' rule on
that roster, naming the part (and BL/TB). The rest of the roster is generated around them."""

from worship_worker.roster_engine import Person, Rule, Session, solve

QUARTER = ("2026-10-01", "2026-12-31")
DAY = "2026-12-24"


def _pick(rid: str, member: str, role: str, bl: bool = False) -> Rule:
    params = {"member": member, "polarity": "must", "date": DAY, "sessionKind": "custom", "sessionName": "Christmas Eve", "role": role}
    if bl:
        params["bandLeader"] = True
    return Rule(rid, True, 1.0, "date", params)


def _people():
    return [
        Person("ann", "Ann", ["keys", "vocalist", "band leader"], 100),
        Person("ben", "Ben", ["keys", "band leader"], 100),
        Person("cat", "Cat", ["keys", "vocalist", "band leader"], 100),
    ]


def _who(r, sid):
    return {(a["member"], a["role"], tuple(a["also"])) for a in r.assignments.get(sid, [])}


def test_picked_part_and_band_leader_are_kept():
    adhoc = Session("x", DAY, "Christmas Eve", "any", 1.0, {"keys": 1, "vocalist": 1, "band leader": 1}, "custom")
    rules = [_pick("r1", "cat", "keys", bl=True), _pick("r2", "ann", "vocalist")]
    r = solve([adhoc], _people(), rules, QUARTER, time_limit=5)
    assert _who(r, "x") == {("cat", "keys", ("band leader",)), ("ann", "vocalist", ())}
    assert not r.hard_broken


def test_rest_of_roster_works_around_picked_band():
    adhoc = Session("x", DAY, "Christmas Eve", "any", 1.0, {"keys": 1}, "custom")
    other = Session("y", DAY, "EM Sunday Service", "em", 1.0, {"keys": 1}, "em_sunday")
    r = solve([adhoc, other], _people(), [_pick("r1", "cat", "keys")], QUARTER, time_limit=5)
    assert _who(r, "x") == {("cat", "keys", ())}
    assert "cat" not in {m for m, _, _ in _who(r, "y")}


def test_places_left_empty_are_filled():
    adhoc = Session("x", DAY, "Christmas Eve", "any", 1.0, {"keys": 2}, "custom")
    r = solve([adhoc], _people(), [_pick("r1", "cat", "keys")], QUARTER, time_limit=5)
    members = {m for m, _, _ in _who(r, "x")}
    assert "cat" in members and len(members) == 2
    assert not r.unfilled
