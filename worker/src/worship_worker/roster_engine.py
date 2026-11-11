"""Roster generator: an integer linear programme solved with OR-Tools (CP-SAT).

Decision variables
  x[p, s, r] = 1 if person p plays main role r at session s (only created when p has the skill
               and their ministry allows the session)
  a[p, s, t] = 1 if person p also takes attached role t (band leader / talkback) at session s

Built-in hard rules (never relaxed)
  * at most one main role per person per session -> WL and vocalist are always different people
  * band leader / talkback only for someone playing an instrument in that session
  * at most one session per person per date
  * nobody is rostered on a date they've marked absent, or for a service whose rehearsal falls on
    one: they get no variable for that session at all
Built-in hard rules that can fail (relaxed with a huge penalty so we can report *why*)
  * every slot in every band is filled
  * the user's hard rules
Soft objectives (penalised by weight)
  * the user's soft rules (weight 0-1)
  * fairness: spread load evenly (sum of squared loads), worked out separately for main services
    and for Prayer & Praise so nobody ends up doing only P&Ps; its weight comes from the permanent
    "share the load fairly" rule
  * spacing: spread each person's services out; extra services inside any 1/2/3-week window cost,
    so the closer two services are the more they cost (weight from the permanent "space out" rule)
  * EM/CM split: people serving both have their weighted load split by their EM percentage
  * singer balance (a permanent rule, reported like a user soft rule): in each band with 2+
    singers, no more than half of them (rounded up) of one gender
  * BL/TB backup (a permanent rule, reported like a user soft rule): if a band's BL/TB can't make
    it, someone free that day can take over their instrument and BL/TB, or someone free can take
    the instrument and a bandmate can take BL/TB

All weights are scaled to integers; see SCALE below.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from ortools.sat.python import cp_model

MAIN_ROLES = ["worship leader", "vocalist", "keys", "synth/pads", "electric guitar", "acoustic guitar", "bass", "drums"]
# Band leader and talkback are one job, done by the same person (stored as "band leader").
ATTACHED_ROLES = ["band leader"]
SINGING = {"worship leader", "vocalist"}
INSTRUMENTS = [r for r in MAIN_ROLES if r not in SINGING]

# Objective scaling (everything must be an integer)
HARD_PENALTY = 10_000_000  # per unit of a hard violation (unfilled slot, broken hard rule)
RULE_UNIT = 10_000  # x rule weight (0-1) per unit of soft-rule violation
DEFAULT_FAIRNESS_WEIGHT = 0.5  # used only if the permanent "share the load fairly" rule is missing
SPLIT_WEIGHT = 0.7  # built-in soft rule: EM/CM split
VARIETY_SECONDS = 20  # time for the second, team-mixing pass
LOAD_SCALE = 10  # session weight 0.6 -> 6


@dataclass
class Session:
    id: str
    date: str
    name: str
    ministry: str  # em | cm | any
    weight: float
    composition: dict[str, int]
    kind: str = "custom"  # em_sunday | cm_sunday | em_pnp | cm_pnp | custom
    rehearsal: str | None = None  # "YYYY-MM-DD": the band's rehearsal; everyone rostered must be there

    @property
    def category(self) -> str:
        """Fairness is balanced separately per category."""
        return "pnp" if self.kind.endswith("_pnp") else "service"


@dataclass
class Person:
    id: str
    name: str
    instruments: list[str]
    em_percent: int | None
    serves: str = "both"  # both | sunday | pnp
    absent: set[str] = field(default_factory=set)  # "YYYY-MM-DD" dates they've marked as away (hard: never rostered)
    gender: str | None = None  # male | female | None (not set): used by the singer balance rule


@dataclass
class Rule:
    id: str
    hard: bool
    weight: float
    template: str
    params: dict


@dataclass
class Result:
    status: str  # optimal | feasible | impossible | no_solution
    assignments: dict[str, list[dict]] = field(default_factory=dict)  # session id -> [{member, role, also}]
    unfilled: list[dict] = field(default_factory=list)
    hard_broken: list[dict] = field(default_factory=list)
    soft: list[dict] = field(default_factory=list)
    loads: list[dict] = field(default_factory=list)
    weights: dict = field(default_factory=dict)
    objective: dict = field(default_factory=dict)
    spacing: dict = field(default_factory=dict)
    variety: dict = field(default_factory=dict)
    solve_seconds: float = 0.0


# ---------------------------------------------------------------------------
# Helpers mirroring web/src/lib/roster.ts
# ---------------------------------------------------------------------------


def serves_em(p: Person) -> bool:
    return p.em_percent is None or p.em_percent > 0


def serves_cm(p: Person) -> bool:
    return p.em_percent is None or p.em_percent < 100


def eligible(p: Person, s: Session) -> bool:
    if (p.serves == "sunday" and s.category == "pnp") or (p.serves == "pnp" and s.category == "service"):
        return False
    return s.ministry == "any" or (s.ministry == "em" and serves_em(p)) or (s.ministry == "cm" and serves_cm(p))


def subject_members(subject: dict, people: list[Person]) -> list[Person]:
    kind = subject.get("kind")
    if kind == "everyone":
        return people
    if kind == "ministry":
        return [p for p in people if (serves_em(p) if subject.get("value") == "em" else serves_cm(p))]
    if kind == "role":
        return [p for p in people if subject.get("value") in p.instruments]
    if kind == "member":
        return [p for p in people if p.id == subject.get("value")]
    return []


def frequency_exemptions(rule: Rule, rules: list[Rule], people: list[Person]) -> set[str]:
    """Specific beats general: people with their own frequency rule (same period) skip group ones."""
    p = rule.params
    if rule.template != "frequency" or p["subject"]["kind"] == "member":
        return set()
    covered = {x.id for x in subject_members(p["subject"], people)}
    return {
        r.params["subject"]["value"]
        for r in rules
        if r.id != rule.id
        and r.template == "frequency"
        and r.params["subject"]["kind"] == "member"
        and r.params["period"] == p["period"]
        and r.params["subject"]["value"] in covered
    }


def d(s: str) -> date:
    return date.fromisoformat(s)


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------


def check_assignments(sessions: list[Session], people: list[Person],
                      fixed: dict[str, list[dict]]) -> tuple[list[dict], dict[str, list[dict]]]:
    """Problems a hand-edited roster has that the optimiser would never produce, plus a cleaned copy
    (duplicates dropped) that the model can score. Each problem: {kind, session, member, role}."""
    by_id = {p.id: p for p in people}
    issues: list[dict] = []
    clean: dict[str, list[dict]] = {}
    busy: dict[tuple[str, str], str] = {}  # (member, date) -> session id
    for s in sorted(sessions, key=lambda s: (s.date, s.name)):
        rows, seen = [], set()
        for a in fixed.get(s.id, []):
            pid, role = a["member"], a["role"]
            person = by_id.get(pid)
            base = {"session": s.id, "member": pid, "role": role}
            if person is None:
                issues.append({**base, "kind": "inactive"})
                continue
            if pid in seen:
                issues.append({**base, "kind": "two_roles"})
                continue
            if (pid, s.date) in busy:
                issues.append({**base, "kind": "double_date", "other": busy[pid, s.date]})
                continue
            seen.add(pid)
            busy[pid, s.date] = s.id
            if s.date in person.absent:
                issues.append({**base, "kind": "absent"})
            elif s.rehearsal and s.rehearsal in person.absent:
                issues.append({**base, "kind": "absent_rehearsal"})
            if role not in person.instruments:
                issues.append({**base, "kind": "skill"})
            if not (s.ministry == "any" or (s.ministry == "em" and serves_em(person)) or (s.ministry == "cm" and serves_cm(person))):
                issues.append({**base, "kind": "ministry"})
            if (person.serves == "sunday" and s.category == "pnp") or (person.serves == "pnp" and s.category == "service"):
                issues.append({**base, "kind": "serves"})
            also = []
            for t in a.get("also") or []:
                if role not in INSTRUMENTS:
                    issues.append({**base, "kind": "attached_singer", "role": t})
                    continue
                if t not in person.instruments:
                    issues.append({**base, "kind": "skill", "role": t})
                also.append(t)
            rows.append({"member": pid, "role": role, "also": also})
        # more people than the band needs
        for role in {r["role"] for r in rows} | {t for r in rows for t in r["also"]}:
            n = sum(1 for r in rows if r["role"] == role or role in r["also"])
            if n > s.composition.get(role, 0):
                issues.append({"session": s.id, "member": None, "role": role, "kind": "extra", "count": n - s.composition.get(role, 0)})
        clean[s.id] = rows
    return issues, clean


def solve(sessions: list[Session], people: list[Person], rules: list[Rule], quarter: tuple[str, str],
          time_limit: float = 30.0, fixed: dict[str, list[dict]] | None = None) -> Result:
    """Optimise a roster, or (with `fixed`, already cleaned by check_assignments) score a given one."""
    m = cp_model.CpModel()
    q_start, q_end = d(quarter[0]), d(quarter[1])
    fixed_x = {(a["member"], sid, a["role"]) for sid, lst in (fixed or {}).items() for a in lst}
    fixed_a = {(a["member"], sid, t) for sid, lst in (fixed or {}).items() for a in lst for t in a.get("also") or []}

    x: dict[tuple[str, str, str], cp_model.IntVar] = {}
    a: dict[tuple[str, str, str], cp_model.IntVar] = {}
    for s in sessions:
        for p in people:
            # Absences are a hard rule: no variable at all, so they can never be rostered that day,
            # nor for a service whose rehearsal they'll miss.
            if not eligible(p, s) or s.date in p.absent or (s.rehearsal and s.rehearsal in p.absent):
                continue
            for r in MAIN_ROLES:
                if s.composition.get(r, 0) > 0 and r in p.instruments:
                    x[p.id, s.id, r] = m.NewBoolVar(f"x_{p.id[:6]}_{s.id[:6]}_{r}")
            for t in ATTACHED_ROLES:
                if s.composition.get(t, 0) > 0 and t in p.instruments and any(i in p.instruments for i in INSTRUMENTS):
                    a[p.id, s.id, t] = m.NewBoolVar(f"a_{p.id[:6]}_{s.id[:6]}_{t}")
    if fixed is not None:
        # Hand edits may use people the optimiser couldn't: give them variables too, then pin
        # every variable to the edited roster.
        for key in fixed_x - x.keys():
            x[key] = m.NewBoolVar(f"x_{key[0][:6]}_{key[1][:6]}_{key[2]}")
        for key in fixed_a - a.keys():
            a[key] = m.NewBoolVar(f"a_{key[0][:6]}_{key[1][:6]}_{key[2]}")
        for key, v in x.items():
            m.Add(v == (1 if key in fixed_x else 0))
        for key, v in a.items():
            m.Add(v == (1 if key in fixed_a else 0))

    by_ps: dict[tuple[str, str], list] = defaultdict(list)
    for (pid, sid, r), v in x.items():
        by_ps[pid, sid].append((r, v))

    # serving indicator y[p, s] (0/1 because of the one-role constraint)
    y: dict[tuple[str, str], cp_model.LinearExpr] = {}
    for (pid, sid), lst in by_ps.items():
        m.Add(sum(v for _, v in lst) <= 1)  # one main role per session
        y[pid, sid] = sum(v for _, v in lst)

    def served(pid: str, sid: str):
        return y.get((pid, sid), 0)

    sessions_on: dict[str, list[Session]] = defaultdict(list)
    for s in sessions:
        sessions_on[s.date].append(s)
    dates = sorted(sessions_on)

    # z[p, date]: serves on that date (at most one session per date)
    z: dict[tuple[str, str], cp_model.LinearExpr] = {}
    for p in people:
        for dt in dates:
            terms = [y[p.id, s.id] for s in sessions_on[dt] if (p.id, s.id) in y]
            if terms:
                expr = sum(terms)
                if len(terms) > 1:
                    m.Add(expr <= 1)
                z[p.id, dt] = expr

    def on_date(pid: str, dt: str):
        return z.get((pid, dt), 0)

    # band leader / talkback only for someone playing an instrument at that session
    if fixed is None:  # (hand edits are checked by check_assignments instead)
        for (pid, sid, t), v in a.items():
            playing = [xv for (r, xv) in by_ps.get((pid, sid), []) if r in INSTRUMENTS]
            m.Add(v <= sum(playing)) if playing else m.Add(v == 0)

    penalties: list = []  # (coef, expr, kind, ref)
    unfilled_vars: list[tuple[Session, str, cp_model.IntVar]] = []

    # every slot filled (slack = unfilled places, hugely penalised)
    for s in sessions:
        for role, need in s.composition.items():
            if need <= 0:
                continue
            pool = x if role in MAIN_ROLES else a
            vars_ = [v for (pid, sid, r), v in pool.items() if sid == s.id and r == role]
            short = m.NewIntVar(0, need, f"short_{s.id[:6]}_{role}")
            if fixed is None:
                m.Add(sum(vars_) + short == need)
            else:  # an edited roster may have extra people (reported by check_assignments)
                m.Add(sum(vars_) + short >= need)
            unfilled_vars.append((s, role, short))
            penalties.append((HARD_PENALTY, short, "unfilled", None))

    # ---- user rules ---------------------------------------------------------------
    rule_viols: dict[str, list] = defaultdict(list)
    # Where each check is about (same order as rule_viols): the people and dates involved, so a
    # miss can be pointed out on the roster. No people = everyone on those dates.
    rule_where: dict[str, list] = defaultdict(list)

    # A miss / penalty var is only bounded below (v >= expr), which is all the objective needs, but
    # the solver may leave it above that bound: a time limit or the 2% gap stops it early, and the
    # variety pass only minimises variety. So reports work out the tight value from the actual
    # assignments (the largest lower bound) instead of trusting the var.
    lower: dict[int, list] = defaultdict(list)

    def at_least(v, expr) -> None:
        m.Add(v >= expr)
        lower[v.Index()].append(expr)

    def note(rule_id: str, v, members: list[str], on: list[str]) -> None:
        rule_viols[rule_id].append(v)
        rule_where[rule_id].append({"members": members, "dates": on})

    def violation(expr, op: str, k: int, ub: int, name: str):
        """A var >= how far expr is from satisfying `expr op k` (0 when satisfied)."""
        v = m.NewIntVar(0, max(ub, k) + 1, name)
        if op in ("<=", "<"):
            lim = k if op == "<=" else k - 1
            at_least(v, expr - lim)
        elif op in (">=", ">"):
            lim = k if op == ">=" else k + 1
            at_least(v, lim - expr)
        elif op == "=":
            at_least(v, expr - k)
            at_least(v, k - expr)
        elif op == "!=":
            eq = m.NewBoolVar(name + "_eq")
            m.Add(expr == k).OnlyEnforceIf(eq)
            m.Add(expr != k).OnlyEnforceIf(eq.Not())
            at_least(v, eq)
        return v

    negate = {">": "<=", ">=": "<", "=": "!=", "<=": ">", "<": ">="}

    def months_in_quarter():
        out = []
        cur = date(q_start.year, q_start.month, 1)
        while cur <= q_end:
            nxt = date(cur.year + (cur.month == 12), cur.month % 12 + 1, 1)
            out.append((cur, nxt - timedelta(days=1)))
            cur = nxt
        return out

    fairness_rule = next((r for r in rules if r.template == "fairness"), None)
    fairness_weight = fairness_rule.weight if fairness_rule else DEFAULT_FAIRNESS_WEIGHT
    # "Serve less": a factor f < 1 scales a member's fair share; their squared load costs 1/f as much.
    # (The cheapest split has 2L/f equal for everyone, so load ends up proportional to f: 0.5 = about
    # half. Dividing by f^2 instead would give f^2, i.e. 0.5 = about a quarter.)
    reduced = {k: float(v) for k, v in ((fairness_rule.params or {}).get("reduced") or {}).items()} if fairness_rule else {}
    spacing_rule = next((r for r in rules if r.template == "spacing"), None)
    variety_rule = next((r for r in rules if r.template == "variety"), None)
    builtin = [r for r in (fairness_rule, spacing_rule, variety_rule) if r]
    rules = [r for r in rules if r.template not in ("fairness", "spacing", "variety")]  # handled below, not constraints

    # Variety: every time two people serve together again after the first time costs a little, so
    # teams get mixed up. Built after the main model (see below): it's solved as a second pass.
    def add_variety() -> list:
        out = []
        together: dict[tuple[str, str], list] = defaultdict(list)
        for s_ in sessions:
            here = sorted(pid for (pid, sid) in y if sid == s_.id)
            for i, p1 in enumerate(here):
                for p2 in here[i + 1:]:
                    w = m.NewBoolVar(f"tg_{p1[:5]}_{p2[:5]}_{s_.id[:5]}")
                    m.Add(w >= y[p1, s_.id] + y[p2, s_.id] - 1)
                    together[p1, p2].append(w)
        unit = max(1, round(variety_rule.weight * RULE_UNIT / 20))
        for pair, ws in together.items():
            if len(ws) < 2:
                continue
            rep_ = m.NewIntVar(0, len(ws) - 1, f"rp_{pair[0][:5]}_{pair[1][:5]}")
            m.Add(rep_ >= sum(ws) - 1)
            out.append((unit, rep_, "variety", None))
        return out

    # Spacing: in every window of 1, 2 and 3 weeks, each service beyond the first costs; short
    # windows overlap, so two services a week apart cost the most (3 units), two weeks apart 2, three 1.
    if spacing_rule and spacing_rule.weight > 0:
        unit = max(1, round(spacing_rule.weight * RULE_UNIT / 3))
        for person in people:
            my_dates = [dt for dt in dates if (person.id, dt) in z]
            for weeks in (1, 2, 3):
                span = 7 * weeks  # dates less than or equal to span days apart share a window
                for i, d1 in enumerate(my_dates):
                    inside = [dt for dt in my_dates[i:] if (d(dt) - d(d1)).days <= span]
                    if len(inside) < 2:
                        continue
                    ex = m.NewIntVar(0, len(inside) - 1, f"sp{weeks}_{person.id[:6]}_{d1}")
                    at_least(ex, sum(z[person.id, dt] for dt in inside) - 1)
                    penalties.append((unit, ex, "spacing", person.id))

    genders = {p.id: p.gender for p in people}
    for rule in rules:
        p = rule.params
        coef = HARD_PENALTY if rule.hard else max(1, round(rule.weight * RULE_UNIT))
        tag = f"r{rule.id[:6]}"
        if rule.template == "frequency":
            op = p["op"] if p["polarity"] == "should" else negate[p["op"]]
            exempt = frequency_exemptions(rule, rules, people)
            blocks = months_in_quarter() if p["period"] == "month" else [(q_start, q_end)]
            for person in subject_members(p["subject"], people):
                if person.id in exempt:
                    continue
                for (b0, b1) in blocks:
                    sids = [s.id for s in sessions if b0 <= d(s.date) <= b1]
                    expr = sum(served(person.id, sid) for sid in sids)
                    v = violation(expr, op, int(p["count"]), len(sids), f"{tag}_{person.id[:6]}_{b0}")
                    note(rule.id, v, [person.id], sorted({s.date for s in sessions if b0 <= d(s.date) <= b1}))
        elif rule.template == "pair":
            for dt in dates:
                za, zb = on_date(p["a"], dt), on_date(p["b"], dt)
                v = m.NewIntVar(0, 1, f"{tag}_{dt}")
                if p["polarity"] == "should_not":
                    at_least(v, za + zb - 1)
                else:  # should serve on the same date: if one serves, so does the other
                    at_least(v, za - zb)
                    at_least(v, zb - za)
                note(rule.id, v, [p["a"], p["b"]], [dt])
        elif rule.template == "break":
            weeks, op = int(p["weeks"]), p["op"]
            except_ = set(p.get("except") or [])
            for person in subject_members(p["subject"], people):
                if person.id in except_:
                    continue
                my_dates = [dt for dt in dates if (person.id, dt) in z]
                # "N weeks between services" = N clear weeks (Monday to Sunday) between the weeks
                # of two services, whatever days they fall on. So 1 week rules out back-to-back
                # weeks, and Sun 4 Jan then Thu 22 Jan has 2 (the weeks of 5 and 12 Jan are free).
                monday0 = q_start - timedelta(days=q_start.weekday())

                def wk(dt: str) -> int:
                    return (d(dt) - monday0).days // 7

                if op in (">=", ">", "="):  # minimum gap between two services
                    span = weeks + 1 if op in (">=", "=") else weeks + 2
                    # Each run of `span` weeks starting at one of their weeks may hold one service;
                    # every extra service in it is one miss (a sliding window solves much faster
                    # than checking every pair of dates).
                    for w0 in sorted({wk(dt) for dt in my_dates}):
                        inside = [dt for dt in my_dates if w0 <= wk(dt) < w0 + span]
                        if len(inside) < 2:
                            continue
                        v = m.NewIntVar(0, len(inside) - 1, f"{tag}_{person.id[:6]}_w{w0}")
                        at_least(v, sum(z[person.id, dt] for dt in inside) - 1)
                        note(rule.id, v, [person.id], inside)
                if op in ("<=", "<", "="):  # maximum gap: every run of that many weeks has a service
                    # at most N clear weeks: every N + 1 weeks in a row hold one of their services
                    length = weeks + 1 if op in ("<=", "=") else weeks
                    last = wk(q_end.isoformat())
                    for w0 in range(0, last - length + 2):
                        inside = [dt for dt in my_dates if w0 <= wk(dt) < w0 + length]
                        v = m.NewIntVar(0, 1, f"{tag}_{person.id[:6]}_m{w0}")
                        at_least(v, 1 - sum(z[person.id, dt] for dt in inside))
                        note(rule.id, v, [person.id], [dt for dt in dates if w0 <= wk(dt) < w0 + length])
        elif rule.template == "date":
            if p.get("sessionKind"):
                # One session that day (e.g. the CM Sunday Service), named by kind (and name for
                # a custom event) so a default rule still finds it in another roster.
                at = [
                    s for s in sessions_on.get(p["date"], [])
                    if s.kind == p["sessionKind"] and (s.kind != "custom" or s.name == p.get("sessionName"))
                ]
                if p.get("role") and p["polarity"] == "must":
                    # A band picked by hand (ad-hoc session): that part, and BL/TB too if picked.
                    expr = sum(x.get((p["member"], s.id, p["role"]), 0) for s in at)
                    if p.get("bandLeader"):
                        bl = m.NewIntVar(0, 1, f"{tag}_bl")
                        at_least(bl, 1 - sum(a.get((p["member"], s.id, "band leader"), 0) for s in at))
                        note(rule.id, bl, [], [p["date"]])
                else:
                    expr = sum(served(p["member"], s.id) for s in at)
            else:  # older rules: any session that day
                expr = on_date(p["member"], p["date"])
            v = m.NewIntVar(0, 1, f"{tag}_date")
            if p["polarity"] == "must":
                at_least(v, 1 - expr)
                note(rule.id, v, [], [p["date"]])  # they're missing: point at that day's sessions
            else:
                at_least(v, expr)
                note(rule.id, v, [p["member"]], [p["date"]])
        elif rule.template == "singer_balance":
            # In each band with 2+ singers (WL + vocalists), no more than half (rounded up) of the
            # singers should be one gender: 2 singers = one man and one woman, 3 = two and one.
            # Singers whose gender isn't set count for neither side. Each extra singer of the
            # over-represented gender is one miss.
            for s in sessions:
                n = sum(need for role, need in s.composition.items() if role in SINGING)
                if n < 2:
                    continue
                cap = (n + 1) // 2
                v = m.NewIntVar(0, n, f"{tag}_{s.id[:6]}")
                for g in ("male", "female"):
                    sing = [xv for (pid, sid, r), xv in x.items() if sid == s.id and r in SINGING and genders.get(pid) == g]
                    if len(sing) > cap:
                        at_least(v, sum(sing) - cap)
                note(rule.id, v, [], [s.date])
                rule_where[rule.id][-1]["singers_at"] = s.id  # narrowed to the actual singers below
        elif rule.template == "bl_backup":
            # Someone can step in if the BL/TB can't make it. Whoever does BL/TB on instrument i is
            # covered when, among people free that day (not serving any session then, able to
            # serve this one, not away on the day or the rehearsal):
            #   * someone plays i and does BL/TB (they take over both), or
            #   * someone plays i, and a bandmate on another instrument there does BL/TB.
            # Each band without such a backup is one miss. Every helper below is tied exactly to the
            # assignments (no slack), so reports count real misses.
            bl = ATTACHED_ROLES[0]
            skills = {p_.id: set(p_.instruments) for p_ in people}

            def flag(expr, at_least_n: int, name: str):
                b = m.NewBoolVar(name)
                if isinstance(expr, int):  # nobody's choice changes it (e.g. everyone's free that day)
                    m.Add(b == int(expr >= at_least_n))
                    return b
                m.Add(expr >= at_least_n).OnlyEnforceIf(b)
                m.Add(expr <= at_least_n - 1).OnlyEnforceIf(b.Not())
                return b

            for s in sessions:
                if s.composition.get(bl, 0) <= 0:
                    continue
                insts = [i for i in INSTRUMENTS if s.composition.get(i, 0) > 0]
                if not insts:
                    continue
                pool = [q for q in people if eligible(q, s) and s.date not in q.absent and not (s.rehearsal and s.rehearsal in q.absent)]
                bl_band = [xv for (pid, sid, r), xv in x.items() if sid == s.id and r in INSTRUMENTS and bl in skills[pid]]
                # the BL/TB plus at least one other BL/TB-capable player in the band
                mate = flag(sum(bl_band), 2, f"{tag}_mate_{s.id[:6]}") if len(bl_band) >= 2 else None
                v = m.NewIntVar(0, 1, f"{tag}_{s.id[:6]}")
                for i in insts:
                    holders = [pid for (pid, sid, t) in a if sid == s.id and t == bl and (pid, s.id, i) in x]
                    if not holders:
                        continue
                    players = [q.id for q in pool if i in q.instruments]
                    free_play = sum(1 - on_date(q, s.date) for q in players) if players else 0
                    free_both = sum(1 - on_date(q, s.date) for q in players if bl in skills[q]) if players else 0
                    parts = []
                    if any(bl in skills[q] for q in players):
                        parts.append(flag(free_both, 1, f"{tag}_both_{s.id[:6]}_{i[:4]}"))
                    if players and mate is not None:
                        play = flag(free_play, 1, f"{tag}_play_{s.id[:6]}_{i[:4]}")
                        split = m.NewBoolVar(f"{tag}_split_{s.id[:6]}_{i[:4]}")
                        m.AddBoolAnd([play, mate]).OnlyEnforceIf(split)
                        m.AddBoolOr([play.Not(), mate.Not()]).OnlyEnforceIf(split.Not())
                        parts.append(split)
                    ok = m.NewBoolVar(f"{tag}_ok_{s.id[:6]}_{i[:4]}")
                    if parts:
                        m.AddBoolOr(parts).OnlyEnforceIf(ok)
                        m.AddBoolAnd([p_.Not() for p_ in parts]).OnlyEnforceIf(ok.Not())
                    else:
                        m.Add(ok == 0)
                    for pid in holders:  # miss if this person does BL/TB on i and there's no backup
                        at_least(v, a[pid, s.id, bl] + x[pid, s.id, i] - 1 - ok)
                note(rule.id, v, [], [s.date])
                rule_where[rule.id][-1]["bl_at"] = s.id  # narrowed to the BL/TB below

        for v in rule_viols[rule.id]:
            penalties.append((coef, v, "hard_rule" if rule.hard else "soft_rule", rule.id))

    # ---- built-in soft objectives --------------------------------------------------
    total_weighted = sum(round(s.weight * LOAD_SCALE) * sum(n for r, n in s.composition.items() if r in MAIN_ROLES) for s in sessions)
    loads: dict[str, cp_model.IntVar] = {}
    cat_top: dict[str, float] = {}
    for s in sessions:
        if s.weight > 0:
            cat_top[s.category] = max(cat_top.get(s.category, 0), s.weight)
    em_loads, cm_loads = {}, {}
    for person in people:
        terms = [(round(s.weight * LOAD_SCALE), served(person.id, s.id)) for s in sessions if (person.id, s.id) in y]
        if not terms:
            continue
        load = m.NewIntVar(0, total_weighted, f"load_{person.id[:6]}")
        m.Add(load == sum(w * e for w, e in terms))
        loads[person.id] = load
        factor = min(1.0, max(0.1, reduced.get(person.id, 1.0)))
        fair_coef = round(fairness_weight * 10 / factor)
        if fair_coef > 0:  # weight 0 switches balancing off
            # Balanced per category (services vs P&P), so P&Ps can't make up for missing Sundays.
            # Within a category the heaviest session counts 10, so both categories pull equally hard.
            for cat, top in cat_top.items():
                cat_terms = [(round(s.weight / top * LOAD_SCALE), served(person.id, s.id))
                             for s in sessions if s.category == cat and (person.id, s.id) in y]
                if not cat_terms:
                    continue
                bound = sum(w for w, _ in cat_terms)
                cl = m.NewIntVar(0, bound, f"cl_{cat}_{person.id[:6]}")
                m.Add(cl == sum(w * e for w, e in cat_terms))
                sq = m.NewIntVar(0, bound * bound, f"sq_{cat}_{person.id[:6]}")
                m.AddMultiplicationEquality(sq, [cl, cl])
                penalties.append((fair_coef, sq, "fairness", person.id))

        em_terms = [(round(s.weight * LOAD_SCALE), served(person.id, s.id)) for s in sessions if s.ministry == "em" and (person.id, s.id) in y]
        cm_terms = [(round(s.weight * LOAD_SCALE), served(person.id, s.id)) for s in sessions if s.ministry == "cm" and (person.id, s.id) in y]
        em_l = sum(w * e for w, e in em_terms) if em_terms else 0
        cm_l = sum(w * e for w, e in cm_terms) if cm_terms else 0
        em_loads[person.id], cm_loads[person.id] = em_l, cm_l
        if person.em_percent is not None and 0 < person.em_percent < 100:
            target = person.em_percent
            dev = m.NewIntVar(0, 100 * total_weighted, f"split_{person.id[:6]}")
            # |100 * EM - target% * (EM + CM)|
            at_least(dev, 100 * em_l - target * (em_l + cm_l))
            at_least(dev, target * (em_l + cm_l) - 100 * em_l)
            # a whole session (10 units) on the wrong side costs about SPLIT_WEIGHT x a weight-1 rule miss
            penalties.append((max(1, round(SPLIT_WEIGHT * RULE_UNIT / (100 * LOAD_SCALE))), dev, "split", person.id))

    use_variety = bool(variety_rule and variety_rule.weight > 0)
    if fixed is not None and use_variety:
        penalties += add_variety()  # scoring a given roster: just count the repeats
    main_obj = sum(c * e for c, e, _, _ in penalties)
    m.Minimize(main_obj)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_workers = 8
    solver.parameters.relative_gap_limit = 0.02  # within 2% of the best possible is good enough
    status = solver.Solve(m)
    wall = solver.WallTime()

    if fixed is None and use_variety and status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Second pass: stay within a small tolerance of that score (the variety weight sets how
        # much: weight 0.5 -> 2.5%), start from the first answer, and mix the teams up.
        best = int(solver.ObjectiveValue())
        tolerance = 0.05 * variety_rule.weight
        for v in list(x.values()) + list(a.values()):
            m.AddHint(v, solver.Value(v))
        m.Add(main_obj <= best + max(1, int(best * tolerance)))
        var_pen = add_variety()
        m.Minimize(sum(c * e for c, e, _, _ in var_pen))
        solver2 = cp_model.CpSolver()
        solver2.parameters.max_time_in_seconds = VARIETY_SECONDS
        solver2.parameters.num_workers = 8
        status2 = solver2.Solve(m)
        wall += solver2.WallTime()
        if status2 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            solver, penalties = solver2, penalties + var_pen
            # (the first pass's optimal / feasible status still describes the main score)

    def actual(v) -> int:
        """The var's tight value given the solution: its largest lower bound (at least 0)."""
        if isinstance(v, int):
            return v
        bounds = lower.get(v.Index())
        if not bounds:
            return solver.Value(v)
        return max(0, *(b if isinstance(b, int) else solver.Value(b) for b in bounds))

    def where_now(w: dict) -> dict:
        """A miss's place on the roster; for a band, the people actually singing in it (or its BL/TB)."""
        if "bl_at" in w:
            sid = w["bl_at"]
            holder = sorted({pid for (pid, s_, t), av in a.items() if s_ == sid and solver.Value(av)})
            return {"members": holder, "dates": w["dates"]}
        if "singers_at" not in w:
            return w
        sid = w["singers_at"]
        singers = sorted({pid for (pid, s_, r), xv in x.items() if s_ == sid and r in SINGING and solver.Value(xv)})
        return {"members": singers, "dates": w["dates"]}

    res = Result(status="no_solution")
    res.solve_seconds = round(wall, 2)
    res.weights = {
        "fairness": fairness_weight,
        "em_cm_split": SPLIT_WEIGHT,
        "rules": {r.id: {"hard": r.hard, "weight": r.weight} for r in rules + builtin},
        "sessions": {s.id: s.weight for s in sessions},
    }
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return res

    # ---- read the solution ----------------------------------------------------------
    names = {p.id: p.name for p in people}
    for s in sessions:
        rows = []
        for (pid, sid, r), v in x.items():
            if sid == s.id and solver.Value(v):
                also = [t for t in ATTACHED_ROLES if (pid, sid, t) in a and solver.Value(a[pid, sid, t])]
                rows.append({"member": pid, "name": names[pid], "role": r, "also": also})
        order = {r: i for i, r in enumerate(MAIN_ROLES)}
        res.assignments[s.id] = sorted(rows, key=lambda row: (order[row["role"]], row["name"]))

    for s, role, short in unfilled_vars:
        k = solver.Value(short)
        if k:
            res.unfilled.append({"session": s.id, "date": s.date, "name": s.name, "role": role, "missing": k})

    for rule in rules:
        total = sum(actual(v) for v in rule_viols[rule.id])
        entry = {
            "rule": rule.id,
            "violations": total,
            "checks": len(rule_viols[rule.id]),
            # where each miss happened (people and dates), for highlighting on the roster
            "where": [where_now(w) for v, w in zip(rule_viols[rule.id], rule_where[rule.id]) if actual(v)],
        }
        if rule.hard:
            if total:
                res.hard_broken.append(entry)
        else:
            entry["penalty"] = total * max(1, round(rule.weight * RULE_UNIT))
            res.soft.append(entry)

    for person in people:
        if person.id not in loads:
            continue
        load = solver.Value(loads[person.id]) / LOAD_SCALE
        em_l = solver.Value(em_loads[person.id]) / LOAD_SCALE if not isinstance(em_loads[person.id], int) else 0
        cm_l = solver.Value(cm_loads[person.id]) / LOAD_SCALE if not isinstance(cm_loads[person.id], int) else 0
        mine = [s for s in sessions if (person.id, s.id) in y and solver.Value(y[person.id, s.id])]
        count = len(mine)
        res.loads.append({
            "member": person.id,
            "name": person.name,
            "services": count,
            "main": sum(1 for s in mine if s.category == "service"),
            "pnp": sum(1 for s in mine if s.category == "pnp"),
            "weighted": round(load, 1),
            "em": round(em_l, 1),
            "cm": round(cm_l, 1),
            "factor": reduced.get(person.id, 1.0),
            "em_target": person.em_percent,
            "em_actual": round(100 * em_l / (em_l + cm_l)) if em_l + cm_l else None,
        })
    res.loads.sort(key=lambda r: (-r["weighted"], r["name"]))

    # How spread out people are: pairs of one person's consecutive services within 1 / 2 / 3 weeks.
    gaps = []
    for person in people:
        mine = sorted({sv.date for sv in sessions if (person.id, sv.id) in y and solver.Value(y[person.id, sv.id])})
        gaps += [(d(b2) - d(a2)).days for a2, b2 in zip(mine, mine[1:])]
    # How mixed the teams are: distinct pairs who served together, and the most times one pair did.
    pair_counts: dict[tuple[str, str], int] = defaultdict(int)
    for s_ in sessions:
        here = sorted(pid for (pid, sid) in y if sid == s_.id and solver.Value(y[pid, sid]))
        for i, p1 in enumerate(here):
            for p2 in here[i + 1:]:
                pair_counts[p1, p2] += 1
    res.variety = {
        "pairs": len(pair_counts),
        "repeats": sum(c - 1 for c in pair_counts.values()),
        "max_together": max(pair_counts.values(), default=0),
    }
    res.spacing = {
        "within_1_week": sum(1 for g in gaps if g <= 7),
        "within_2_weeks": sum(1 for g in gaps if g <= 14),
        "within_3_weeks": sum(1 for g in gaps if g <= 21),
    }

    by_kind: dict[str, int] = defaultdict(int)
    for c, e, kind, _ in penalties:
        by_kind[kind] += c * actual(e)
    res.objective = {"total": int(sum(by_kind.values())), **by_kind}
    res.status = "impossible" if (res.unfilled or res.hard_broken) else ("optimal" if status == cp_model.OPTIMAL else "feasible")
    return res
