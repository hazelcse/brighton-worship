"""Media crews: a media team's roles (cameras, projectionist, ...) are parts the generator fills."""

from worship_worker.roster_engine import Person, Session, solve

QUARTER = ("2026-10-01", "2026-12-31")
CREW = {"media ic": 1, "director": 1, "video mixer": 1, "roving cam": 2, "wide angle cam": 1, "close up cam": 1, "projectionist": 1, "lights": 1}


def test_fills_a_media_crew():
    sessions = [
        Session("sun", "2026-11-22", "EM Sunday Service", "em", 1.0, CREW, "em_sunday"),
        Session("pnp", "2026-11-26", "EM Prayer & Praise", "em", 0.6, {"projectionist": 1, "lights": 1}, "em_pnp"),
    ]
    people = [
        Person("ic", "IC", ["media ic"], None),
        Person("dir", "Dir", ["director"], None),
        Person("vm", "VM", ["video mixer"], None),
        Person("r1", "R1", ["roving cam"], None),
        Person("r2", "R2", ["roving cam"], None),
        Person("wa", "WA", ["wide angle cam"], None),
        Person("cu", "CU", ["close up cam"], None),
        Person("pj", "PJ", ["projectionist", "lights"], None),
        Person("li", "LI", ["lights", "projectionist"], None),
    ]
    r = solve(sessions, people, [], QUARTER, time_limit=10)
    assert not r.unfilled
    sun = r.assignments["sun"]
    assert sorted(x["role"] for x in sun) == sorted(role for role, n in CREW.items() for _ in range(n))
    # In the session's own order: Media IC first, lights last.
    assert sun[0]["role"] == "media ic" and sun[-1]["role"] == "lights"
    assert sorted(x["role"] for x in r.assignments["pnp"]) == ["lights", "projectionist"]
