"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { setDevView, setViewAs } from "@/app/actions/dev";
import { GROUP_LABEL, TEAM_GROUPS, type TeamGroup, type TeamKind } from "@/lib/team-config";

const PERSON = "person:";
const OBSERVER = "observer";

export type ViewTeam = { slug: string; name: string; group: TeamGroup; kind: TeamKind };

export type ObserverPerms = { managesPermissions: boolean; seesAbsences: boolean };

/** What the menu will switch to when Apply is pressed. */
type Draft = {
  group: TeamGroup;
  /** The team's slug: one of the group's teams. */
  team: string;
  observer: boolean;
  /** The observer's permissions shown in the menu. */
  perms: ObserverPerms;
  /** Changed from the group's real observer (sent with the view); otherwise the real ones are used. */
  permsPicked: boolean;
  /** "<team>|<person id>" when acting as a person, else "". */
  person: string;
};

const PERM_TOGGLES: { key: keyof ObserverPerms; text: string }[] = [
  { key: "managesPermissions", text: "Manage permissions" },
  { key: "seesAbsences", text: "See absences" },
];

const NO_PERMS: ObserverPerms = { managesPermissions: false, seesAbsences: false };

/**
 * Account menu section for developers: pick a group (Main/Youth), then one of its teams (a
 * dropdown, so new teams appear on their own), and see it with a standard account (your own full access) or as that group's
 * observer, in any combination; an observer view can also switch the observer's own permissions
 * (managing permissions, seeing absences) for the view, starting from the group's real observer.
 * Or act as one person. Choices are a draft: nothing loads until Apply is pressed.
 * viewAs is the current choice ("observer", "observer:<m><a>", "person:<id>" or null). People are
 * listed under every team they're on; picking someone on another team switches to that team first,
 * so you see them as they are there.
 */
