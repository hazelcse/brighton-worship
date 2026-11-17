"""Load a roster from the database, run the engine, and save the result.

generate  optimise a draft, replace its assignments, and keep a snapshot of what was generated
evaluate  score the draft's current (possibly hand-edited) assignments against that snapshot and
          save the problems found in rosters.check
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta

from supabase import Client

from .roster_engine import RULE_UNIT, Person, Rule, Session, check_assignments, solve

SCORE_WARN_POINTS = 1.0  # warn when hand edits cost this much (1 point = one miss of a weight-1 soft rule)
PART_WARN_PCT = 10  # ... or one part of it (fairness, spacing, EM/CM split)
SOFT_KINDS = ("soft_rule", "fairness", "split", "spacing", "variety")


def _member_fields(db: Client, team_id: str) -> tuple[bool, bool, bool]:
    """Whether the team uses each person's EM/CM share, "serves at" and personal rule
    (teams.config.memberFields; see web/src/lib/team-config.ts). They're on each member's team
    profile (team_members); a team that doesn't use one ignores whatever is saved there.
    Missing config: all used."""
    team = db.table("teams").select("config").eq("id", team_id).single().execute().data or {}
    fields = (team.get("config") or {}).get("memberFields") or {}
    return bool(fields.get("ministry", True)), bool(fields.get("serves", True)), bool(fields.get("rules", True))


def _load(db: Client, roster_id: str):
    roster = db.table("rosters").select("*").eq("id", roster_id).single().execute().data
    sess_rows = (db.table("roster_sessions").select("*").eq("roster_id", roster_id)
                 .eq("cancelled", False).order("date").execute().data)
    sessions = [
        Session(s["id"], s["date"], s["name"], s["ministry"], float(s["weight"]),
                {k: int(v) for k, v in (s["composition"] or {}).items() if int(v) > 0},
                s.get("kind") or "custom", s.get("rehearsal_date"))
        for s in sess_rows
    ]
    team_id = roster["team_id"]
    use_ministry, use_serves, use_rules = _member_fields(db, team_id)
    # Absences are personal: one absence counts for every team they're on.
    # From the earliest rehearsal, which can be before the quarter starts.
    absent = _absent_dates(db, min([roster["starts_on"], *(s.rehearsal for s in sessions if s.rehearsal)]), roster["ends_on"])
    # Each member's profile on this team (what they play here, EM/CM, serves at, personal rule).
    team_profiles = {r["user_id"]: r for r in db.table("team_members")
                     .select("user_id, instruments, no_roster_roles, em_percent, serves")
                     .eq("team_id", team_id).execute().data}
    elsewhere = _serving_elsewhere(db, team_id, roster["starts_on"], roster["ends_on"])
    rules = [
        Rule(r["id"], r["hard"], float(r["weight"]), r["template"], r["params"])
        # this team's defaults (roster_id null) plus this roster's own rules
        for r in db.table("roster_rules").select("*").eq("team_id", team_id).eq("enabled", True)
        .or_(f"roster_id.is.null,roster_id.eq.{roster_id}").execute().data
    ]
    before = _served_before(db, team_id, roster["starts_on"], _lookback_weeks(rules))
    people = [
        # A personal rule can keep someone off parts they play: the generator treats those as not theirs.
        Person(p["id"], p["full_name"] or p["email"],
               [i for i in (t["instruments"] or []) if i not in (t.get("no_roster_roles") or [] if use_rules else [])],
               t["em_percent"] if use_ministry else None,
               (t.get("serves") or "both") if use_serves else "both",
               absent.get(p["id"], set()), p.get("gender"), elsewhere.get(p["id"], {}), before.get(p["id"], []))
        # only this team's members; developer accounts are never rostered
        for p in (db.table("profiles").select("id, full_name, email, gender")
                  .in_("id", list(team_profiles)).eq("is_active", True).eq("is_developer", False).execute().data
                  if team_profiles else [])
        for t in [team_profiles[p["id"]]]
    ]
    return roster, sessions, people, rules


def _lookback_weeks(rules: list[Rule]) -> int:
    """How many weeks before the quarter matter: the longest "N weeks between services" rule (its
    run is N + 2 weeks at most), and at least the spacing preference's 3 weeks."""
    longest = max((int(r.params.get("weeks", 0)) for r in rules if r.template == "break"), default=0)
    return max(4, longest + 3)


