"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { deleteRule, saveRule, setRuleDefault, setRuleEnabled, setRuleWeight, setServeLess } from "@/app/(app)/roster/actions";
import {
  OPS,
  OP_WORDS,
  ROLES,
  ROLE_GROUP,
  checkDateRuleAgainst,
  checkRule,
  dateRuleSessionName,
  formatDate,
  frequencyExemptions,
  overriddenGroupRules,
  ruleSentence,
  type Advice,
  type Composition,
  type Ministry,
  type Op,
  type People,
  type Role,
  type Rule,
  type RuleParams,
  type SessionKind,
  type Subject,
} from "@/lib/roster";

const input =
  "rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

const TEMPLATES: { value: RuleParams["template"]; label: string; example: string }[] = [
  { value: "frequency", label: "How often someone serves", example: "Worship leaders should serve at most twice a month" },
  { value: "pair", label: "Two people on the same date", example: "Hazel and Iwan should not serve on the same date" },
  { value: "break", label: "Break between services", example: "The CM team should have at least 2 weeks between services" },
  { value: "date", label: "Serve at a session", example: "Maxine must serve at the CM Sunday Service on 25 Dec" },
];

/** The roster's sessions, as the rule editor needs them. */
type RuleSession = { date: string; kind: SessionKind; name: string; ministry: Ministry; cancelled: boolean; composition: Composition };

const sessionValue = (s: { date: string; kind?: string; name?: string }) => `${s.date}|${s.kind ?? ""}|${s.kind === "custom" ? (s.name ?? "") : ""}`;

/**
 * Pick one of the roster's sessions. The person's own ministry comes first: CM-only people see CM
 * sessions first, EM-only people EM first, and people in both whichever they serve more of.
 */
function SessionPicker({
  value,
  onChange,
  sessions,
  person,
}: {
  value: Extract<RuleParams, { template: "date" }>;
  onChange: (patch: { date: string; sessionKind?: SessionKind; sessionName?: string }) => void;
  sessions: RuleSession[];
  person: People[number] | undefined;
}) {
  const em = person?.emPercent;
  const emFirst = em == null || em >= 50; // EM-only (100), or more EM than CM; CM-only is 0
  const live = sessions.filter((s) => !s.cancelled).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const groups = [
    { label: "EM sessions", list: live.filter((s) => s.ministry === "em") },
    { label: "CM sessions", list: live.filter((s) => s.ministry === "cm") },
  ];
  if (!emFirst) groups.reverse();
  groups.push({ label: "Other events", list: live.filter((s) => s.ministry === "any") });
  const current = sessionValue({ date: value.date, kind: value.sessionKind, name: value.sessionName });
  const known = live.some((s) => sessionValue(s) === current);
  const day = (d: string) => formatDate(d, { weekday: "short", day: "numeric", month: "short" });

  return (
    <select
      aria-label="Session"
      className={`${input} max-w-full`}
      value={value.date ? current : ""}
      onChange={(e) => {
        const s = live.find((x) => sessionValue(x) === e.target.value);
        if (s) onChange({ date: s.date, sessionKind: s.kind, sessionName: s.kind === "custom" ? s.name : undefined });
      }}
    >
      <option value="" disabled>
        Choose a session…
      </option>
      {/* A rule from before sessions could be picked, or for a session not in this roster. */}
      {value.date && !known && (
        <option value={current} disabled>
          {value.sessionKind ? `${dateRuleSessionName(value)}, ${day(value.date)} (not in this roster)` : `Any session on ${day(value.date)}`}
        </option>
      )}
      {groups
        .filter((g) => g.list.length)
        .map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.list.map((s) => (
              <option key={sessionValue(s)} value={sessionValue(s)}>
                {day(s.date)} · {s.name}
              </option>
            ))}
          </optgroup>
        ))}
    </select>
  );
}

