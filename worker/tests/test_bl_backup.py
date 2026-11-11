"""BL/TB backup: if a band's BL/TB can't make it, someone can step in for their instrument and BL/TB."""

from worship_worker.roster_engine import Person, Rule, Session, solve

QUARTER = ("2026-10-01", "2026-12-31")
BACKUP = Rule("bk", False, 0.5, "bl_backup", {})
BL = "band leader"


def _session(sid="s", date="2026-11-15", comp=None):
    return Session(sid, date, "EM Sunday Service", "em", 1.0, comp or {"electric guitar": 1, "bass": 1, BL: 1}, "em_sunday")


def _p(pid, *skills):
    return Person(pid, pid.title(), list(skills), 100)


def _miss(r):
    return next(e for e in r.soft if e["rule"] == "bk")


def _fixed(*rows):
    return {"s": [{"member": m_, "role": role, "also": [BL] if bl else []} for m_, role, bl in rows]}


def test_free_player_who_does_both_is_a_backup():
    people = [_p("eg", "electric guitar", BL), _p("ba", "bass"), _p("sub", "electric guitar", BL)]
    r = solve([_session()], people, [BACKUP], QUARTER, time_limit=5, fixed=_fixed(("eg", "electric guitar", True), ("ba", "bass", False)))
    assert _miss(r)["violations"] == 0


def test_free_player_plus_bandmate_who_can_do_bl_is_a_backup():
    people = [_p("eg", "electric guitar", BL), _p("ba", "bass", BL), _p("sub", "electric guitar")]
    r = solve([_session()], people, [BACKUP], QUARTER, time_limit=5, fixed=_fixed(("eg", "electric guitar", True), ("ba", "bass", False)))
    assert _miss(r)["violations"] == 0


def test_no_backup_is_missed_and_points_at_the_bl():
    # The only other guitarist can't do BL/TB and nobody else in the band can.
    people = [_p("eg", "electric guitar", BL), _p("ba", "bass"), _p("sub", "electric guitar")]
    r = solve([_session()], people, [BACKUP], QUARTER, time_limit=5, fixed=_fixed(("eg", "electric guitar", True), ("ba", "bass", False)))
    miss = _miss(r)
    assert miss["violations"] == 1
    assert miss["where"] == [{"members": ["eg"], "dates": ["2026-11-15"]}]


def test_backup_serving_elsewhere_that_day_or_away_does_not_count():
    other = Session("o", "2026-11-15", "CM Sunday Service", "any", 1.0, {"electric guitar": 1}, "cm_sunday")
    people = [_p("eg", "electric guitar", BL), _p("ba", "bass"), _p("sub", "electric guitar", BL)]
    fixed = {**_fixed(("eg", "electric guitar", True), ("ba", "bass", False)), "o": [{"member": "sub", "role": "electric guitar", "also": []}]}
    r = solve([_session(), other], people, [BACKUP], QUARTER, time_limit=5, fixed=fixed)
    assert _miss(r)["violations"] == 1

    away = _p("sub", "electric guitar", BL)
    away.absent = {"2026-11-15"}
    r = solve([_session()], [people[0], people[1], away], [BACKUP], QUARTER, time_limit=5, fixed=_fixed(("eg", "electric guitar", True), ("ba", "bass", False)))
    assert _miss(r)["violations"] == 1


def test_generator_picks_the_bl_who_has_a_backup():
    # Two guitarists can do BL/TB but only "eg2" has someone free to cover their instrument:
    # the drummer can't be covered, so BL/TB should go to a guitarist.
    comp = {"electric guitar": 1, "drums": 1, BL: 1}
    people = [_p("gt", "electric guitar", BL), _p("dr", "drums", BL), _p("gt2", "electric guitar", BL)]
    r = solve([_session(comp=comp)], people, [BACKUP], QUARTER, time_limit=5)
    assert _miss(r)["violations"] == 0
    bl = [a["member"] for a in r.assignments["s"] if BL in a["also"]]
    assert bl and bl[0] in ("gt", "gt2")