def _served_before(db: Client, team_id: str, starts_on: str, weeks: int) -> dict[str, list[str]]:
    """Member id -> the dates they served on this team's previous published roster in the `weeks`
    weeks before starts_on (whole weeks from Monday). Break and spacing rules count them."""
    q_start = date.fromisoformat(starts_on)
    since = (q_start - timedelta(days=q_start.weekday()) - timedelta(weeks=weeks)).isoformat()
    prev = (db.table("rosters").select("id").eq("team_id", team_id).eq("status", "published")
            .lt("starts_on", starts_on).gte("ends_on", since).execute().data)
    if not prev:
        return {}
    sess = (db.table("roster_sessions").select("id, date").in_("roster_id", [r["id"] for r in prev])
            .eq("cancelled", False).gte("date", since).lt("date", starts_on).execute().data)
    if not sess:
        return {}
    date_of = {s["id"]: s["date"] for s in sess}
    out: dict[str, set[str]] = {}
    ids = list(date_of)
    for i in range(0, len(ids), 200):
        for a in db.table("roster_assignments").select("member_id, session_id").in_("session_id", ids[i:i + 200]).execute().data:
            out.setdefault(a["member_id"], set()).add(date_of[a["session_id"]])
    return {k: sorted(v) for k, v in out.items()}


def _serving_elsewhere(db: Client, team_id: str, starts_on: str, ends_on: str) -> dict[str, dict[str, str]]:
    """Member id -> {date: team name} for the days they serve on another team's published roster."""
    others = (db.table("rosters").select("id, teams(name)").neq("team_id", team_id).eq("status", "published")
              .lte("starts_on", ends_on).gte("ends_on", starts_on).execute().data)
    if not others:
        return {}
    team_of = {r["id"]: (r.get("teams") or {}).get("name") or "another team" for r in others}
    sess = (db.table("roster_sessions").select("id, date, roster_id").in_("roster_id", list(team_of))
            .eq("cancelled", False).gte("date", starts_on).lte("date", ends_on).execute().data)
    if not sess:
        return {}
    by_id = {s["id"]: s for s in sess}
    out: dict[str, dict[str, str]] = {}
    ids = list(by_id)
    for i in range(0, len(ids), 200):
        for a in db.table("roster_assignments").select("member_id, session_id").in_("session_id", ids[i:i + 200]).execute().data:
            s = by_id[a["session_id"]]
            out.setdefault(a["member_id"], {})[s["date"]] = team_of[s["roster_id"]]
    return out


def _absent_dates(db: Client, starts_on: str, ends_on: str) -> dict[str, set[str]]:
    """Member id -> every date from starts_on to ends_on they've marked themselves absent."""
    q_start, q_end = date.fromisoformat(starts_on), date.fromisoformat(ends_on)
    out: dict[str, set[str]] = {}
    rows = (db.table("absences").select("member_id, starts_on, ends_on")
            .lte("starts_on", ends_on).gte("ends_on", starts_on).execute().data)
    for r in rows:
        day = max(date.fromisoformat(r["starts_on"]), q_start)
        last = min(date.fromisoformat(r["ends_on"]), q_end)
        while day <= last:
            out.setdefault(r["member_id"], set()).add(day.isoformat())
            day += timedelta(days=1)
    return out


def _current_assignments(db: Client, session_ids: list[str]) -> list[dict]:
    if not session_ids:
        return []
    return (db.table("roster_assignments").select("session_id, member_id, role, also_roles")
            .in_("session_id", session_ids).execute().data)


def _key(rows: list[dict]) -> set[tuple]:
    return {(r["session_id"], r["member_id"], r["role"], tuple(sorted(r.get("also_roles") or []))) for r in rows}


def generate(db: Client, roster_id: str, time_limit: float = 30.0) -> dict:
    roster, sessions, people, rules = _load(db, roster_id)
    if roster["status"] != "draft":
        raise ValueError("Only draft rosters can be generated.")
    if not sessions:
        raise ValueError("There are no sessions to roster.")

    res = solve(sessions, people, rules, (roster["starts_on"], roster["ends_on"]), time_limit)
    if res.status == "no_solution":
        raise RuntimeError("The optimiser couldn't find any roster in time. Try again, or remove some rules.")

    # Replace this draft's assignments.
    ids = [s.id for s in sessions] + [s["id"] for s in db.table("roster_sessions").select("id").eq("roster_id", roster_id).eq("cancelled", True).execute().data]
    db.table("roster_assignments").delete().in_("session_id", ids).execute()
    rows = [
        {"session_id": sid, "member_id": a["member"], "role": a["role"], "also_roles": a["also"]}
        for sid, lst in res.assignments.items()
        for a in lst
    ]
    for i in range(0, len(rows), 500):
        db.table("roster_assignments").insert(rows[i:i + 500]).execute()

    result = asdict(res)
    result.pop("assignments")
    now = datetime.now(UTC).isoformat()
    db.table("rosters").update({
        "result": result,
        "generated_assignments": rows,  # for "reset to generated" and to spot hand edits
        "check": None,
        "generated_at": now,
        "updated_at": now,
    }).eq("id", roster_id).execute()
    return {"status": res.status, "unfilled": len(res.unfilled), "hard_broken": len(res.hard_broken),
            "assigned": len(rows), "seconds": res.solve_seconds}