function blank(template: RuleParams["template"], people: People): RuleParams {
  switch (template) {
    case "frequency":
      return { template, subject: { kind: "everyone" }, polarity: "should", op: "<=", count: 2, period: "month" };
    case "pair":
      return { template, a: people[0]?.id ?? "", b: people[1]?.id ?? "", polarity: "should_not" };
    case "break":
      return { template, subject: { kind: "everyone" }, except: [], op: ">=", weeks: 2 };
    case "date":
      return { template, member: people[0]?.id ?? "", polarity: "must", date: "" };
    case "variety": // permanent rules; never built here
    case "singer_balance":
    case "bl_backup":
    case "spacing":
    case "fairness":
      return { template };
  }
}

function SubjectPicker({ value, onChange, people }: { value: Subject; onChange: (s: Subject) => void; people: People }) {
  const kind = value.kind === "ministry" ? `ministry:${value.value}` : value.kind;
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <select
        aria-label="Who"
        className={input}
        value={kind}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "everyone") onChange({ kind: "everyone" });
          else if (v.startsWith("ministry:")) onChange({ kind: "ministry", value: v.split(":")[1] as "em" | "cm" });
          else if (v === "role") onChange({ kind: "role", value: "worship leader" });
          else onChange({ kind: "member", value: people[0]?.id ?? "" });
        }}
      >
        <option value="everyone">Everyone</option>
        <option value="ministry:em">The EM team</option>
        <option value="ministry:cm">The CM team</option>
        <option value="role">Everyone who plays…</option>
        <option value="member">A person…</option>
      </select>
      {value.kind === "role" && (
        <select aria-label="Role" className={input} value={value.value} onChange={(e) => onChange({ kind: "role", value: e.target.value as Role })}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {ROLE_GROUP[r.value]}
            </option>
          ))}
        </select>
      )}
      {value.kind === "member" && <PersonPicker value={value.value} onChange={(id) => onChange({ kind: "member", value: id })} people={people} />}
    </span>
  );
}

