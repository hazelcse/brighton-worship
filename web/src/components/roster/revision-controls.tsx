"use client";

import Link from "next/link";
import { createContext, useContext, useState, useTransition, type ComponentProps } from "react";
import { republishRoster, resetRosterRevision, startRosterRevision } from "@/app/(app)/roster/revision-actions";
import { FilteredRosterTable } from "@/components/roster/roster-filter";
import { StageBadge } from "@/components/sessions/stage-badge";
import { restoreRevisionAssignments } from "@/app/(app)/roster/actions";
import type { SessionRow } from "@/lib/roster-data";

/** Root, on a published roster: start editing it (in a copy), or carry on with the edit in progress. */
export function EditPublishedButton({ rosterId, revisionId }: { rosterId: string; revisionId: string | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (revisionId) {
    return (
      <Link
        href={`/roster/${revisionId}/generated`}
        className="inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm font-medium text-ink-foreground hover:bg-ink/90"
      >
        Continue editing
      </Link>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        aria-label={pending ? "Copying the roster…" : "Edit roster"}
        aria-busy={pending}
        title="Edit roster: edit a copy. Everyone keeps seeing it as it is until you republish."
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await startRosterRevision(rosterId);
            if (r && !r.ok) setError(r.message ?? "Couldn't start editing.");
          });
        }}
        className="inline-flex size-10 items-center justify-center rounded-lg border border-ink text-ink hover:bg-ink hover:text-ink-foreground disabled:opacity-50"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={pending ? "animate-pulse" : undefined}
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type Snapshot = { session_id: string; member_id: string; role: string; also_roles: string[] }[];
type SessionSettings = Pick<
  SessionRow,
  "id" | "date" | "name" | "ministry" | "weight" | "composition" | "cancelled" | "cancel_reason" | "note" | "rehearsal_date" | "start_time" | "rehearsal_time"
>;

/** Same people in the same places, whatever the order. */
const sameBand = (a: Snapshot, b: Snapshot) => {
  const key = (x: Snapshot) => x.map((r) => `${r.session_id}|${r.role}|${r.member_id}|${[...r.also_roles].sort()}`).sort().join("\n");
  return key(a) === key(b);
};

/**
 * The published-roster edit page's state, like the session editor's: whether the pencil is on (cells
 * only open then), who was serving when it was pressed (the × puts that back, since cell changes
 * save as they're made), and whether the published version is being shown instead.
 */
type Editing = {
  editing: boolean;
  start: () => void;
  stop: () => void;
  cancel: () => Promise<string | null>;
  showPublished: boolean;
  setShowPublished: (on: boolean) => void;
};
const EditingContext = createContext<Editing>({
  editing: true,
  start: () => {},
  stop: () => {},
  cancel: async () => null,
  showPublished: false,
  setShowPublished: () => {},
});

