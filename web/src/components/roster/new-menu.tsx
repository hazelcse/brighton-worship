"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { adhocBandOptions, addAdhocSession, type AdhocPerson, type AdhocPick } from "@/app/(app)/roster/adhoc-actions";
import { ATTACHED_ROLES, ROLES, ROLE_LABEL, SINGING_ROLES, formatDate, todayYmd } from "@/lib/roster";
import { SessionDialog, newSessionDraft, type Draft } from "@/components/roster/session-planner";
import { NewBroadcastDialog } from "@/components/broadcasts";

/** Slots per part: role -> who's in each place (null = not picked; the generator fills it on a draft). */
type Picks = { slots: Record<string, (string | null)[]>; leaders: (string | null)[] };

const MAIN_ROLES = ROLES.filter((r) => !ATTACHED_ROLES.includes(r.value));

/** Why someone can't serve this session at all (same check as the generator), or null. */
function notEligible(p: AdhocPerson, ministry: string): string | null {
  if (p.serves === "pnp") return "only serves at P&Ps";
  const em = p.emPercent === null || p.emPercent > 0;
  const cm = p.emPercent === null || p.emPercent < 100;
  if (ministry === "em" && !em) return "CM only";
  if (ministry === "cm" && !cm) return "EM only";
  return null;
}

const select =
  "h-10 w-full min-w-0 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

