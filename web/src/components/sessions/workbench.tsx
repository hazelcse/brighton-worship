"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  acquireLock,
  dismissPlanChanges,
  getSongDetail,
  publishSession,
  releaseLock,
  renewLock,
  saveDraft,
  type BankSongDetail,
} from "@/app/(app)/sessions/actions";
import { PlanEditor, ownSheetKey, uploadSrc, type EditorApi, type Singer } from "@/components/sessions/plan-editor";
import { SimplePlan } from "@/components/sessions/simple-plan";
import { PlanDiff } from "@/components/sessions/plan-diff";
import { PartCues } from "@/components/sessions/part-cues";
import { SongBankPanel, type BankSong, type OwnSheet } from "@/components/sessions/song-bank-panel";
import { StageBadge } from "@/components/sessions/stage-badge";
import { SessionLinks, type SessionLinkEdit } from "@/components/sessions/session-links";
import { RehearsalDates } from "@/components/sessions/rehearsal-dates";
import { AutoRefresh } from "@/components/auto-refresh";
import { ROLES, ROLE_SHORT } from "@/lib/roster";
import { LOCK_RENEW_MS, majorKey, partCues, blankSong, blankTransition, newId, type PlanItem, type PlanLink, type PlanSection } from "@/lib/session-plan";
import type { PlanRevisionNotice, Workbench as WorkbenchData } from "@/lib/sessions";

const btn = "inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium disabled:opacity-60";

/*
 * The song bank's width on desktop, dragged from the gap between it and the plan. Only the split
 * changes: the page's own width doesn't. Kept per browser; none saved means the defaults
 * (384px, 448px from 1280px). Limits: the bank 320px to half the row, and the plan keeps 560px.
 */
const BANK_KEY = "sessions.songBankWidth";
const BANK_MIN = 320;
const PLAN_MIN = 560;
const GAP = 16;
const bankListeners = new Set<() => void>();
function readBankWidth(): number | null {
  try {
    const v = Number(localStorage.getItem(BANK_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}
function saveBankWidth(width: number | null) {
  try {
    if (width) localStorage.setItem(BANK_KEY, String(Math.round(width)));
    else localStorage.removeItem(BANK_KEY);
  } catch {
    /* storage blocked: the width just isn't remembered */
  }
  bankListeners.forEach((l) => l());
}
function subscribeBankWidth(l: () => void) {
  bankListeners.add(l);
  return () => void bankListeners.delete(l);
}
/** The --bank column width for a chosen width, still kept within the limits if the window shrinks. */
function bankColumn(width: number) {
  return `clamp(${BANK_MIN}px, ${Math.round(width)}px, min(50%, 100% - ${PLAN_MIN + GAP}px))`;
}

/** The drag handle filling the gap left of the song bank. Arrow keys work too; double-click resets. */
function BankResizer({ grid, width }: { grid: React.RefObject<HTMLDivElement | null>; width: number | null }) {
  const [dragging, setDragging] = useState(false);
  const clamp = (w: number) => {
    const row = grid.current?.getBoundingClientRect().width ?? 0;
    return Math.round(Math.max(BANK_MIN, Math.min(w, row / 2, row - PLAN_MIN - GAP)));
  };
  const current = () => {
    const aside = grid.current?.querySelector("aside");
    return aside?.getBoundingClientRect().width ?? width ?? 384;
  };
  const show = (w: number) => grid.current?.style.setProperty("--bank", bankColumn(w));

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize song bank"
      aria-valuenow={Math.round(width ?? 0) || undefined}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
      }}
      onPointerMove={(e) => {
        if (!dragging || !grid.current) return;
        // Pointer in the middle of the gap: the bank starts half a gap to its right.
        show(clamp(grid.current.getBoundingClientRect().right - e.clientX - GAP / 2));
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        setDragging(false);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        saveBankWidth(current());
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onLostPointerCapture={() => {
        if (!dragging) return;
        setDragging(false);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        saveBankWidth(current());
      }}
      onDoubleClick={() => {
        grid.current?.style.removeProperty("--bank");
        saveBankWidth(null);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        const by = e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
        if (!by) return;
        e.preventDefault();
        saveBankWidth(clamp(current() + by));
      }}
      className="group absolute -left-4 top-0 flex h-full w-4 cursor-col-resize touch-none justify-center outline-none"
    >
      <span
        aria-hidden
        className={`h-full w-1 rounded-full transition-colors group-hover:bg-border group-focus-visible:bg-accent ${dragging ? "bg-accent" : ""}`}
      />
    </div>
  );
}

/*
 * Phones: the song bank as a sheet over the bottom of the page. No backdrop, so the plan behind it
 * still scrolls and takes taps. The two-dash handle drags it taller or shorter (up to just under the
 * nav); let go near the bottom and it shrinks to a bar of just the handle, which drags (or taps) back
 * up. Only its ✕ closes it.
 */
const SHEET_BAR = 24; // the handle row; all that shows of a shrunk sheet
const SHEET_SNAP = 140; // let go below this and it shrinks to the bar
const NAV_ROOM = 64; // the sheet stops below the nav
function sheetMax() {
  return window.innerHeight - NAV_ROOM;
}

function BankSheet({
  height,
  onHeight,
  collapsed,
  onCollapsed,
  children,
}: {
  /** Chosen height in px; null = as tall as it goes. */
  height: number | null;
  onHeight: (h: number) => void;
  collapsed: boolean;
  onCollapsed: (c: boolean) => void;
  children: React.ReactNode;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const clamp = (h: number) => Math.round(Math.max(SHEET_BAR, Math.min(h, sheetMax())));
  const open = Math.min(height ?? sheetMax(), sheetMax());
  const shown = drag ?? (collapsed ? SHEET_BAR : open);

  const finish = () => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (!s.moved) {
      // A tap on the bar opens it back up.
      if (collapsed) onCollapsed(false);
    } else if (drag != null) {
      if (drag < SHEET_SNAP) onCollapsed(true);
      else {
        onHeight(drag);
        onCollapsed(false);
      }
    }
    setDrag(null);
  };

  return (
    <>
      {/* Room under the plan, so its last items can scroll up above the sheet. */}
      <div aria-hidden style={{ height: shown }} />
      <div
        className="fixed inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden rounded-t-2xl border border-b-0 border-border bg-surface shadow-[0_-8px_24px_rgba(0,0,0,0.12)]"
        style={{ height: shown }}
      >
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={collapsed ? "Song bank: drag up or tap to open" : "Resize song bank"}
          tabIndex={0}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            start.current = { y: e.clientY, h: shown, moved: false };
          }}
          onPointerMove={(e) => {
            const s = start.current;
            if (!s) return;
            const dy = s.y - e.clientY;
            if (Math.abs(dy) > 4) s.moved = true;
            if (s.moved) setDrag(clamp(s.h + dy));
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onCollapsed(!collapsed);
              return;
            }
            const by = e.key === "ArrowUp" ? 48 : e.key === "ArrowDown" ? -48 : 0;
            if (!by) return;
            e.preventDefault();
            const next = clamp(shown + by);
            if (next < SHEET_SNAP) onCollapsed(true);
            else {
              onHeight(next);
              onCollapsed(false);
            }
          }}
          className="flex shrink-0 cursor-row-resize touch-none flex-col items-center justify-center gap-[3px] outline-none focus-visible:bg-background"
          style={{ height: SHEET_BAR }}
        >
          <span aria-hidden className="h-[3px] w-9 rounded-full bg-muted/50" />
          <span aria-hidden className="h-[3px] w-9 rounded-full bg-muted/50" />
        </div>
        {/* Kept mounted while shrunk, so the search and filters stay as they were. */}
        <div className={`min-h-0 flex-1 ${collapsed && drag == null ? "invisible" : ""}`}>{children}</div>
      </div>
    </>
  );
}

