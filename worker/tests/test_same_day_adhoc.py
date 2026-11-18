"""An ad hoc event on a service day is taken to be later in the day: someone can serve at the
morning's standard service and the ad hoc event, but never at two standard services (or two ad hoc
events) on one date."""

from worship_worker.roster_engine import Person, Rule, Session, check_assignments, solve

QUARTER = ("2026-10-01", "2026-12-31")
DAY = "2026-12-20"


def _must(rid: str, member: str, kind: str, name: str) -> Rule:
    return Rule(rid, True, 1.0, "date", {"member": member, "polarity": "must", "date": DAY, "sessionKind": kind, "sessionName": name, "role": "keys"})


def _who(r, sid):
    return {a["member"] for a in r.assignments.get(sid, [])}


def test_service_and_adhoc_same_day():
    service = Session("s", DAY, "EM Sunday Service", "any", 1.0, {"keys": 1}, "em_sunday")
    adhoc = Session("a", DAY, "Carol Concert", "any", 1.0, {"keys": 1}, "custom")
    people = [Person("ann", "Ann", ["keys"], None)]
    r = solve([service, adhoc], people, [], QUARTER, time_limit=5)
    assert _who(r, "s") == {"ann"} and _who(r, "a") == {"ann"}
    assert not r.unfilled


def test_two_standard_services_still_clash():
    em = Session("em", DAY, "EM Sunday Service", "any", 1.0, {"keys": 1}, "em_sunday")
    cm = Session("cm", DAY, "CM Sunday Service", "any", 1.0, {"keys": 1}, "cm_sunday")
    people = [Person("ann", "Ann", ["keys"], None)]
    r = solve([em, cm], people, [], QUARTER, time_limit=5)
    assert len(r.unfilled) == 1


def test_two_adhoc_events_still_clash():
    a = Session("a", DAY, "Carol Concert", "any", 1.0, {"keys": 1}, "custom")
    b = Session("b", DAY, "Prayer Night", "any", 1.0, {"keys": 1}, "custom")
    people = [Person("ann", "Ann", ["keys"], None)]
    r = solve([a, b], people, [_must("r1", "ann", "custom", "Carol Concert")], QUARTER, time_limit=5)
    assert _who(r, "a") == {"ann"} and not _who(r, "b")


def test_hand_edit_check_allows_service_plus_adhoc():
    service = Session("s", DAY, "EM Sunday Service", "any", 1.0, {"keys": 1}, "em_sunday")
    adhoc = Session("a", DAY, "Carol Concert", "any", 1.0, {"keys": 1}, "custom")
    cm = Session("cm", DAY, "CM Sunday Service", "any", 1.0, {"keys": 1}, "cm_sunday")
    people = [Person("ann", "Ann", ["keys"], None)]
    fixed = {sid: [{"member": "ann", "role": "keys", "also": []}] for sid in ("s", "a", "cm")}
    issues, _ = check_assignments([service, adhoc, cm], people, fixed)
    assert [i["kind"] for i in issues] == ["double_date"]