function PersonPicker({ value, onChange, people, label = "Person" }: { value: string; onChange: (id: string) => void; people: People; label?: string }) {
  return (
    <select aria-label={label} className={input} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        Choose…
      </option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function OpPicker({ value, onChange }: { value: Op; onChange: (o: Op) => void }) {
  return (
    <select aria-label="Comparison" className={input} value={value} onChange={(e) => onChange(e.target.value as Op)}>
      {OPS.map((o) => (
        <option key={o} value={o}>
          {o} ({OP_WORDS[o]})
        </option>
      ))}
    </select>
  );
}

function AdviceList({ advice }: { advice: Advice[] }) {
  if (!advice.length) return null;
  return (
    <ul className="space-y-1.5">
      {advice.map((a, i) => (
        <li
          key={i}
          className={`rounded-lg border px-3 py-2 text-sm ${a.level === "error" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}
        >
          {a.message}
        </li>
      ))}
    </ul>
  );
}

type Editing = { id: string | null; hard: boolean; weight: number; enabled: boolean; isDefault: boolean; params: RuleParams };

function RuleBuilder({
  rosterId,
  editing,
  rules,
  people,
  sessions,
  isLead,
  onDone,
}: {
  rosterId: string;
  editing: Editing;
  rules: Rule[];
  people: People;
  sessions: RuleSession[];
  isLead: boolean;
  onDone: () => void;
}) {
  const [r, setR] = useState<Editing>(editing);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Advice[] | null>(null);
  const [pending, start] = useTransition();
  const p = r.params;
  const setP = (patch: Partial<RuleParams>) => setR((x) => ({ ...x, params: { ...x.params, ...patch } as RuleParams }));

  const advice = useMemo(() => {
    const a = checkRule(r.params, people, r.hard);
    if (r.params.template === "date" && /^\d{4}-\d{2}-\d{2}$/.test(r.params.date)) {
      a.push(...checkDateRuleAgainst(r.params, sessions, people));
    }
    return a;
  }, [r, people, sessions]);
  const errors = advice.filter((a) => a.level === "error");
  const warnings = advice.filter((a) => a.level === "warning");

  function doSave() {
    setConfirming(null);
    setError(null);
    start(async () => {
      const res = await saveRule(r.id, { hard: r.hard, weight: r.weight, enabled: r.enabled, params: r.params, rosterId, isDefault: r.isDefault });
      if (res.ok) onDone();
      else setError(res.message);
    });
  }

  function trySave() {
    if (errors.length) return setConfirming(errors); // shown as a "doesn't make sense" popup
    if (warnings.length) return setConfirming(warnings);
    doSave();
  }

  return (
    <div className="space-y-5">
      <label className="block space-y-1 text-sm font-medium">
        Rule type
        <select
          className={`${input} w-full`}
          value={p.template}
          onChange={(e) => setR((x) => ({ ...x, params: blank(e.target.value as RuleParams["template"], people) }))}
        >
          {TEMPLATES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}, e.g. “{t.example}”
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-background p-3 text-sm">
        {p.template === "frequency" && (
          <>
            <SubjectPicker value={p.subject} onChange={(subject) => setP({ subject })} people={people} />
            <select aria-label="Should or should not" className={input} value={p.polarity} onChange={(e) => setP({ polarity: e.target.value as "should" | "should_not" })}>
              <option value="should">should</option>
              <option value="should_not">should not</option>
            </select>
            <span>serve</span>
            <OpPicker value={p.op} onChange={(op) => setP({ op })} />
            <input aria-label="Number of times" type="number" min={0} max={20} value={p.count} onChange={(e) => setP({ count: Number(e.target.value) })} className={`${input} w-16`} />
            <span>times per</span>
            <select aria-label="Period" className={input} value={p.period} onChange={(e) => setP({ period: e.target.value as "month" | "quarter" })}>
              <option value="month">month</option>
              <option value="quarter">quarter</option>
            </select>
          </>
        )}
        {p.template === "pair" && (
          <>
            <PersonPicker label="First person" value={p.a} onChange={(a) => setP({ a })} people={people} />
            <span>and</span>
            <PersonPicker label="Second person" value={p.b} onChange={(b) => setP({ b })} people={people} />
            <select aria-label="Should or should not" className={input} value={p.polarity} onChange={(e) => setP({ polarity: e.target.value as "should" | "should_not" })}>
              <option value="should">should</option>
              <option value="should_not">should not</option>
            </select>
            <span>serve on the same date</span>
          </>
        )}
        {p.template === "break" && (
          <>
            <SubjectPicker value={p.subject} onChange={(subject) => setP({ subject })} people={people} />
            <span>should have</span>
            <OpPicker value={p.op} onChange={(op) => setP({ op })} />
            <input aria-label="Weeks" type="number" min={0} max={13} value={p.weeks} onChange={(e) => setP({ weeks: Number(e.target.value) })} className={`${input} w-16`} />
            <span>weeks break between services</span>
            {p.subject.kind !== "member" && (
              <span className="flex w-full flex-wrap items-center gap-1.5 pt-1">
                <span className="text-muted">except</span>
                {p.except.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs">
                    {people.find((x) => x.id === id)?.name}
                    <button type="button" aria-label="Remove exception" onClick={() => setP({ except: p.except.filter((x) => x !== id) })} className="text-muted hover:text-danger">
                      ×
                    </button>
                  </span>
                ))}
                <select
                  aria-label="Add an exception"
                  className={input}
                  value=""
                  onChange={(e) => e.target.value && setP({ except: [...new Set([...p.except, e.target.value])] })}
                >
                  <option value="">{p.except.length ? "+ another" : "no one (add…)"}</option>
                  {people.filter((x) => !p.except.includes(x.id)).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </span>
            )}
          </>
        )}
        {p.template === "date" && (
          <>
            <PersonPicker value={p.member} onChange={(member) => setP({ member })} people={people} />
            <select aria-label="Must or must not" className={input} value={p.polarity} onChange={(e) => setP({ polarity: e.target.value as "must" | "must_not" })}>
              <option value="must">must</option>
              <option value="must_not">must not</option>
            </select>
            <span>serve at</span>
            <SessionPicker value={p} onChange={(patch) => setP(patch)} sessions={sessions} person={people.find((x) => x.id === p.member)} />
          </>
        )}
      </div>

      <p className="text-sm">
        <span className="text-muted">Reads as: </span>
        <span className="font-medium">{ruleSentence(p, people, frequencyExemptions(r, rules, people))}</span>
      </p>
      {(() => {
        const overridden = overriddenGroupRules(r, rules, people);
        if (!overridden.length) return null;
        return (
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            This takes precedence over {overridden.length === 1 ? "the rule" : "these rules"} for this person:{" "}
            {overridden.map((o) => `“${ruleSentence(o.params, people)}”`).join(", ")} They&apos;ll show “except{" "}
            {people.find((x) => p.template === "frequency" && p.subject.kind === "member" && x.id === p.subject.value)?.name}”.
          </p>
        );
      })()}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Hard or soft?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { hard: true, title: "Hard rule", body: "Must hold. If no roster can meet it, you'll be warned that the roster is impossible." },
            { hard: false, title: "Soft rule", body: "The generator tries to meet it, weighed against other soft rules." },
          ].map((o) => (
            <label key={o.title} className="cursor-pointer rounded-lg border border-border p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/5">
              <input type="radio" name="hardness" checked={r.hard === o.hard} onChange={() => setR((x) => ({ ...x, hard: o.hard }))} className="sr-only" />
              <span className="block font-medium">{o.title}</span>
              <span className="text-muted">{o.body}</span>
            </label>
          ))}
        </div>
        {!r.hard && (
          <label className="block space-y-1 pt-1 text-sm">
            <span className="font-medium">Weight: {r.weight.toFixed(2)}</span>{" "}
            <span className="text-muted">{isLead ? "(0 = barely matters, 1 = matters most)" : "(set by the lead)"}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={r.weight}
              disabled={!isLead}
              onChange={(e) => setR((x) => ({ ...x, weight: Number(e.target.value) }))}
              className="range-thin w-full disabled:opacity-50"
            />
          </label>
        )}
      </fieldset>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/5">
        <input
          type="checkbox"
          checked={r.isDefault}
          onChange={(e) => setR((x) => ({ ...x, isDefault: e.target.checked }))}
          className="mt-0.5 accent-accent"
        />
        <span>
          <span className="block font-medium">Default rule</span>
          <span className="text-muted">
            {r.isDefault
              ? "Used by every roster, including new ones. Changes here apply to all draft rosters."
              : "Only for this roster. Tick to keep it for every roster you create."}
          </span>
        </span>
      </label>

      {advice.length > 0 && <AdviceList advice={advice} />}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button type="button" disabled={pending} onClick={trySave} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-60">
          {pending ? "Saving…" : r.id ? "Save rule" : "Add rule"}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-muted">
          Cancel
        </button>
      </div>

      {confirming && (
        <div role="alertdialog" aria-labelledby="advice-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-surface p-6 shadow-2xl">
            <h3 id="advice-title" className="text-lg font-semibold">
              {confirming[0].level === "error" ? "This rule doesn't make sense" : "Are you sure about this rule?"}
            </h3>
            <AdviceList advice={confirming} />
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setConfirming(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium">
                Change the rule
              </button>
              {confirming[0].level !== "error" && (
                <button type="button" onClick={doSave} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground">
                  Save anyway
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One person who serves less: an orange chip; click the number to change it. */
function ServeLessChip({
  name,
  factor,
  pending,
  editable,
  onSave,
}: {
  name: string;
  factor: number;
  pending: boolean;
  editable: boolean;
  onSave: (f: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!editable) {
    return (
      <li className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-orange-900" title="Serves less">
        <span className="font-medium">{name}</span>
        <span className="tabular-nums text-orange-700">×{factor}</span>
      </li>
    );
  }
  return (
    <li className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 py-0.5 pl-2.5 pr-1 text-orange-900">
      <span className="font-medium">{name}</span>
      {editing ? (
        <input
          type="number"
          min={0.1}
          max={0.9}
          step={0.1}
          defaultValue={factor}
          autoFocus
          aria-label={`Share for ${name}`}
          onBlur={(e) => {
            setEditing(false);
            const v = Number(e.target.value);
            if (v && v !== factor) onSave(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-5 w-12 rounded border border-orange-300 bg-white px-1 text-xs outline-none focus:ring-2 focus:ring-orange-300"
        />
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => setEditing(true)}
          title="Change their share"
          className="rounded px-1 tabular-nums text-orange-700 hover:bg-orange-100"
        >
          ×{factor}
        </button>
      )}
      <button type="button" aria-label={`${name} back to normal`} disabled={pending} onClick={() => onSave(null)} className="rounded-full px-1 text-orange-400 hover:text-danger">
        ×
      </button>
    </li>
  );
}

/** Root: members who should serve less under "Share the load fairly" (factor below 1). */
function ServeLess({ reduced, people, editable }: { reduced: Record<string, number>; people: People; editable: boolean }) {
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = (id: string, f: number | null) =>
    start(async () => {
      setError(null);
      const r = await setServeLess(id, f);
      if (!r.ok) setError(r.message);
    });
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "Former member";
  const entries = Object.entries(reduced).sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b)));
  return (
    <div className="space-y-1.5 text-xs">
      <p className="text-muted">
        <span className="font-medium text-foreground">Serve less</span> · everyone counts as 1; a lower share means serving less often
        (0.5 ≈ half).
      </p>
      <ul className="flex flex-wrap items-center gap-1.5">
        {entries.map(([id, f]) => (
          <ServeLessChip key={`${id}-${f}`} name={nameOf(id)} factor={f} pending={pending} editable={editable} onSave={(v) => save(id, v)} />
        ))}
        {editable && (
        <li>
          {adding ? (
            <select
              autoFocus
              aria-label="Add someone who should serve less"
              className="h-6 rounded-full border border-orange-200 bg-surface px-2 text-xs outline-none focus:ring-2 focus:ring-orange-300"
              value=""
              onBlur={() => setAdding(false)}
              onChange={(e) => {
                setAdding(false);
                if (e.target.value) save(e.target.value, 0.5);
              }}
            >
              <option value="">Choose…</option>
              {people
                .filter((p) => !(p.id in reduced))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          ) : (
            <button
              type="button"
              aria-label="Add someone who should serve less"
              disabled={pending}
              onClick={() => setAdding(true)}
              className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-orange-300 text-sm text-orange-700 hover:bg-orange-50"
            >
              +
            </button>
          )}
        </li>
        )}
      </ul>
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}

function RuleRow({
  rosterId,
  rule,
  rules,
  people,
  isLead,
  onEdit,
}: {
  rosterId: string;
  rule: Rule;
  rules: Rule[];
  people: People;
  isLead: boolean;
  onEdit: () => void;
}) {
  const [weight, setWeight] = useState(rule.weight);
  const [pending, start] = useTransition();
  return (
    <li className={`space-y-2 px-4 py-3 ${rule.enabled ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <p className="min-w-0 flex-1 text-sm font-medium">{ruleSentence(rule.params, people, frequencyExemptions(rule, rules, people))}</p>
        {rule.permanent ? (
          <span
            className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-muted"
            title="Always applied. It can't be edited, switched off or deleted, but the lead can change its weight."
          >
            Permanent
          </span>
        ) : (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => start(async () => void (await setRuleDefault(rule.id, rosterId, rule.rosterId !== null)))}
              title={rule.rosterId === null ? "Used by every roster. Click to keep it to this roster only." : "Only this roster. Click to use it for every roster."}
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${rule.rosterId === null ? "bg-accent/10 text-accent" : "bg-stone-100 text-muted"} hover:ring-1 hover:ring-accent/40`}
            >
              {rule.rosterId === null ? "Default" : "This roster only"}
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={rule.enabled}
              aria-label={rule.enabled ? "Rule on: click to switch it off" : "Rule off: click to switch it on"}
              disabled={pending}
              onClick={() => start(async () => void (await setRuleEnabled(rule.id, !rule.enabled)))}
              className={`rounded-full border px-2 py-0.5 text-xs font-semibold transition disabled:opacity-50 ${
                rule.enabled
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                  : "border-border bg-background text-muted hover:bg-stone-100"
              }`}
            >
              {rule.enabled ? "On" : "Off"}
            </button>
            <button
              type="button"
              onClick={onEdit}
              aria-label="Edit rule"
              title="Edit"
              className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-accent/10 hover:text-accent"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Delete this rule?")) start(async () => void (await deleteRule(rule.id)));
              }}
              aria-label="Delete rule"
              title="Delete"
              className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-red-50 hover:text-danger disabled:opacity-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
              </svg>
            </button>
          </>
        )}
      </div>
      {rule.params.template === "fairness" && (isLead || Object.keys(rule.params.reduced ?? {}).length > 0) && (
        <ServeLess reduced={rule.params.reduced ?? {}} people={people} editable={isLead} />
      )}
      {!rule.hard && (
        <label className="flex items-center gap-3 text-xs text-muted">
          <span className="w-20 shrink-0">Weight {weight.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={weight}
            disabled={!isLead}
            aria-label="Rule weight"
            onChange={(e) => setWeight(Number(e.target.value))}
            onPointerUp={() => start(async () => void (await setRuleWeight(rule.id, weight)))}
            onKeyUp={() => start(async () => void (await setRuleWeight(rule.id, weight)))}
            className="range-thin flex-1 disabled:opacity-50"
          />
        </label>
      )}
    </li>
  );
}

export function RulesEditor({
  rosterId,
  rules,
  people,
  sessions,
  isLead,
  editable,
}: {
  rosterId: string;
  rules: Rule[];
  people: People;
  sessions: RuleSession[];
  isLead: boolean;
  editable: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // Open the dialog once its content has rendered.
  useEffect(() => {
    if (editing && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [editing]);
  // Permanent rules (fairness, spacing, variety, singer balance) get their own section.
  const permanent = rules.filter((r) => r.permanent);
  const hard = rules.filter((r) => r.hard && !r.permanent);
  const soft = rules.filter((r) => !r.hard && !r.permanent);

  function open(e: Editing) {
    setEditing(e);

  }
  function close() {
    dialogRef.current?.close();
    setEditing(null);
  }

  const section = (title: string, desc: string, list: Rule[]) => (
    // Collapsible; starts closed. Click the heading to show the rules.
    <details className="group overflow-hidden rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-3 bg-background px-4 py-2 hover:bg-background/70 group-open:border-b group-open:border-border [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {title} <span className="font-normal text-muted">({list.length})</span>
          </span>
          <span className="block text-xs text-muted">{desc}</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-180">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      {list.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">None yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((r) => (
            <RuleRow key={r.id} rosterId={rosterId} rule={r} rules={rules} people={people} isLead={isLead} onEdit={() => open({ ...r, isDefault: r.rosterId === null })} />
          ))}
        </ul>
      )}
    </details>
  );

  return (
    <section aria-labelledby="rules-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="rules-title" className="text-lg font-semibold">
            2. Rules
          </h2>
          <p className="text-sm text-muted">Default rules carry over to every roster; the rest are for this roster only.{isLead ? " Drag a soft rule's weight to change how much it matters." : " Only the lead can change soft-rule weights."}</p>
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => open({ id: null, hard: false, weight: 0.5, enabled: true, isDefault: false, params: blank("frequency", people) })}
            className="h-10 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:border-accent/50"
          >
            + Add rule
          </button>
        )}
      </div>
      {section("Hard rules", "Must hold, or the roster is impossible.", hard)}
      {section("Soft rules", "Followed as closely as possible, by weight.", soft)}
      {section("Permanent rules", "Built-in soft rules, always applied. Only their weight can change.", permanent)}

      <dialog
        ref={dialogRef}
        onClose={() => setEditing(null)}
        aria-labelledby="rule-dialog-title"
        className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
      >
        <div className="max-h-[88vh] space-y-4 overflow-y-auto p-6">
          <h2 id="rule-dialog-title" className="font-display text-2xl font-semibold">
            {editing?.id ? "Edit rule" : "Add a rule"}
          </h2>
          {editing && <RuleBuilder key={editing.id ?? "new"} rosterId={rosterId} editing={editing} rules={rules} people={people} sessions={sessions} isLead={isLead} onDone={close} />}
        </div>
      </dialog>
    </section>
  );
}