/** Take an item out and put it at this position in this section. */
function placeAt(plan: PlanSection[], id: string, sectionId: string, index: number): PlanSection[] {
  const item = plan.flatMap((s) => s.items).find((i) => i.id === id);
  if (!item) return plan;
  return plan.map((s) => {
    const items = s.items.filter((i) => i.id !== id);
    if (s.id === sectionId) items.splice(Math.max(0, Math.min(index, items.length)), 0, item);
    return { ...s, items };
  });
}

/** Move an item one place up/down through the whole plan, crossing into the next section at the edges. */
function moveThrough(plan: PlanSection[], id: string, dir: -1 | 1): PlanSection[] {
  const next = plan.map((s) => ({ ...s, items: [...s.items] }));
  const si = next.findIndex((s) => s.items.some((i) => i.id === id));
  if (si < 0) return plan;
  const items = next[si].items;
  const ii = items.findIndex((i) => i.id === id);
  const j = ii + dir;
  if (j >= 0 && j < items.length) {
    [items[ii], items[j]] = [items[j], items[ii]];
    return next;
  }
  const target = si + dir;
  if (target < 0 || target >= next.length) return plan;
  const [item] = items.splice(ii, 1);
  if (dir === -1) next[target].items.push(item);
  else next[target].items.unshift(item);
  return next;
}

type AddWhat = "song" | "transition" | "section" | "session-link";