export function RevisionEditing({
  rosterId,
  assignments,
  sessions,
  children,
}: {
  rosterId: string;
  assignments: Snapshot;
  /** The sessions' settings, so the × also undoes changes to a session's band, times, etc. */
  sessions: SessionSettings[];
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [snapshot, setSnapshot] = useState<{ band: Snapshot; sessions: SessionSettings[] } | null>(null);
  const [showPublished, setShowPublished] = useState(false);
  const value: Editing = {
    editing,
    start: () => {
      setSnapshot({
        band: assignments.map(({ session_id, member_id, role, also_roles }) => ({ session_id, member_id, role, also_roles })),
        sessions: sessions.map((s) => ({ ...s })),
      });
      setShowPublished(false);
      setEditing(true);
    },
    stop: () => {
      setEditing(false);
      setSnapshot(null);
    },
    cancel: async () => {
      if (snapshot) {
        const was = new Map(snapshot.sessions.map((s) => [s.id, JSON.stringify(s)]));
        const changedSessions = sessions.some((s) => was.get(s.id) !== JSON.stringify(s)) || sessions.length !== snapshot.sessions.length;
        if (changedSessions || !sameBand(snapshot.band, assignments)) {
          const r = await restoreRevisionAssignments(rosterId, snapshot.band, changedSessions ? snapshot.sessions : undefined);
          if (!r.ok) return r.message ?? "Couldn't undo the changes.";
        }
      }
      setEditing(false);
      setSnapshot(null);
      return null;
    },
    showPublished,
    setShowPublished,
  };
  return <EditingContext.Provider value={value}>{children}</EditingContext.Provider>;
}

type TableProps = Omit<ComponentProps<typeof FilteredRosterTable>, "locked" | "toolbarEnd">;

/**
 * The roster table on the published-roster edit page: highlights always, cells open only while
 * editing, and (when not editing) a toggle to see the published version instead.
 */
export function RevisionRosterTable({ published, ...props }: TableProps & { published: Pick<TableProps, "sessions" | "assignments"> }) {
  const { editing, showPublished, setShowPublished } = useContext(EditingContext);
  const toggle = editing ? null : (
    <div role="group" aria-label="Version" className="flex overflow-hidden rounded-lg border border-border bg-surface text-xs font-medium">
      {[
        { label: "Edited", on: !showPublished, set: false },
        { label: "Published", on: showPublished, set: true },
      ].map((o) => (
        <button
          key={o.label}
          type="button"
          aria-pressed={o.on}
          onClick={() => setShowPublished(o.set)}
          className={`px-2.5 py-1 ${o.on ? "bg-ink text-ink-foreground" : "hover:bg-background"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
  // Same table element either way, so the EM/CM and service filters stay as they are.
  return showPublished && !editing ? (
    <FilteredRosterTable sessions={published.sessions} assignments={published.assignments} toolbarEnd={toggle} />
  ) : (
    <FilteredRosterTable {...props} locked={!editing} toolbarEnd={toggle} />
  );
}

/** Next to the title, like the session editor: Published, plus Unpublished changes and Editing when they apply. */
export function RevisionBadges({ unpublished }: { unpublished: boolean }) {
  const { editing } = useContext(EditingContext);
  return (
    <div className="flex items-center gap-2">
      <StageBadge stage="published" />
      {unpublished && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Unpublished changes</span>}
      {editing && <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">Editing</span>}
    </div>
  );
}

/** A square icon button like the session editor's, named for screen readers and on hover. */
function IconButton({
  label,
  onClick,
  disabled,
  primary,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-flex size-10 items-center justify-center rounded-lg disabled:opacity-50 ${
        primary ? "bg-ink text-ink-foreground hover:bg-ink/90" : "border border-border bg-surface text-muted hover:border-accent/50 hover:text-foreground"
      }`}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

/**
 * Root, editing a published roster, laid out like the session editor:
 * reset to the published version · pencil (edit), or × (undo and stop) and floppy disk (save and stop) · republish.
 * Cell changes save to the edit copy as they're made; the floppy disk just ends editing.
 * The edited / published toggle sits with the table's filters (RevisionRosterTable).
 */
export function RevisionActions({
  revisionId,
  problems,
  unpublished,
}: {
  revisionId: string;
  /** Hard problems: republishing is allowed, but asks first. */
  problems: number;
  /** Whether the edit differs from the published roster: Republish only shows then. */
  unpublished: boolean;
}) {
  const { editing, start: startEditing, stop, cancel } = useContext(EditingContext);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message: string | null } | undefined>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r && !r.ok) setError(r.message ?? "Something went wrong.");
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {editing ? (
        <>
        <IconButton
          label="Stop editing without saving (undo changes since the pencil was pressed)"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const problem = await cancel();
              if (problem) setError(problem);
            });
          }}
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </IconButton>
        <IconButton label="Save and stop editing" onClick={stop} disabled={pending} primary>
          {/* Floppy disk */}
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
          <path d="M17 21v-8H7v8M7 3v5h8" />
        </IconButton>
        </>
      ) : (
        <>
          <IconButton
              label="Reset to the published roster (undo all changes)"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Undo all your changes? The roster goes back to how it's published.")) return;
                run(() => resetRosterRevision(revisionId));
              }}
            >
              {/* Arrow back to the original */}
              <path d="M3 7v6h6" />
              <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
            </IconButton>
          <IconButton label="Edit" onClick={startEditing} disabled={pending} primary>
            {/* Pencil */}
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </IconButton>
        </>
      )}
      {unpublished && (
      <button
        type="button"
        disabled={pending || editing}
        title={editing ? "Save first (the floppy disk)" : "Replace the published roster with this one and tell the people affected"}
        onClick={() => {
          const msg = `${
            problems ? `This roster still has ${problems} ${problems === 1 ? "problem" : "problems"}. They'll stay listed on the roster.\n\n` : ""
          }Republish? Your changes replace the published roster, and everyone added, taken off, given another part or on a session that changed is told in their updates.`;
          if (!window.confirm(msg)) return;
          run(() => republishRoster(revisionId));
        }}
        className={`h-10 rounded-lg px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${problems ? "bg-red-700 text-white hover:bg-red-800" : "bg-ink text-ink-foreground hover:bg-ink/90"}`}
      >
        {pending ? "Working…" : "Republish"}
      </button>
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