def _soft_score(objective: dict) -> int:
    return sum(int(objective.get(k, 0)) for k in SOFT_KINDS)


def _pct(was: float, now: float) -> int:
    return round(100 * (now - was) / was) if was else (100 if now else 0)


def evaluate(db: Client, roster_id: str, full: bool = False) -> dict | None:
    """Score the current assignments; save and return rosters.check (None when nothing was edited,
    unless `full`: then the problems are always checked, since the stored generation result no
    longer describes a republished roster)."""
    roster, sessions, people, rules = _load(db, roster_id)
    current = _current_assignments(db, [s.id for s in sessions])
    generated = roster.get("generated_assignments") or []
    active = {s.id for s in sessions}
    changed = _key([r for r in generated if r["session_id"] in active]) ^ _key(current)
    if not changed and not full:
        db.table("rosters").update({"check": None}).eq("id", roster_id).execute()
        return None
    edited_cells = sorted({f"{k[0]}|{k[2]}" for k in changed})

    fixed: dict[str, list[dict]] = {}
    for r in current:
        fixed.setdefault(r["session_id"], []).append({"member": r["member_id"], "role": r["role"], "also": r.get("also_roles") or []})
    issues, clean = check_assignments(sessions, people, fixed)
    quarter = (roster["starts_on"], roster["ends_on"])
    res = solve(sessions, people, rules, quarter, 20.0, fixed=clean)

    # Baseline: the generated roster scored with today's rules and weights (they may have changed
    # since generating), so the comparison is like for like.
    gen_fixed: dict[str, list[dict]] = {}
    for r in generated:
        if r["session_id"] in active:
            gen_fixed.setdefault(r["session_id"], []).append({"member": r["member_id"], "role": r["role"], "also": r.get("also_roles") or []})
    _, gen_clean = check_assignments(sessions, people, gen_fixed)
    base = solve(sessions, people, rules, quarter, 20.0, fixed=gen_clean)
    gen_result = {"objective": base.objective, "soft": base.soft, "spacing": base.spacing, "variety": base.variety}

    hard = list(issues)
    hard += [{"kind": "unfilled", "session": u["session"], "role": u["role"], "count": u["missing"], "member": None} for u in res.unfilled]
    hard += [{"kind": "hard_rule", "rule": h["rule"], "count": h["violations"]} for h in res.hard_broken]

    soft: list[dict] = []
    gen_obj = gen_result.get("objective") or {}
    was, now = _soft_score(gen_obj), _soft_score(res.objective)
    change = _pct(was, now)
    points = round((now - was) / RULE_UNIT, 1)  # the total is dominated by fairness, so % hides real changes
    if points >= SCORE_WARN_POINTS:
        soft.append({"kind": "score", "points": points})
    for part in ("fairness", "spacing", "split", "variety"):
        p_was, p_now = int(gen_obj.get(part, 0)), int(res.objective.get(part, 0))
        if p_now > p_was and _pct(p_was, p_now) >= PART_WARN_PCT:
            soft.append({"kind": part, "pct": _pct(p_was, p_now)})
    gen_soft = {x["rule"]: x["violations"] for x in gen_result.get("soft") or []}
    for x in res.soft:
        before = gen_soft.get(x["rule"], 0)
        if x["violations"] > before:
            soft.append({"kind": "soft_rule", "rule": x["rule"], "was": before, "now": x["violations"]})
    gen_sp, now_sp = gen_result.get("spacing") or {}, res.spacing or {}
    if now_sp.get("within_1_week", 0) > gen_sp.get("within_1_week", 0):
        soft.append({"kind": "back_to_back", "was": gen_sp.get("within_1_week", 0), "now": now_sp["within_1_week"]})

    result = asdict(res)
    result.pop("assignments")
    check = {
        "checked_at": datetime.now(UTC).isoformat(),
        "edited_cells": edited_cells,
        "hard": hard,
        "soft": soft,
        "score": {"generated": was, "edited": now, "change_pct": change, "change_points": points},
        "result": result,
    }
    db.table("rosters").update({"check": check, "updated_at": check["checked_at"]}).eq("id", roster_id).execute()
    return check