/** Under the band: who's in it. One dropdown per place, least loaded first; anyone who can't make it greyed out. */
function BandPicker({ s, picks, setPicks }: { s: Draft; picks: Picks; setPicks: (f: (p: Picks) => Picks) => void }) {
  const [people, setPeople] = useState<AdhocPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    adhocBandOptions(s.date, s.rehearsal_date)
      .then((p) => live && (setPeople(p), setError(null)))
      .catch(() => live && setError("Couldn't load who's free that day."));
    return () => {
      live = false;
    };
  }, [s.date, s.rehearsal_date]);

  const roles = MAIN_ROLES.filter((r) => (s.composition[r.value] ?? 0) > 0);
  const leaderPlaces = s.composition["band leader"] ?? 0;
  if (!roles.length) return null;
  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  // Who's picked where (only places the band still has).
  const placed = new Map<string, string>();
  for (const r of roles) (picks.slots[r.value] ?? []).slice(0, s.composition[r.value]).forEach((id) => id && placed.set(id, r.value));

  const setSlot = (role: string, i: number, id: string | null) =>
    setPicks((p) => {
      const list = [...(p.slots[role] ?? [])];
      list[i] = id;
      // Someone moved out of an instrument can't stay BL/TB.
      const stillPlaying = (x: string) => Object.entries({ ...p.slots, [role]: list }).some(([r, ids]) => !SINGING_ROLES.includes(r) && ids.includes(x));
      return { slots: { ...p.slots, [role]: list }, leaders: p.leaders.map((l) => (l && stillPlaying(l) ? l : null)) };
    });

  const why = (p: AdhocPerson, role: string, current: string | null): string | null => {
    if (p.id === current) return null;
    const elsewhere = placed.get(p.id);
    if (elsewhere) return `picked for ${ROLE_LABEL[elsewhere].toLowerCase()}`;
    return notEligible(p, s.ministry) ?? p.unavailable;
  };
  const month = formatDate(s.date, { month: "long" });

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Who&apos;s in the band</legend>
      <p className="text-xs text-muted">
        The number is how much each person is serving in {month} (session weights added up), lowest first. Greyed out: can&apos;t serve that day.
        Places left empty stay empty on a published roster; on a draft, generating fills them.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}
      {!people && !error && <p className="text-sm text-muted">Checking who&apos;s free…</p>}
      {people && (
        <div className="grid gap-3 sm:grid-cols-2">
          {roles.map((r) => {
            const n = s.composition[r.value] ?? 0;
            const players = people.filter((p) => p.instruments.includes(r.value));
            return Array.from({ length: n }, (_, i) => {
              const current = picks.slots[r.value]?.[i] ?? null;
              const sorted = [...players].sort(
                (a, b) => Number(Boolean(why(a, r.value, current))) - Number(Boolean(why(b, r.value, current))) || a.load - b.load || a.name.localeCompare(b.name),
              );
              return (
                <label key={`${r.value}-${i}`} className="space-y-1 text-sm">
                  <span className="text-xs font-medium text-muted">
                    {r.label}
                    {n > 1 ? ` ${i + 1}` : ""}
                  </span>
                  <select value={current ?? ""} onChange={(e) => setSlot(r.value, i, e.target.value || null)} className={select}>
                    <option value="">{players.length ? "— Choose —" : "Nobody plays this"}</option>
                    {sorted.map((p) => {
                      const reason = why(p, r.value, current);
                      return (
                        <option key={p.id} value={p.id} disabled={Boolean(reason)}>
                          {p.name} · {p.load.toFixed(1)}
                          {reason ? ` · ${reason}` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
              );
            });
          })}
          {Array.from({ length: leaderPlaces }, (_, i) => {
            const current = picks.leaders[i] ?? null;
            // Picked instrument players who can do BL/TB.
            const able = [...placed]
              .filter(([id, role]) => !SINGING_ROLES.includes(role) && byId.get(id)?.instruments.includes("band leader"))
              .map(([id, role]) => ({ id, role, name: byId.get(id)!.name }));
            return (
              <label key={`bl-${i}`} className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted">BL/TB{leaderPlaces > 1 ? ` ${i + 1}` : ""}</span>
                <select
                  value={current ?? ""}
                  onChange={(e) => setPicks((p) => ({ ...p, leaders: Object.assign([...p.leaders], { [i]: e.target.value || null }) }))}
                  className={select}
                >
                  <option value="">{able.length ? "— Choose —" : "Pick an instrument player who does BL/TB first"}</option>
                  {able.map((a) => (
                    <option key={a.id} value={a.id} disabled={picks.leaders.some((l, j) => j !== i && l === a.id)}>
                      {a.name} ({ROLE_LABEL[a.role]})
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

/** Root: an ad-hoc session with its band, on whichever roster covers its date. */
function AdhocDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [picks, setPicks] = useState<Picks>({ slots: {}, leaders: [] });
  const [done, setDone] = useState<string | null>(null);
  const today = todayYmd();
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);

  const toSend = (s: { composition: Draft["composition"] }): AdhocPick[] => {
    const out: AdhocPick[] = [];
    for (const r of MAIN_ROLES) {
      const n = s.composition[r.value] ?? 0;
      for (const id of (picks.slots[r.value] ?? []).slice(0, n)) {
        if (id) out.push({ member: id, role: r.value, bandLeader: picks.leaders.slice(0, s.composition["band leader"] ?? 0).includes(id) });
      }
    }
    return out;
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="adhoc-title"
      className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
    >
      <div className="max-h-[88vh] space-y-4 overflow-y-auto p-6">
        <h2 id="adhoc-title" className="font-display text-2xl font-semibold">
          New ad-hoc session
        </h2>
        {done ? (
          <>
            <p className="text-sm">{done}</p>
            <button type="button" onClick={() => ref.current?.close()} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground">
              Done
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Joins the roster for its date. If that roster is published, the band is asked to serve straight away. If not, it goes into that
              quarter&apos;s draft and the roster is generated around this band.
            </p>
            <SessionDialog
              rosterId=""
              draft={newSessionDraft(today)}
              quarter={{ start: today, end: "" }}
              onClose={() => ref.current?.close()}
              submit={async (payload) => {
                const r = await addAdhocSession(payload, toSend(payload));
                if (r.ok) {
                  setDone(r.message);
                  // Keep the dialog open to show where it went; SessionDialog closes on ok, so report not-ok.
                  return { ok: false, message: null };
                }
                return r;
              }}
              extra={(s) => <BandPicker s={s} picks={picks} setPicks={setPicks} />}
            />
          </>
        )}
      </div>
    </dialog>
  );
}

/** The Roster page's + button: a new roster, or (root) an ad-hoc session or a broadcast. */
export function NewMenu({ isRoot }: { isRoot: boolean }) {
  const [open, setOpen] = useState(false);
  const [adhoc, setAdhoc] = useState(false);
  const [broadcast, setBroadcast] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="New"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-xl font-medium leading-none text-ink-foreground hover:bg-ink/90"
      >
        +
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-48 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg">
          <Link role="menuitem" href="/roster/new" className="block px-4 py-2.5 text-sm hover:bg-background">
            + New roster
          </Link>
          {isRoot && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setAdhoc(true);
              }}
              className="block w-full px-4 py-2.5 text-left text-sm hover:bg-background"
            >
              + New ad-hoc
            </button>
          )}
          {isRoot && (
            <>
              {/* Rosters above, messages below. */}
              <div role="separator" className="my-1 border-t border-border" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setBroadcast(true);
                }}
                className="block w-full px-4 py-2.5 text-left text-sm hover:bg-background"
              >
                + New broadcast
              </button>
            </>
          )}
        </div>
      )}
      {adhoc && <AdhocDialog onClose={() => setAdhoc(false)} />}
      {broadcast && <NewBroadcastDialog onClose={() => setBroadcast(false)} />}
    </div>
  );
}