export function ViewAsMenu({
  viewAs,
  people,
  team,
  teams,
  observerPerms,
  realObserverPerms,
  onPicked,
}: {
  viewAs: string | null;
  people: { id: string; name: string; team: string; teamName: string }[];
  /** The team being worked in now. */
  team: { slug: string; group: TeamGroup; kind: TeamKind };
  /** Every team: the Team dropdown lists the chosen group's. */
  teams: ViewTeam[];
  /** While viewing as an observer: the permissions it has in this view. */
  observerPerms?: ObserverPerms;
  /** Each group's real observer account settings (what an observer view starts from). */
  realObserverPerms: Record<TeamGroup, ObserverPerms>;
  onPicked?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const personId = viewAs?.startsWith(PERSON) ? viewAs.slice(PERSON.length) : "";
  const observer = viewAs === OBSERVER || Boolean(viewAs?.startsWith(`${OBSERVER}:`));
  const current: Draft = {
    group: team.group,
    team: team.slug,
    observer,
    perms: (observer && observerPerms) || realObserverPerms[team.group] || NO_PERMS,
    permsPicked: Boolean(viewAs?.startsWith(`${OBSERVER}:`)),
    person: personId ? `${team.slug}|${personId}` : "",
  };
  const [draft, setDraft] = useState<Draft>(current);
  const changed = JSON.stringify(draft) !== JSON.stringify(current);

  // Group, team or account: no longer acting as a person. A new group starts from its real observer.
  const change = (c: Partial<Draft>) =>
    setDraft((d) => {
      const next = { ...d, ...c, person: "" };
      if (c.group && c.group !== d.group) {
        // The new group's team of the same kind (e.g. Youth Worship for Main Worship), else its first.
        const kind = teams.find((t) => t.slug === d.team)?.kind;
        const inGroup = teams.filter((t) => t.group === c.group);
        next.team = (inGroup.find((t) => t.kind === kind) ?? inGroup[0])?.slug ?? d.team;
        next.perms = realObserverPerms[c.group] ?? NO_PERMS;
        next.permsPicked = false;
      }
      return next;
    });

  const apply = () =>
    start(async () => {
      setError(null);
      if (draft.person) {
        const [inTeam, id] = draft.person.split("|");
        const r = await setViewAs(PERSON + id, inTeam);
        if (!r.ok) return setError(r.message);
        onPicked?.();
        return;
      }
      const r = await setDevView(
        {
          team: draft.team,
          observer: draft.observer,
          observerPerms: draft.observer && draft.permsPicked ? draft.perms : undefined,
        },
        pathname,
      );
      if (!r.ok) return setError(r.message);
      onPicked?.(); // close the account menu so the page (and banner) are visible
      if (r.next && r.next !== pathname) router.push(r.next);
      else router.refresh();
    });

  const personTeams = [...new Map(people.map((p) => [p.team, p.teamName]))];
  const groups = TEAM_GROUPS.filter((g) => teams.some((t) => t.group === g));
  const asPerson = Boolean(draft.person);
  const toggles = (label: string, options: { text: string; on: boolean; change: Partial<Draft> }[]) => (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex min-w-0 flex-1 rounded-md border border-border p-0.5">
        {options.map((o) => (
          <button
            key={o.text}
            type="button"
            role="radio"
            aria-checked={o.on}
            disabled={pending}
            onClick={() => change(o.change)}
            className={`min-w-0 flex-1 rounded px-1 py-1 text-xs disabled:opacity-60 ${o.on ? "bg-accent/15 font-medium text-accent" : "hover:bg-background"}`}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="border-b border-border px-2 py-2" role="group" aria-label="View or act as">
      <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">View as</p>
      <div className="space-y-1.5 px-2">
        {toggles(
          "Group",
          groups.map((g) => ({ text: GROUP_LABEL[g], on: !asPerson && draft.group === g, change: { group: g } })),
        )}
        {/* A dropdown, so a group's new teams appear here on their own. */}
        <label className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-muted">Team</span>
          <select
            value={asPerson ? "" : draft.team}
            disabled={pending}
            onChange={(e) => change({ team: e.target.value })}
            aria-label="Team"
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 text-xs outline-none focus:border-accent"
          >
            {asPerson && <option value="">—</option>}
            {teams
              .filter((t) => t.group === draft.group)
              .map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        {toggles("Account", [
          { text: "Standard", on: !asPerson && !draft.observer, change: { observer: false } },
          { text: "Observer", on: !asPerson && draft.observer, change: { observer: true } },
        ])}
        {/* An observer view: what this observer may do, on top of looking (for this view only). */}
        {!asPerson && draft.observer && (
          <div className="flex items-start gap-2">
            <span className="w-14 shrink-0 pt-1 text-xs text-muted">Can</span>
            <div role="group" aria-label="Observer permissions" className="flex flex-1 flex-col gap-1">
              {PERM_TOGGLES.map((t) => (
                <label key={t.key} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={draft.perms[t.key]}
                    disabled={pending}
                    onChange={(e) => setDraft((d) => ({ ...d, perms: { ...d.perms, [t.key]: e.target.checked }, permsPicked: true, person: "" }))}
                    className="size-3.5 accent-accent"
                  />
                  {t.text}
                </label>
              ))}
              <p className="text-[11px] text-muted">{draft.permsPicked ? "Changed for this view only." : `As the ${GROUP_LABEL[draft.group]} observer.`}</p>
            </div>
          </div>
        )}
      </div>
      {people.length > 0 && (
        <label className="mt-2 block px-2">
          <span className={`block pb-1 text-sm ${asPerson ? "font-medium text-accent" : ""}`}>{asPerson ? "● " : "○ "}A person (act as them)</span>
          <select
            value={draft.person}
            disabled={pending}
            onChange={(e) => setDraft((d) => ({ ...d, person: e.target.value }))}
            aria-label="Act as a person"
            className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-accent"
          >
            <option value="">Choose someone…</option>
            {personTeams.map(([slug, name]) => (
              <optgroup key={slug} label={name}>
                {people
                  .filter((p) => p.team === slug)
                  .map((p) => (
                    <option key={`${slug}|${p.id}`} value={`${slug}|${p.id}`}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      <div className="flex items-center justify-end gap-3 px-2 pt-2">
        {changed && !pending && (
          <button type="button" onClick={() => setDraft(current)} className="text-xs text-muted hover:text-foreground">
            Undo
          </button>
        )}
        <button
          type="button"
          onClick={apply}
          disabled={!changed || pending}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-foreground disabled:opacity-40"
        >
          {pending ? "Loading…" : "Apply"}
        </button>
      </div>
      {error && <p className="px-2 pt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

/**
 * The media app has no account menu: developers get View as from a button in its header instead
 * (the same choices, e.g. back to Main Worship with a standard account).
 */
export function ViewAsPopover(props: Omit<Parameters<typeof ViewAsMenu>[0], "onPicked"> & { label: string }) {
  const { label, ...menu } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="max-w-48 truncate rounded-full border border-violet-400 bg-violet-500/15 px-2.5 py-0.5 text-xs font-semibold text-violet-200"
      >
        {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-surface text-foreground shadow-lg">
          <ViewAsMenu {...menu} onPicked={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