function AddMenu({ onAdd }: { onAdd: (what: AddWhat) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const item = (what: AddWhat, text: string, nested = false) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        onAdd(what);
      }}
      className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-background ${nested ? "pl-8" : ""}`}
    >
      {text}
    </button>
  );
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Add"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-xl leading-none text-ink-foreground hover:bg-ink/90"
      >
        +
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-2 w-52 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg">
          {item("session-link", "+ Session link")}
          {item("section", "+ New section")}
          <div className="border-t border-border" />
          {item("song", "+ New song")}
          {item("transition", "+ New transition")}
        </div>
      )}
    </div>
  );
}

// The simplified-view choice, remembered on this device (full view if storage is blocked).
const VIEW_KEY = "session-view";
const viewListeners = new Set<() => void>();
let simpleFallback = false;
function subscribeView(fn: () => void) {
  viewListeners.add(fn);
  return () => void viewListeners.delete(fn);
}
function readSimpleView(): boolean {
  try {
    return localStorage.getItem(VIEW_KEY) === "simple";
  } catch {
    return simpleFallback;
  }
}
function writeSimpleView(on: boolean) {
  simpleFallback = on;
  try {
    localStorage.setItem(VIEW_KEY, on ? "simple" : "full");
  } catch {
    /* not remembered: the fallback keeps it for this visit */
  }
  viewListeners.forEach((fn) => fn());
}

/** A round icon button (pencil, floppy disk, undo arrow, ×), named for screen readers and on hover. */
function IconButton({
  label,
  onClick,
  disabled,
  primary,
  pressed,
  className = "",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  /** A toggle: shown filled while on. */
  pressed?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={`inline-flex size-9 items-center justify-center rounded-lg disabled:opacity-50 ${
        primary || pressed ? "bg-ink text-ink-foreground hover:bg-ink/90" : "border border-border bg-surface text-muted hover:border-accent/50 hover:text-foreground"
      } ${className}`}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

/** The session was published again: what changed, newest first, with an × to close it. */
function ChangesBox({ changes, onClose }: { changes: PlanRevisionNotice[]; onClose: () => void }) {
  return (
    <section aria-label="What's changed" className="relative rounded-xl border border-accent/40 bg-accent/10 py-3 pl-4 pr-10 text-sm">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        title="Close"
        className="absolute right-1.5 top-1.5 rounded-full p-1.5 text-muted hover:bg-accent/15 hover:text-foreground"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      <h2 className="font-semibold">This session has been updated</h2>
      <div className="mt-1.5 space-y-2.5">
        {changes.map((r) => (
          <div key={r.id}>
            {changes.length > 1 || r.publishedBy ? (
              <p className="text-xs text-muted">
                {r.publishedBy ? `${r.publishedBy}, ` : ""}
                {new Date(r.publishedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
            ) : null}
            <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
              {r.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Leaving edit mode with unsaved changes: save them, throw them away, or carry on editing. */
function SavePrompt({ busy, onSave, onDiscard, onKeep }: { busy: boolean; onSave: () => void; onDiscard: () => void; onKeep: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onKeep();
      }}
      aria-labelledby="save-prompt-title"
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
    >
      <div className="space-y-4 p-6">
        <div>
          <h2 id="save-prompt-title" className="text-lg font-semibold">
            Save your changes?
          </h2>
          <p className="mt-1 text-sm text-muted">You haven&apos;t saved your edits to this session yet.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onKeep} disabled={busy} className={`${btn} text-muted hover:text-foreground`}>
            Keep editing
          </button>
          <button type="button" onClick={onDiscard} disabled={busy} className={`${btn} border border-red-200 bg-red-50 text-danger hover:bg-red-100`}>
            Don&apos;t save
          </button>
          <button type="button" onClick={onSave} disabled={busy} className={`${btn} bg-ink text-ink-foreground hover:bg-ink/90`}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Leaving the page (e.g. "← Sessions") while still in edit mode: a reminder to save first. They can
 * stay, save (or just stop editing) and go, or leave anyway: the edits are thrown away and the
 * session is unlocked.
 */
function LeavePrompt({
  busy,
  dirty,
  onSave,
  onLeaveAnyway,
  onKeep,
}: {
  busy: boolean;
  dirty: boolean;
  onSave: () => void;
  onLeaveAnyway: () => void;
  onKeep: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onKeep();
      }}
      aria-labelledby="leave-prompt-title"
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
    >
      <div className="relative space-y-4 p-6">
        {/* Stay: close the popup and carry on editing. */}
        <button
          type="button"
          onClick={onKeep}
          disabled={busy}
          aria-label="Stay"
          title="Stay"
          className="absolute right-3 top-3 rounded-full p-1.5 text-muted hover:bg-background hover:text-foreground disabled:opacity-50"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <div className="pr-6">
          <h2 id="leave-prompt-title" className="text-lg font-semibold">
            {dirty ? "Save before you go?" : "You're still editing"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {dirty
              ? "You haven't saved your edits to this session yet. If you leave, they're thrown away."
              : "This session is still in edit mode. Leaving stops editing, so the other worship leader can edit it."}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={onLeaveAnyway} disabled={busy} className={`${btn} border border-border bg-surface hover:border-accent/50`}>
            Leave
          </button>
          <button type="button" onClick={onSave} disabled={busy} className={`${btn} bg-ink text-ink-foreground hover:bg-ink/90`}>
            {busy ? (dirty ? "Saving…" : "Stopping…") : "Save changes and leave"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function Workbench({
  initial,
  canEdit,
  bank,
  canBrowse,
  projection = false,
}: {
  initial: WorkbenchData;
  canEdit: boolean;
  bank: BankSong[];
  canBrowse: boolean;
  /** A media team's Projection view: read only, no band and no song bank, back to Projection. */
  projection?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PlanSection[]>(initial.plan);
  const [draftLinks, setDraftLinks] = useState<PlanLink[]>(initial.links);
  /** The session link popup: which link, or "new". */
  const [linkDialog, setLinkDialog] = useState<SessionLinkEdit>(null);
  /** Changed since editing started (and not saved). */
  const [dirty, setDirty] = useState(false);
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Leaving with unsaved changes: where to (null = just stop editing), while the save prompt is up. */
  const [leaving, setLeaving] = useState<{ href: string | null } | null>(null);
  /** Worship leaders of a published session with a revision: which version they're looking at. */
  const [showPublished, setShowPublished] = useState(false);
  const [changesClosed, setChangesClosed] = useState(false);
  /** "Show changes": the plan with what the last publishing took out and put in marked, like a diff. */
  const [showDiff, setShowDiff] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  /** The simplified view: the whole set as one block of text. Remembered on this device. */
  const simpleChoice = useSyncExternalStore(subscribeView, readSimpleView, () => false);
  /**
   * Band members on this session only get the simplified view, unless they're its BL/TB or lead a
   * song in it (a worship leader or vocalist).
   */
  const simpleOnly = useMemo(() => {
    const me = initial.band.find((m) => m.id === initial.myId);
    if (!me || !ROLES.some((r) => r.value === me.role)) return false;
    const roles = [me.role, ...me.also];
    if (roles.includes("band leader") || roles.includes("talkback")) return false;
    const leads = initial.plan.some((sec) => sec.items.some((i) => i.lead_id === me.id));
    return !leads;
  }, [initial.band, initial.myId, initial.plan]);
  const simple = simpleOnly || simpleChoice;
  const toggleSimple = () => writeSimpleView(!simple);
  /** While editing: the simplified view of the draft, to check how it reads (starts off each time). */
  const [editPreview, setEditPreview] = useState(false);

  // Song bank panel
  const [minimised, setMinimised] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Phones: the sheet's dragged height (null = full) and whether it's shrunk to the bar.
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const bankWidth = useSyncExternalStore(subscribeBankWidth, readBankWidth, () => null);
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  /** The ← in the song bank went back to the list from the open song's own songsheet (until another song is opened). */
  const [ownHidden, setOwnHidden] = useState(false);
  const [details, setDetails] = useState<Record<string, BankSongDetail | null | undefined>>({});
  const [focusSearch, setFocusSearch] = useState(0);

  // What's on the page: while editing, our own copy. Otherwise the band's version, or for its worship
  // leaders, their revised draft (unless they've switched to the published version).
  const revision = canEdit ? initial.revision : null;
  const viewingRevision = !editing && Boolean(revision) && !showPublished;
  const plan = editing ? draft : viewingRevision ? revision!.plan : initial.plan;
  const links = editing ? draftLinks : viewingRevision ? revision!.links : initial.links;
  const shownStatus = initial.status;
  const published = shownStatus === "published";

  // What "Show changes" compares: a worship leader's revised draft with the published version, or
  // the published version with the one the last publishing replaced.
  const diff = editing
    ? null
    : viewingRevision
      ? { before: initial.plan, linksBefore: initial.links, caption: "Your revised draft compared with the published version (what the band sees now)." }
      : initial.previous
        ? {
            before: initial.previous.plan,
            linksBefore: initial.previous.links,
            caption: `Changes ${initial.previous.publishedBy ? `published by ${initial.previous.publishedBy}` : "published"} on ${new Date(initial.previous.publishedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`,
          }
        : null;
  const diffing = showDiff && diff !== null;

  // ---- editing --------------------------------------------------------------
  // Nothing saves until the floppy disk, except when the lock lapses (then the edits are autosaved).
  // Leave the page without saving and the edits are thrown away.
  const latest = useRef(draft);
  const latestLinks = useRef(draftLinks);
  // The saved version this editing started from, so saving can tell whether someone else saved since.
  const base = useRef<string | null>(null);
  // Whether we're editing, read when the page goes away. Set at once (not after the next render), so
  // a save-then-navigate isn't mistaken for leaving mid-edit.
  const editingRef = useRef(editing);

  const stopEditing = useCallback(
    (message: string | null) => {
      editingRef.current = false;
      setEditing(false);
      setDirty(false);
      setSelectedId(null);
      setLinkDialog(null);
      setLeaving(null);
      setLockMessage(message);
      router.refresh();
    },
    [router],
  );

  const change = useCallback((fn: (p: PlanSection[]) => PlanSection[]) => {
    setDraft((p) => {
      const next = fn(p);
      latest.current = next;
      return next;
    });
    setDirty(true);
  }, []);

  const changeLinks = useCallback((next: PlanLink[]) => {
    latestLinks.current = next;
    setDraftLinks(next);
    setDirty(true);
  }, []);

  const startEditing = useCallback(async () => {
    setBusy(true);
    setLockMessage(null);
    setError(null);
    const res = await acquireLock(initial.id);
    setBusy(false);
    if (!res.ok) {
      setLockMessage(res.message);
      router.refresh();
      return;
    }
    // A published session's draft is its revision, or a fresh copy of the published plan.
    const start = res.workbench.revision?.plan ?? res.workbench.plan;
    latest.current = start;
    setDraft(start);
    const startLinks = res.workbench.revision?.links ?? res.workbench.links;
    latestLinks.current = startLinks;
    setDraftLinks(startLinks);
    base.current = res.version;
    setDirty(false);
    setShowPublished(false);
    // Editing has one song open at a time: several left open from viewing close.
    setOpenIds((o) => (o.size > 1 ? new Set() : o));
    editingRef.current = true;
    setEditPreview(false);
    setEditing(true);
  }, [initial.id, router]);

  /** The floppy disk: save to the draft and go back to view mode. */
  const saveAndStop = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const res = await saveDraft(initial.id, latest.current, latestLinks.current, base.current);
    setBusy(false);
    if (res.ok) {
      stopEditing(null);
      return true;
    }
    if (res.lostLock) stopEditing(res.message);
    else setError(res.message);
    return false;
  }, [initial.id, stopEditing]);

  const discardAndStop = useCallback(async () => {
    await releaseLock(initial.id);
    stopEditing(null);
  }, [initial.id, stopEditing]);

  // Keep the lock while editing. If it went (e.g. the phone slept past the 2-minute timeout), the
  // edits are autosaved and it's back to view mode. If the other worship leader has edited it in the
  // meantime, saving would overwrite theirs, so the edits are dropped instead.
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    if (!editing) return;
    const id = initial.id;
    let saving = false;
    const lost = async () => {
      if (saving || !editingRef.current) return;
      saving = true;
      if (!dirtyRef.current) {
        void releaseLock(id);
        stopEditing(null);
        return;
      }
      const res = await saveDraft(id, latest.current, latestLinks.current, base.current);
      if (res.ok) stopEditing("You were away long enough for the session to be unlocked, so your changes were saved for you.");
      else if (res.lostLock) stopEditing(res.message);
      else {
        // Couldn't reach the server: keep editing, and try again on the next check.
        setError(`Your changes couldn't be autosaved (${res.message}). They'll be tried again shortly.`);
        saving = false;
      }
    };
    const beat = setInterval(async () => {
      if (!(await renewLock(id))) lost();
    }, LOCK_RENEW_MS);
    const onVisible = async () => {
      if (document.visibilityState === "visible" && !(await renewLock(id))) lost();
    };
    // Closing the tab, reloading, or going to another site: the browser asks first.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // Gone anyway: the edits are thrown away and the session is unlocked straight away.
    const onHide = () => {
      if (!editingRef.current) return;
      navigator.sendBeacon(`/api/sessions/${id}/release`);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onHide);
    };
  }, [editing, initial.id, stopEditing]);

  // Following a link elsewhere in the app (e.g. "← Sessions") while editing: remind them to save first.
  useEffect(() => {
    if (!editing) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaving({ href: url.pathname + url.search + url.hash });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [editing]);

  // Left the page some other way (e.g. the browser's back button) while editing: as "Leave anyway",
  // the edits are thrown away and the session is unlocked.
  useEffect(() => {
    const id = initial.id;
    return () => {
      if (editingRef.current) void releaseLock(id);
    };
  }, [initial.id]);

  // While someone else is editing, check back now and then so the pencil unlocks when they're done.
  useEffect(() => {
    if (editing || !canEdit || !initial.lockedBy) return;
    const t = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(t);
  }, [editing, canEdit, initial.lockedBy, router]);

  async function publish() {
    const first = !published;
    const ok = confirm(
      first
        ? "Publish this session? The band will be able to see it."
        : "Publish your changes? They replace the published version, and the band is told what changed.",
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    const res = await publishSession(initial.id);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setShowPublished(false);
    router.refresh();
  }

  async function closeChanges() {
    setChangesClosed(true);
    await dismissPlanChanges(initial.changes.map((c) => c.id));
  }

  // ---- song bank ------------------------------------------------------------
  const loadDetail = useCallback(
    (songId: string) => {
      if (songId in details) return;
      setDetails((d) => ({ ...d, [songId]: undefined }));
      getSongDetail(songId)
        .then((detail) => setDetails((d) => ({ ...d, [songId]: detail })))
        .catch(() => setDetails((d) => ({ ...d, [songId]: null })));
    },
    [details],
  );

  const showDetail = useCallback(
    (songId: string | null) => {
      setDetailId(songId);
      if (songId) loadDetail(songId);
    },
    [loadDetail],
  );

  const openPanel = () => {
    setMinimised(false);
    setMobileOpen(true);
    setSheetCollapsed(false);
  };

  // ---- the plan -------------------------------------------------------------
  const numbers = useMemo(() => {
    const out: Record<string, number> = {};
    let n = 0;
    for (const s of plan) for (const i of s.items) if (i.kind === "song") out[i.id] = ++n;
    return out;
  }, [plan]);

  const selected = useMemo(() => plan.flatMap((s) => s.items).find((i) => i.id === selectedId) ?? null, [plan, selectedId]);

  const select = useCallback(
    (item: PlanItem | null) => {
      setSelectedId(item?.id ?? null);
      setOwnHidden(false);
      // Projection has no song bank to show the song in.
      if (!item || item.kind !== "song" || projection) return;
      if (item.song_id) showDetail(item.song_id);
      else if (editing) {
        setDetailId(null);
        setQuery(item.title);
      }
    },
    [editing, showDetail, projection],
  );

  /** Editing a song with its own uploaded songsheet (not from the bank): the panel shows that file. */
  const ownSheet: OwnSheet = useMemo(
    () =>
      editing && !projection && !ownHidden && !detailId && selected?.kind === "song" && !selected.song_id && selected.sheet
        ? {
            title: selected.title || "Untitled song",
            artist: selected.artist ?? null,
            keyLabel: ownSheetKey(selected) || null,
            fileName: selected.sheet.file_name,
            src: uploadSrc(initial.id, selected),
          }
        : null,
    [editing, projection, ownHidden, detailId, selected, initial.id],
  );

  // While a song is open in the desktop song bank, the panel reaches out to the window's right edge
  // (over the page margin) so its songsheet is as big as it can be. The column itself keeps its width.
  // The plan then slides left (`shift`, px) to sit centred in the space left of the panel: the same
  // space between the window's left edge and the plan as between the plan and the panel.
  const asideRef = useRef<HTMLElement>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const [reach, setReach] = useState(0);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const aside = asideRef.current;
    const planEl = planRef.current;
    if (!(detailId || ownSheet) || minimised || !aside || !planEl) {
      setReach(0);
      setShift(0);
      return;
    }
    const measure = () => {
      const box = aside.getBoundingClientRect();
      // Hidden below 1024px (the phone sheet is used instead): nothing to stretch.
      if (!box.width) {
        setReach(0);
        setShift(0);
        return;
      }
      setReach(Math.max(0, Math.floor(document.documentElement.clientWidth - box.right)));
      // Layout positions (the shift is a relative offset, so it doesn't change these).
      const plan = planEl.offsetWidth;
      const planLeft = box.left - GAP - plan;
      const centred = (box.left - plan) / 2;
      setShift(Math.min(0, Math.round(centred - planLeft)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(aside);
    ro.observe(planEl);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [detailId, ownSheet, minimised]);

  const updateItem = useCallback(
    (id: string, patch: Partial<PlanItem>) =>
      change((p) => p.map((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))),
    [change],
  );

  const toggleOpen = useCallback(
    (item: PlanItem) => {
      const opening = !openIds.has(item.id);
      if (!editing) {
        // Viewing (and Projection): each song opens and closes on its own, so they can all be open at once.
        const next = new Set(openIds);
        if (opening) next.add(item.id);
        else next.delete(item.id);
        setOpenIds(next);
      } else {
        // Editing: one open at a time, so opening one closes the rest.
        setOpenIds(opening ? new Set([item.id]) : new Set());
      }
      if (opening) select(item);
      else if (selectedId === item.id) setSelectedId(null);
    },
    [openIds, select, selectedId, editing],
  );

  /** The session's worship leaders and vocalists. */
  const singers: Singer[] = useMemo(
    () =>
      initial.band
        .filter((m) => m.role === "worship leader" || m.role === "vocalist")
        .map((m) => ({ id: m.id, name: m.name, role: m.role })),
    [initial.band],
  );


  function insert(item: PlanItem, sectionId?: string) {
    change((p) => {
      if (!p.length) return [{ id: newId(), name: "Main Set", items: [item] }];
      const afterIdx = sectionId ? -1 : p.findIndex((s) => s.items.some((i) => i.id === selectedId));
      return p.map((s, si) => {
        if (sectionId ? s.id !== sectionId : afterIdx >= 0 ? si !== afterIdx : si !== p.length - 1) return s;
        const at = !sectionId && afterIdx >= 0 ? s.items.findIndex((i) => i.id === selectedId) + 1 : s.items.length;
        return { ...s, items: [...s.items.slice(0, at), item, ...s.items.slice(at)] };
      });
    });
    setOpenIds(new Set([item.id]));
    select(item);
  }

  function add(what: AddWhat) {
    if (what === "session-link") return setLinkDialog("new");
    if (what === "section") {
      const id = newId();
      change((p) => [...p, { id, name: "New section", items: [] }]);
      setTimeout(() => {
        const el = document.querySelector<HTMLInputElement>(`[data-section-name="${id}"]`);
        el?.focus();
        el?.select();
      }, 0);
      return;
    }
    insert(what === "song" ? blankSong() : blankTransition());
  }

  function applySong(song: BankSong) {
    if (!selected || selected.kind !== "song") return;
    updateItem(selected.id, {
      song_id: song.id,
      title: song.title,
      type: song.type,
      bpm: song.bpm,
      key: majorKey(song.key),
      artist: song.artist,
      // Links and sequence start blank: the worship leader picks the songsheet's or writes their own.
      sequence: null,
      custom_elements: [],
      links: null,
      // A song from the bank uses the library's songsheet instead of an uploaded one.
      sheet: null,
    });
    showDetail(song.id);
    setMobileOpen(false);
  }

  const api: EditorApi = {
    sessionId: initial.id,
    editing,
    selectedId,
    onSelect: select,
    isOpen: (id) => openIds.has(id),
    toggleOpen,
    updateItem,
    removeItem: (id) => {
      if (id === selectedId) setSelectedId(null);
      change((p) => p.map((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) })));
    },
    moveItem: (id, dir) => change((p) => moveThrough(p, id, dir)),
    moveTo: (id, sectionId, index) => change((p) => placeAt(p, id, sectionId, index)),
    renameSection: (id, name) => change((p) => p.map((s) => (s.id === id ? { ...s, name } : s))),
    removeSection: (id) => change((p) => p.filter((s) => s.id !== id)),
    moveSection: (id, dir) =>
      change((p) => {
        const i = p.findIndex((s) => s.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= p.length) return p;
        const next = [...p];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      }),
    addItem: (kind, sectionId) => insert(kind === "song" ? blankSong() : blankTransition(), sectionId),
    pickFromBank: (item) => {
      setSelectedId(item.id);
      setDetailId(null);
      setQuery(item.title);
      openPanel();
      setFocusSearch((n) => n + 1);
    },
    details,
    numbers,
    singers,
    myRole: initial.myRole,
    // Songsheets are made for the published plan, so only shown while that's what's on the page.
    sheetsFor: published && !editing && !viewingRevision ? initial.id : null,
    sheetKeys: initial.sheetKeys,
  };

  const target = editing && selected?.kind === "song" ? { label: `song ${numbers[selected.id]}`, songId: selected.song_id } : null;
  const otherEditor = !editing && initial.lockedBy ? initial.lockedBy.name : null;

  // The same panel twice: the desktop column (">" collapses it) and the phone sheet ("✕" closes it).
  const renderPanel = (inSheet: boolean, toEdge = false) => (
    <SongBankPanel
      inSheet={inSheet}
      toEdge={toEdge}
      bank={bank}
      canBrowse={canBrowse}
      query={query}
      onQuery={setQuery}
      detailId={detailId}
      onDetail={(id) => {
        if (!id) setOwnHidden(true);
        showDetail(id);
      }}
      detail={detailId ? details[detailId] : undefined}
      ownSheet={ownSheet}
      target={target}
      onUse={applySong}
      onMinimise={() => {
        if (inSheet) {
          setMobileOpen(false);
          setSheetCollapsed(false);
        } else setMinimised(true);
      }}
      focusSearch={focusSearch}
      defaultLanguage={initial.service.startsWith("em_") ? "en" : initial.service.startsWith("cm_") ? "zh" : ""}
    />
  );

  return (
    <div
      ref={gridRef}
      // --bank: the song bank column; defaults by window size, or the width dragged (BankResizer).
      style={bankWidth && !minimised ? ({ "--bank": bankColumn(bankWidth) } as React.CSSProperties) : undefined}
      className={`grid gap-4 ${projection ? "" : minimised ? "lg:grid-cols-[minmax(0,1fr)_2.75rem]" : "lg:grid-cols-[minmax(0,1fr)_var(--bank)] lg:[--bank:24rem] xl:[--bank:28rem]"}`}
    >
      {/* View mode only: pick up the worship leaders' changes. Never while editing, so a refresh can't fight the draft. */}
      {!editing && <AutoRefresh />}
      {/* The session being built */}
      {/* position:relative + left (not a transform), so fixed overlays inside still cover the window. */}
      <div ref={planRef} className="relative min-w-0 space-y-4" style={shift ? { left: shift } : undefined}>
        <Link href={projection ? "/projection" : "/sessions"} className="block w-fit text-sm text-muted hover:text-foreground">
          {projection ? "← Projection" : "← Sessions"}
        </Link>

        {/* Phones: title and badges, then the date and rehearsal on one line under it, then the buttons. */}
        <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
          <div className="flex min-w-0 flex-col sm:block sm:flex-1">
            {/* Opens the service and rehearsal dates; worship leaders can move the rehearsal from there.
                Above the title from 640px, below it on phones. */}
            <RehearsalDates
              className="max-sm:order-last max-sm:mt-1"
              planId={initial.id}
              date={initial.date}
              startTime={initial.startTime}
              rehearsal={initial.rehearsalDate}
              rehearsalTime={initial.rehearsalTime}
              canChange={canEdit && initial.onRoster}
            />
            {/* Badges in one row to the right of the title at every width; the row only drops under the
                title when it doesn't fit beside it. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <h1 className="min-w-0 font-display text-3xl font-semibold">{initial.serviceName}</h1>
              <div className="flex shrink-0 items-center gap-2">
                <StageBadge stage={shownStatus} />
                {published && revision && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Unpublished changes</span>
                )}
                {editing && <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">Editing</span>}
              </div>
            </div>
          </div>
          {/* Phones: while editing, × and save sit at the left and the eye and + at the right; otherwise the eye stays
              at the left and Undo / Edit / Publish sit at the right. */}
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <IconButton label="Stop editing" onClick={() => (dirty ? setLeaving({ href: null }) : void discardAndStop())} disabled={busy}>
                  <path d="M18 6 6 18M6 6l12 12" />
                </IconButton>
                <IconButton label={published ? "Save changes to the revised draft" : "Save changes to the draft"} onClick={() => void saveAndStop()} disabled={busy} primary className="max-sm:mr-auto">
                  {/* Floppy disk */}
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                  <path d="M17 21v-8H7v8M7 3v5h8" />
                </IconButton>
                <IconButton label={editPreview ? "Back to the editor" : "Preview the simplified view"} onClick={() => setEditPreview((v) => !v)} pressed={editPreview}>
                  {/* Eye */}
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </IconButton>
                <AddMenu onAdd={add} />
              </>
            ) : (
              <>
                {!simpleOnly && (
                  <IconButton label={simple ? "Show full view" : "Show simplified view"} onClick={toggleSimple} pressed={simple} className={diff ? "" : "max-sm:mr-auto"}>
                    {/* Eye */}
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </IconButton>
                )}
                {diff && (
                  <IconButton label={diffing ? "Hide changes" : "Show changes (added and taken out)"} onClick={() => setShowDiff((v) => !v)} pressed={diffing} className="max-sm:mr-auto">
                    {/* Plus over minus, like a diff */}
                    <path d="M12 4v8M8 8h8" />
                    <path d="M8 18h8" />
                  </IconButton>
                )}
                {canEdit && (
                <>
                  <IconButton
                    label={otherEditor ? `${otherEditor} is editing` : "Edit"}
                    onClick={startEditing}
                    disabled={busy || Boolean(otherEditor)}
                    primary
                  >
                    {/* Pencil */}
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </IconButton>
                  {(!published || revision) && (
                    <button
                      type="button"
                      onClick={publish}
                      disabled={busy || Boolean(otherEditor)}
                      className={`${btn} bg-accent text-accent-foreground shadow-sm hover:bg-accent/90`}
                    >
                      {published ? "Publish changes" : "Publish"}
                    </button>
                  )}
                </>
                )}
              </>
            )}
          </div>
        </header>

        {error && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
        {(otherEditor || lockMessage) && (
          <p role="status" className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm">
            {otherEditor ? `${otherEditor} is editing this session right now. You can look, and edit once they're done.` : lockMessage}
          </p>
        )}

        {/* Republished: what changed, until they close it. */}
        {!editing && !changesClosed && initial.changes.length > 0 && <ChangesBox changes={initial.changes} onClose={closeChanges} />}

        {!editing && published && revision && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              {showPublished
                ? "You're looking at the published version, which is what the band sees."
                : `You're looking at the revised draft${revision.updatedBy ? ` (last saved by ${revision.updatedBy})` : ""}. The band still sees the published version.`}
            </span>
            <div role="group" aria-label="Version" className="flex shrink-0 overflow-hidden rounded-lg border border-border bg-surface text-xs font-medium">
              {[
                { label: "Revised draft", on: !showPublished, set: false },
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
          </div>
        )}

        {!projection && initial.band.length > 0 && (
          <details className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm">
            <summary className="cursor-pointer font-medium">Band ({initial.band.length})</summary>
            <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {initial.band.map((m, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-14 shrink-0 text-xs font-semibold text-muted">{ROLE_SHORT[m.role] ?? m.role}</span>
                  <span>
                    {m.name}
                    {m.also.length > 0 && <span className="text-muted"> · {m.also.map((r) => ROLE_SHORT[r] ?? r).join(", ")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {!diffing && <SessionLinks links={links} editing={editing && !editPreview} dialog={linkDialog} onDialog={setLinkDialog} onChange={changeLinks} />}

        {diffing ? (
          <PlanDiff
            before={diff.before}
            after={plan}
            linksBefore={diff.linksBefore}
            linksAfter={links}
            leadName={(id) => (id ? (initial.band.find((m) => m.id === id)?.name ?? null) : null)}
            caption={diff.caption}
          />
        ) : (editing ? editPreview : simple) ? (
          <SimplePlan
            plan={plan}
            leadName={(id) => (id ? (singers.find((x) => x.id === id)?.name ?? null) : null)}
            highlight={initial.myRole}
            sheetsFor={api.sheetsFor}
            sheetKeys={initial.sheetKeys}
          />
        ) : (
          <>
            {!editing && <PartCues role={initial.myRole} cues={partCues(plan.flatMap((sec) => sec.items), initial.myRole)} />}
            <PlanEditor plan={plan} api={api} />
          </>
        )}

        {leaving?.href && (
          <LeavePrompt
            busy={busy}
            dirty={dirty}
            onSave={async () => {
              const href = leaving.href!;
              if (dirty) {
                if (await saveAndStop()) router.push(href);
              } else {
                await discardAndStop();
                router.push(href);
              }
            }}
            onLeaveAnyway={async () => {
              const href = leaving.href!;
              await discardAndStop();
              router.push(href);
            }}
            onKeep={() => setLeaving(null)}
          />
        )}
        {leaving && !leaving.href && (
          <SavePrompt
            busy={busy}
            onSave={() => void saveAndStop()}
            onDiscard={() => void discardAndStop()}
            onKeep={() => setLeaving(null)}
          />
        )}

        {!editing && !viewingRevision && initial.updatedBy && (
          <p className="text-xs text-muted">
            Last changed by {initial.updatedBy} on {new Date(initial.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        )}
      </div>

      {/* Song bank: a column on wide screens, a sheet on phones (not on Projection) */}
      {!projection && (
      <>
      <aside ref={asideRef} className="hidden lg:block">
        <div className="sticky top-[4.5rem] h-[calc(100dvh-6rem)]">
          {minimised ? (
            <button
              type="button"
              onClick={() => setMinimised(false)}
              aria-label="Show song bank"
              className="flex h-full w-full flex-col items-center gap-3 rounded-xl border border-border bg-surface py-4 text-sm font-medium text-muted hover:text-foreground"
            >
              <span aria-hidden>‹</span>
              <span className="[writing-mode:vertical-rl]">Song bank</span>
            </button>
          ) : (
            <>
              <BankResizer grid={gridRef} width={bankWidth} />
              <div className="h-full" style={reach ? { marginRight: -reach } : undefined}>
                {renderPanel(false, reach > 0)}
              </div>
            </>
          )}
        </div>
      </aside>
      <div className="lg:hidden">
        {mobileOpen ? (
          <BankSheet height={sheetHeight} onHeight={setSheetHeight} collapsed={sheetCollapsed} onCollapsed={setSheetCollapsed}>
            {renderPanel(true)}
          </BankSheet>
        ) : (
          <button
            type="button"
            onClick={openPanel}
            className="fixed bottom-4 right-4 z-30 rounded-full bg-ink px-4 py-3 text-sm font-medium text-ink-foreground shadow-lg"
          >
            Song bank
          </button>
        )}
      </div>
      </>
      )}
    </div>
  );
}
