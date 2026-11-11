"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  acquireLock,
  dismissPlanChanges,
  getSongDetail,
  publishSession,
  releaseLock,
  renewLock,
  revertToPublished,
  saveDraft,
  type BankSongDetail,
} from "@/app/(app)/sessions/actions";
import { PlanEditor, type EditorApi, type Singer } from "@/components/sessions/plan-editor";
import { SimplePlan } from "@/components/sessions/simple-plan";
import { PartCues } from "@/components/sessions/part-cues";
import { SongBankPanel, type BankSong } from "@/components/sessions/song-bank-panel";
import { StageBadge } from "@/components/sessions/stage-badge";
import { formatDate, ROLE_SHORT } from "@/lib/roster";
import { LOCK_RENEW_MS, majorKey, partCues, blankSong, blankTransition, newId, type PlanItem, type PlanSection } from "@/lib/session-plan";
import type { PlanRevisionNotice, Workbench as WorkbenchData } from "@/lib/sessions";

const btn = "inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium disabled:opacity-60";

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

function AddMenu({ onAdd }: { onAdd: (what: "song" | "transition" | "section") => void }) {
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
  const item = (what: "song" | "transition" | "section", text: string, nested = false) => (
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
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  /** A toggle: shown filled while on. */
  pressed?: boolean;
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
      }`}
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

export function Workbench({
  initial,
  canEdit,
  bank,
  canBrowse,
}: {
  initial: WorkbenchData;
  canEdit: boolean;
  bank: BankSong[];
  canBrowse: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PlanSection[]>(initial.plan);
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  /** The simplified view: the whole set as one block of text. Remembered on this device. */
  const simple = useSyncExternalStore(subscribeView, readSimpleView, () => false);
  const toggleSimple = () => writeSimpleView(!simple);

  // Song bank panel
  const [minimised, setMinimised] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, BankSongDetail | null | undefined>>({});
  const [focusSearch, setFocusSearch] = useState(0);

  // What's on the page: while editing, our own copy. Otherwise the band's version, or for its worship
  // leaders, their revised draft (unless they've switched to the published version).
  const revision = canEdit ? initial.revision : null;
  const viewingRevision = !editing && Boolean(revision) && !showPublished;
  const plan = editing ? draft : viewingRevision ? revision!.plan : initial.plan;
  const shownStatus = initial.status;
  const published = shownStatus === "published";

  // ---- editing --------------------------------------------------------------
  // Nothing saves until the floppy disk. Close the app (or lose the lock) and the edits are dropped.
  const latest = useRef(draft);

  const stopEditing = useCallback(
    (message: string | null) => {
      setEditing(false);
      setDirty(false);
      setSelectedId(null);
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
    setDirty(false);
    setShowPublished(false);
    setEditing(true);
  }, [initial.id, router]);

  /** The floppy disk: save to the draft and go back to view mode. */
  const saveAndStop = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const res = await saveDraft(initial.id, latest.current);
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

  // Keep the lock while editing. If it went (e.g. the phone slept past the 2-minute timeout and the
  // other worship leader started), the edits can't be saved: say so and go back to view mode.
  useEffect(() => {
    if (!editing) return;
    const id = initial.id;
    const lost = () => stopEditing("You were away long enough for the session to be unlocked, so your unsaved changes were dropped.");
    const beat = setInterval(async () => {
      if (!(await renewLock(id))) lost();
    }, LOCK_RENEW_MS);
    const onVisible = async () => {
      if (document.visibilityState === "visible" && !(await renewLock(id))) lost();
    };
    // Closing the tab or app: nothing is saved, and the session is unlocked straight away.
    const onHide = () => navigator.sendBeacon(`/api/sessions/${id}/release`);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onHide);
    };
  }, [editing, initial.id, stopEditing]);

  // Following a link elsewhere in the app with unsaved changes: ask about saving first.
  useEffect(() => {
    if (!editing || !dirty) return;
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
  }, [editing, dirty]);

  // Left the page some other way (e.g. the back button) while editing: drop the edits and unlock.
  const editingRef = useRef(editing);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
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

  async function revert() {
    if (!confirm("Undo all your unpublished changes? The draft goes back to a copy of the published version.")) return;
    setBusy(true);
    setError(null);
    const res = await revertToPublished(initial.id);
    setBusy(false);
    if (!res.ok) return setError(res.message);
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
      if (!item || item.kind !== "song") return;
      if (item.song_id) showDetail(item.song_id);
      else if (editing) {
        setDetailId(null);
        setQuery(item.title);
      }
    },
    [editing, showDetail],
  );

  const updateItem = useCallback(
    (id: string, patch: Partial<PlanItem>) =>
      change((p) => p.map((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))),
    [change],
  );

  const toggleOpen = useCallback(
    (item: PlanItem) => {
      const opening = !openIds.has(item.id);
      setOpenIds((o) => {
        const next = new Set(o);
        if (opening) next.add(item.id);
        else next.delete(item.id);
        return next;
      });
      if (opening) select(item);
      else if (selectedId === item.id) setSelectedId(null);
    },
    [openIds, select, selectedId],
  );

  /** The session's worship leaders and vocalists. */
  const singers: Singer[] = useMemo(
    () =>
      initial.band
        .filter((m) => m.role === "worship leader" || m.role === "vocalist")
        .map((m) => ({ id: m.id, name: m.name, role: m.role })),
    [initial.band],
  );

  const tags = useMemo(
    () => [...new Set(plan.flatMap((s) => s.items.flatMap((i) => (i.sequence ?? []).flatMap((st) => st.tags))))].sort(),
    [plan],
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
    setOpenIds((o) => new Set(o).add(item.id));
    select(item);
  }

  function add(what: "song" | "transition" | "section") {
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
    });
    showDetail(song.id);
    setMobileOpen(false);
  }

  const api: EditorApi = {
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
    tags,
    myRole: initial.myRole,
    // Songsheets are made for the published plan, so only shown while that's what's on the page.
    sheetsFor: published && !editing && !viewingRevision ? initial.id : null,
    sheetKeys: initial.sheetKeys,
  };

  const target = editing && selected?.kind === "song" ? { label: `song ${numbers[selected.id]}`, songId: selected.song_id } : null;
  const otherEditor = !editing && initial.lockedBy ? initial.lockedBy.name : null;

  const panel = (
    <SongBankPanel
      bank={bank}
      canBrowse={canBrowse}
      query={query}
      onQuery={setQuery}
      detailId={detailId}
      onDetail={showDetail}
      detail={detailId ? details[detailId] : undefined}
      target={target}
      onUse={applySong}
      onMinimise={() => {
        setMinimised(true);
        setMobileOpen(false);
      }}
      focusSearch={focusSearch}
      defaultLanguage={initial.service.startsWith("em_") ? "en" : initial.service.startsWith("cm_") ? "zh" : ""}
    />
  );

  return (
    <div className={`grid gap-4 ${minimised ? "lg:grid-cols-[minmax(0,1fr)_2.75rem]" : "lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]"}`}>
      {/* The session being built */}
      <div className="min-w-0 space-y-4">
        <Link href={canEdit ? "/sessions/build" : "/sessions"} className="block w-fit text-sm text-muted hover:text-foreground">
          ← {canEdit ? "Build session" : "Sessions"}
        </Link>

        {/* Phones: date, rehearsal, title, badges and buttons each get a line of their own. */}
        <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
          <div className="min-w-0 sm:flex-1">
            <p className="text-sm font-medium text-muted">
              {formatDate(initial.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              {initial.rehearsalDate && (
                <span className="block sm:inline">
                  <span className="hidden sm:inline"> · </span>
                  Rehearsal {formatDate(initial.rehearsalDate, { weekday: "short", day: "numeric", month: "short" })}
                </span>
              )}
            </p>
            <div className="flex flex-col gap-x-2 gap-y-1.5 sm:flex-row sm:flex-wrap sm:items-center">
              <h1 className="font-display text-3xl font-semibold">{initial.serviceName}</h1>
              <div className="flex items-center gap-2">
                <StageBadge stage={shownStatus} />
                {published && revision && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Unpublished changes</span>
                )}
                {editing && <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">Editing</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                {dirty && <span className="text-xs text-muted">Unsaved changes</span>}
                <IconButton label="Stop editing" onClick={() => (dirty ? setLeaving({ href: null }) : void discardAndStop())} disabled={busy}>
                  <path d="M18 6 6 18M6 6l12 12" />
                </IconButton>
                <IconButton label={published ? "Save changes to the revised draft" : "Save changes to the draft"} onClick={() => void saveAndStop()} disabled={busy} primary>
                  {/* Floppy disk */}
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                  <path d="M17 21v-8H7v8M7 3v5h8" />
                </IconButton>
                <AddMenu onAdd={add} />
              </>
            ) : (
              <>
                <IconButton label={simple ? "Show full view" : "Show simplified view"} onClick={toggleSimple} pressed={simple}>
                  {/* Eye */}
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </IconButton>
                {canEdit && (
                <>
                  {published && revision && (
                    <IconButton label="Undo unpublished changes (back to the published version)" onClick={revert} disabled={busy || Boolean(otherEditor)}>
                      {/* Arrow back to the original */}
                      <path d="M3 7v6h6" />
                      <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
                    </IconButton>
                  )}
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

        {editing && published && (
          <p className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-muted">
            You&apos;re editing the revised draft. The band keeps seeing the published version until you publish your changes.
          </p>
        )}
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

        {initial.band.length > 0 && (
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

        {!editing && simple ? (
          <SimplePlan plan={plan} leadName={(id) => (id ? (singers.find((x) => x.id === id)?.name ?? null) : null)} highlight={initial.myRole} />
        ) : (
          <>
            {!editing && <PartCues role={initial.myRole} cues={partCues(plan.flatMap((sec) => sec.items), initial.myRole)} />}
            <PlanEditor plan={plan} api={api} />
          </>
        )}

        {leaving && (
          <SavePrompt
            busy={busy}
            onSave={async () => {
              if ((await saveAndStop()) && leaving.href) router.push(leaving.href);
            }}
            onDiscard={async () => {
              const href = leaving.href;
              await discardAndStop();
              if (href) router.push(href);
            }}
            onKeep={() => setLeaving(null)}
          />
        )}

        {!editing && !viewingRevision && initial.updatedBy && (
          <p className="text-xs text-muted">
            Last changed by {initial.updatedBy} on {new Date(initial.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        )}
      </div>

      {/* Song bank: a column on wide screens, a sheet on phones */}
      <aside className="hidden lg:block">
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
            panel
          )}
        </div>
      </aside>
      <div className="lg:hidden">
        {mobileOpen ? (
          <div className="fixed inset-0 z-40 flex flex-col bg-black/40 pt-16" onClick={(e) => e.target === e.currentTarget && setMobileOpen(false)}>
            <div className="min-h-0 flex-1 p-2">{panel}</div>
          </div>
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
    </div>
  );
}
