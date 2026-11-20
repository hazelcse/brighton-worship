"use client";

import { useEffect, useRef, useState } from "react";
import type { BankSongDetail } from "@/app/(app)/sessions/actions";
import { SequenceBuilder, SequenceView } from "@/components/sessions/sequence-builder";
import { TypeBadge } from "@/components/sessions/song-bank-panel";
import { SheetUploadDialog } from "@/components/sessions/sheet-upload-dialog";
import { PdfViewerDialog } from "@/components/songs/pdf-viewer-dialog";
import { MAJOR_KEYS, SONG_TYPE_LABEL, keyLabel, majorKey, ownSheetKeys, ownSheetShownKey, sheetKeyMismatch, stepsFrom, type PlanItem, type PlanLink, type PlanSection, type SongType } from "@/lib/session-plan";

const input =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
const label = "mb-1 block text-xs font-medium text-muted";
const smallBtn = "rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-background hover:text-foreground disabled:opacity-30";

/** A song number's circle on phones: praise / worship by colour (matching the type badges). */
const NUMBER_TYPE_BG: Record<SongType, string> = {
  praise: "bg-orange-600",
  worship: "bg-sky-600",
  praise_worship: "bg-violet-600",
};

/** How long a dragged song has to wait over another section before it moves there. */
const HOLD_MS = 700;

export type Singer = { id: string; name: string; role: string };

export type EditorApi = {
  /** The session's id (for attaching and opening the worship leader's own songsheets). */
  sessionId: string;
  editing: boolean;
  selectedId: string | null;
  onSelect: (item: PlanItem | null) => void;
  isOpen: (id: string) => boolean;
  toggleOpen: (item: PlanItem) => void;
  updateItem: (id: string, patch: Partial<PlanItem>) => void;
  removeItem: (id: string) => void;
  /** One place up/down (keyboard on the drag handle). */
  moveItem: (id: string, dir: -1 | 1) => void;
  /** Put an item at this position in this section. */
  moveTo: (id: string, sectionId: string, index: number) => void;
  renameSection: (id: string, name: string) => void;
  removeSection: (id: string) => void;
  moveSection: (id: string, dir: -1 | 1) => void;
  addItem: (kind: PlanItem["kind"], sectionId: string) => void;
  /** Open the song bank to search for this slot. */
  pickFromBank: (item: PlanItem) => void;
  details: Record<string, BankSongDetail | null | undefined>;
  /** Number of each song across the whole session (transitions aren't numbered). */
  numbers: Record<string, number>;
  /** The session's worship leaders and vocalists, who can lead a song. */
  singers: Singer[];
  /** The viewer's part in the session, so their instrument stands out in sequences. */
  myRole: string | null;
  /** Once the plan's published: the session's id, for its songsheets (one button per song under each set). */
  sheetsFor: string | null;
  /** Songs that change key: item id -> the keys their songsheets come in (see Workbench.sheetKeys). */
  sheetKeys: Record<string, string[]>;
};

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <circle cx="4" cy="4" r="1.6" />
      <circle cx="10" cy="4" r="1.6" />
      <circle cx="4" cy="10" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`transition ${open ? "rotate-180" : ""}`}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Dragging: reorder within a section; hold over another section to move into it
// ---------------------------------------------------------------------------

type DragState = { id: string; holdSection: string | null };

function useDrag(plan: PlanSection[], api: EditorApi) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const items = useRef(new Map<string, HTMLElement>());
  const sections = useRef(new Map<string, HTMLElement>());
  const planRef = useRef(plan);
  const apiRef = useRef(api);
  useEffect(() => {
    planRef.current = plan;
    apiRef.current = api;
  });
  const hold = useRef<{ section: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const lastY = useRef(0);

  const clearHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };

  /** Where the item would go in this section for the pointer at y (ignoring the item itself). */
  const indexAt = (sectionId: string, id: string, y: number) => {
    const sec = planRef.current.find((s) => s.id === sectionId);
    if (!sec) return 0;
    return sec.items.filter((i) => i.id !== id).filter((i) => {
      const r = items.current.get(i.id)?.getBoundingClientRect();
      return r ? r.top + r.height / 2 < y : false;
    }).length;
  };

  const sectionUnder = (x: number, y: number) => {
    for (const [id, el] of sections.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    lastY.current = e.clientY;
    setDrag({ id, holdSection: null });
  };

  // Follow the pointer on the window: the row moves in the page as it's reordered, which would
  // lose a pointer capture on the handle itself.
  const dragId = drag?.id ?? null;
  useEffect(() => {
    if (!dragId) return;
    const id = dragId;
    let holdShown: string | null = null;
    const showHold = (section: string | null) => {
      if (holdShown === section) return;
      holdShown = section;
      setDrag((d) => (d ? { ...d, holdSection: section } : d));
    };
    const onMove = (e: PointerEvent) => {
      lastY.current = e.clientY;
      const home = planRef.current.find((s) => s.items.some((i) => i.id === id));
      const over = sectionUnder(e.clientX, e.clientY);
      if (!home || !over) {
        clearHold();
        showHold(null);
        return;
      }
      if (over === home.id) {
        clearHold();
        showHold(null);
        const to = indexAt(home.id, id, e.clientY);
        if (to !== home.items.findIndex((i) => i.id === id)) apiRef.current.moveTo(id, home.id, to);
        return;
      }
      // Over another section: it only takes the song after a moment's hold.
      if (hold.current?.section === over) return;
      clearHold();
      hold.current = {
        section: over,
        timer: setTimeout(() => {
          hold.current = null;
          apiRef.current.moveTo(id, over, indexAt(over, id, lastY.current));
          showHold(null);
        }, HOLD_MS),
      };
      showHold(over);
    };
    const onUp = () => {
      clearHold();
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      clearHold();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragId]);

  return { drag, items, sections, onPointerDown };
}

type Drag = ReturnType<typeof useDrag>;

function Grip({ item, drag, api }: { item: PlanItem; drag: Drag; api: EditorApi }) {
  return (
    <button
      type="button"
      aria-label="Drag to move. Arrow keys move it up or down."
      title="Drag to move"
      onPointerDown={(e) => drag.onPointerDown(e, item.id)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          api.moveItem(item.id, e.key === "ArrowUp" ? -1 : 1);
        }
      }}
      className={`flex h-8 w-6 shrink-0 touch-none items-center justify-center rounded text-muted hover:bg-background hover:text-foreground ${
        drag.drag?.id === item.id ? "cursor-grabbing" : "cursor-grab"
      }`}
    >
      <GripIcon />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Song details
// ---------------------------------------------------------------------------

/** "Link 1: Live version", the name linking to the address; the address itself if it has no name. */
export function LinkList({ links, onEdit, onRemove }: { links: PlanLink[]; onEdit?: (i: number) => void; onRemove?: (i: number) => void }) {
  return (
    <ul className="space-y-1">
      {links.map((l, i) => (
        <li key={i} className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-muted">Link {i + 1}:</span>
          <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.url} className="min-w-0 flex-1 truncate underline underline-offset-2 hover:text-accent">
            {l.label || l.url}
          </a>
          {onEdit && (
            <button type="button" onClick={() => onEdit(i)} aria-label={`Edit link ${i + 1}`} title="Edit" className="rounded p-1 text-muted hover:bg-background hover:text-foreground">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          )}
          {onRemove && (
            <button type="button" onClick={() => onRemove(i)} aria-label={`Delete link ${i + 1}`} title="Delete" className="rounded p-1 text-muted hover:bg-background hover:text-danger">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Add or edit one link in a popup: Cancel leaves things as they were, Save puts it in. */
export function LinkDialog({ initial, onSave, onClose }: { initial: PlanLink | null; onSave: (link: PlanLink) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(initial?.label ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function save() {
    let address = url.trim();
    if (!address) return setError("Enter the link's address.");
    if (!/^https?:\/\//i.test(address)) address = `https://${address}`;
    try {
      new URL(address);
    } catch {
      return setError("That doesn't look like a web address.");
    }
    onSave({ label: name.trim().slice(0, 120), url: address.slice(0, 500) });
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="link-dialog-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="space-y-4 p-5"
      >
        <h2 id="link-dialog-title" className="font-display text-xl font-semibold">
          {initial ? "Edit link" : "New link"}
        </h2>
        <div>
          <label className={label} htmlFor="link-name">
            Name
          </label>
          <input id="link-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Live version" className={input} />
        </div>
        <div>
          <label className={label} htmlFor="link-url">
            Link
          </label>
          <input
            id="link-url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="https://…"
            inputMode="url"
            autoFocus
            className={input}
          />
          {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => ref.current?.close()} className="h-9 rounded-lg border border-border px-4 text-sm font-medium hover:border-accent/50">
            Cancel
          </button>
          <button type="submit" disabled={!url.trim()} className="h-9 rounded-lg bg-ink px-4 text-sm font-medium text-ink-foreground hover:bg-ink/90 disabled:opacity-40">
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}

function LinksField({ item, detail, api }: { item: PlanItem; detail: BankSongDetail | null | undefined; api: EditorApi }) {
  /** The link being edited in the popup: its index, or "new". */
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const fromSheet = detail?.links ?? [];
  const links = item.links ?? [];
  // No links left goes back to "not set", so the song's own links can be used again.
  const set = (next: PlanLink[]) => api.updateItem(item.id, { links: next.length ? next : null });
  return (
    <div className="space-y-2">
      {links.length > 0 && (
        <LinkList links={links} onEdit={(i) => setEditing(i)} onRemove={(i) => set(links.filter((_, j) => j !== i))} />
      )}
      <div className="flex flex-wrap gap-2">
        {!links.length && (
          <button
            type="button"
            disabled={!fromSheet.length}
            title={fromSheet.length ? undefined : item.song_id ? "This song has no links" : "Pick a song from the song bank first"}
            onClick={() => set(fromSheet.map((l) => ({ ...l })))}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-40"
          >
            Use song&apos;s links{fromSheet.length ? ` (${fromSheet.length})` : ""}
          </button>
        )}
        <button type="button" onClick={() => setEditing("new")} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent">
          + New link
        </button>
      </div>
      {editing !== null && (
        <LinkDialog
          initial={editing === "new" ? null : (links[editing] ?? null)}
          onClose={() => setEditing(null)}
          onSave={(link) => {
            set(editing === "new" ? [...links, link] : links.map((l, j) => (j === editing ? link : l)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function KeySelect({ id, value, onChange, className, label }: { id?: string; value: string | null; onChange: (key: string | null) => void; className: string; label?: string }) {
  const key = majorKey(value);
  return (
    <select id={id} aria-label={label} value={key ?? ""} onChange={(e) => onChange(e.target.value || null)} className={className}>
      <option value="">—</option>
      {MAJOR_KEYS.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
  );
}

/**
 * The song's key, and a Transpose button for a song that changes key partway (e.g. E -> G): it
 * adds a second key, and the song shows as "E→G" with songsheets in both keys.
 */
function KeyField({ item, api }: { item: PlanItem; api: EditorApi }) {
  // Open while choosing the second key, before one is picked.
  const [adding, setAdding] = useState(false);
  const transposing = adding || item.transpose_to !== null;
  const small = "h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
  return (
    <div className="space-y-1.5">
      {transposing ? (
        <div className="flex items-center gap-1">
          <KeySelect
            id={`key-${item.id}`}
            label="From key"
            value={item.key}
            onChange={(key) => api.updateItem(item.id, { key, ...(key && majorKey(key) === majorKey(item.transpose_to) ? { transpose_to: null } : {}) })}
            className={small}
          />
          <span aria-hidden className="text-muted">
            →
          </span>
          <KeySelect
            label="To key"
            value={item.transpose_to}
            onChange={(to) => api.updateItem(item.id, { transpose_to: to && majorKey(to) !== majorKey(item.key) ? to : null })}
            className={small}
          />
        </div>
      ) : (
        <KeySelect id={`key-${item.id}`} value={item.key} onChange={(key) => api.updateItem(item.id, { key })} className={input} />
      )}
      <button
        type="button"
        disabled={!item.key && !transposing}
        title={item.key ? undefined : "Choose the key first"}
        onClick={() => {
          if (transposing) {
            setAdding(false);
            api.updateItem(item.id, { transpose_to: null });
          } else setAdding(true);
        }}
        className="text-xs font-medium text-accent hover:underline disabled:text-muted disabled:no-underline"
      >
        {transposing ? "Remove key change" : "+ Transpose"}
      </button>
    </div>
  );
}

function LeadSelect({ item, api, id }: { item: PlanItem; api: EditorApi; id: string }) {
  const known = !item.lead_id || api.singers.some((s) => s.id === item.lead_id);
  return (
    <select id={id} value={item.lead_id ?? ""} onChange={(e) => api.updateItem(item.id, { lead_id: e.target.value || null })} className={input}>
      <option value="">—</option>
      {api.singers.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
          {s.role === "vocalist" ? " (vocalist)" : ""}
        </option>
      ))}
      {!known && <option value={item.lead_id!}>Not on this session any more</option>}
    </select>
  );
}

/**
 * Where an attached songsheet opens. A Word sheet comes transposed to the song's key (or `key`, the
 * key a song that changes key goes to), so that key (as on the page, maybe not saved yet) and the key
 * it's written in go in the address.
 */
export function uploadSrc(sessionId: string, item: PlanItem, key: string | null = item.key): string {
  const sheet = item.sheet!;
  const base = `/api/sessions/${sessionId}/uploads/${sheet.id}`;
  if (!sheet.transposable || !sheet.key || !key) return base;
  return `${base}?key=${encodeURIComponent(key)}&from=${encodeURIComponent(sheet.key)}`;
}

function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 15V4m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

/**
 * The key a worship leader's own songsheet shows as (a Word sheet: the song's key, as it's
 * transposed), or for a sheet uploaded before sheets had their own key, the song's key.
 */
export const ownSheetKey = (item: PlanItem) =>
  // A Word sheet covering the song's key change in one copy (written E→F#, sung F→G) shows as "F→G".
  ownSheetKeys(item).length === 1 ? keyLabel(item.key, item.transpose_to) : (ownSheetShownKey(item) ?? keyLabel(item.key, item.transpose_to));

/** A worship leader's own songsheet in another key than the song (e.g. a sheet in E, sung in F). */
function SheetKeyNote({ item }: { item: PlanItem }) {
  const sheetKey = sheetKeyMismatch(item);
  if (!sheetKey) return null;
  return (
    <p role="note" className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-1.5 text-xs text-amber-900">
      The songsheet is in {sheetKey}, but the song is in {keyLabel(item.key, item.transpose_to)}.
    </p>
  );
}

/** The worship leader's own songsheet on a song: its file and key, to open, replace or take off. */
function AttachedSheet({ item, api, onReplace }: { item: PlanItem; api: EditorApi; onReplace?: () => void }) {
  /** The key being viewed in ("" for the one key a PDF comes in), while the viewer's open. */
  const [viewing, setViewing] = useState<string | null>(null);
  if (!item.sheet) return null;
  const sheet = item.sheet;
  const shownKey = ownSheetKey(item);
  // A Word sheet for a song that changes key (C→E) comes in both keys.
  const keys = ownSheetKeys(item);
  const views = keys.length > 1 ? keys : [""];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
      <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
        <SheetIcon />
        <span className="truncate" title={sheet.file_name}>
          {sheet.file_name}
        </span>
        {!onReplace && shownKey && keys.length < 2 && <span className="shrink-0 rounded bg-background px-1.5 text-xs font-medium">{shownKey}</span>}
      </span>
      {onReplace && (
        // The key the sheet is written in (a Word sheet is transposed from it to the song's key; a PDF
        // is shown in it). Changeable in case it was read or typed wrong.
        <label className="inline-flex items-center gap-1 text-xs text-muted">
          Written in
          <select
            aria-label="Key the songsheet is written in"
            value={sheet.key ?? ""}
            onChange={(e) => api.updateItem(item.id, { sheet: { ...sheet, key: e.target.value || null } })}
            className="h-7 rounded-md border border-border bg-surface px-1 text-xs text-foreground outline-none focus:border-accent"
          >
            <option value="">—</option>
            {MAJOR_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      )}
      {views.map((k) => (
        <button key={k} type="button" onClick={() => setViewing(k)} className="text-xs font-medium text-accent hover:underline">
          {k ? `View in ${k}` : "View"}
        </button>
      ))}
      {onReplace && (
        <>
          <button type="button" onClick={onReplace} className="text-xs font-medium text-accent hover:underline">
            Replace
          </button>
          <button type="button" onClick={() => api.updateItem(item.id, { sheet: null })} className="text-xs font-medium text-muted hover:text-danger">
            Remove
          </button>
        </>
      )}
      {viewing !== null && (
        <PdfViewerDialog
          src={uploadSrc(api.sessionId, item, viewing || item.key)}
          title={`${item.title || "Songsheet"}${(viewing || shownKey) ? ` (${viewing || shownKey})` : ""}`}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function SongEditor({ item, api }: { item: PlanItem; api: EditorApi }) {
  const detail = item.song_id ? api.details[item.song_id] : null;
  const n = api.numbers[item.id];
  const [uploading, setUploading] = useState(false);
  /** What the last .docx filled in, to say so under the song. */
  const [filled, setFilled] = useState<string[]>([]);
  const sheetSteps = item.sheet?.sequence?.length ? stepsFrom(item.sheet.sequence) : [];
  return (
    <div className="space-y-4 border-t border-border bg-background/60 p-4">
      <div className="max-w-xs">
        <label className={label} htmlFor={`lead-${item.id}`}>
          Lead
        </label>
        <LeadSelect item={item} api={api} id={`lead-${item.id}`} />
      </div>
      <div>
        <label className={label} htmlFor={`title-${item.id}`}>
          Song
        </label>
        <div className="flex gap-2">
          <input id={`title-${item.id}`} value={item.title} onChange={(e) => api.updateItem(item.id, { title: e.target.value })} placeholder="Song title" className={input} />
          <button
            type="button"
            onClick={() => api.pickFromBank(item)}
            aria-label={item.song_id ? undefined : "Search song bank"}
            title={item.song_id ? undefined : "Search song bank"}
            className={`flex shrink-0 items-center justify-center rounded-lg bg-ink text-sm font-medium text-ink-foreground hover:bg-ink/90 ${item.song_id ? "px-3" : "w-10"}`}
          >
            {item.song_id ? (
              "Change"
            ) : (
              // Just a magnifying glass; the label is for screen readers and the hover tooltip.
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            )}
          </button>
          {/* Not in the song bank: the worship leader's own songsheet (PDF or .docx). */}
          <button
            type="button"
            onClick={() => setUploading(true)}
            aria-label="Upload your own songsheet"
            title="Upload your own songsheet (PDF or Word)"
            className="flex w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-foreground hover:border-accent hover:text-accent"
          >
            <UploadIcon />
          </button>
        </div>
      </div>
      {uploading && (
        <SheetUploadDialog
          sessionId={api.sessionId}
          item={item}
          onClose={() => setUploading(false)}
          onAttached={(patch, names) => {
            api.updateItem(item.id, patch);
            setFilled(names);
          }}
        />
      )}
      {item.sheet && (
        <div className="-mt-2 space-y-1">
          <AttachedSheet item={item} api={api} onReplace={() => setUploading(true)} />
          <SheetKeyNote item={item} />
          {filled.length > 0 && <p className="text-xs text-muted">Filled in from the songsheet: {filled.join(", ")}. Check them below.</p>}
        </div>
      )}
      <p className="-mt-2 text-xs text-muted">
        {item.sheet ? (
          "Your own songsheet: the band sees this file, as it is, once the session is published."
        ) : item.song_id ? (
          <>
            From the song bank. Change any detail below for this session.{" "}
            <button type="button" onClick={() => api.updateItem(item.id, { song_id: null })} className="underline underline-offset-2">
              Unlink
            </button>
          </>
        ) : (
          `Search the song bank to fill in song ${n ?? ""}'s details, upload your own songsheet, or type them in.`
        )}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className={label} htmlFor={`type-${item.id}`}>
            Type
          </label>
          <select id={`type-${item.id}`} value={item.type ?? ""} onChange={(e) => api.updateItem(item.id, { type: (e.target.value || null) as SongType | null })} className={input}>
            <option value="">—</option>
            {(Object.keys(SONG_TYPE_LABEL) as SongType[]).map((t) => (
              <option key={t} value={t}>
                {SONG_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor={`key-${item.id}`}>
            Key
          </label>
          <KeyField item={item} api={api} />
        </div>
        <div>
          <label className={label} htmlFor={`bpm-${item.id}`}>
            BPM
          </label>
          <input
            id={`bpm-${item.id}`}
            type="number"
            inputMode="decimal"
            min={1}
            max={399}
            value={item.bpm ?? ""}
            onChange={(e) => api.updateItem(item.id, { bpm: e.target.value === "" ? null : Number(e.target.value) })}
            className={input}
          />
        </div>
        <div>
          <label className={label} htmlFor={`artist-${item.id}`}>
            Artist
          </label>
          <input id={`artist-${item.id}`} value={item.artist ?? ""} onChange={(e) => api.updateItem(item.id, { artist: e.target.value || null })} className={input} />
        </div>
      </div>
      <div>
        <span className={label}>Sequence</span>
        <SequenceBuilder
          key={item.id}
          steps={item.sequence ?? []}
          onChange={(sequence) => api.updateItem(item.id, { sequence })}
          scanned={detail?.elements ?? item.sheet?.sections ?? []}
          presets={[{ label: item.sheet ? "Use songsheet's sequence" : "Use song's sequence", steps: detail?.steps ?? sheetSteps }]}
          custom={item.custom_elements}
          onCustom={(custom_elements) => api.updateItem(item.id, { custom_elements })}
          // This song's own tags only (its sequence here and its standard one), not other songs'.
          tagSuggestions={[...new Set([...(item.sequence ?? []), ...(detail?.steps ?? [])].flatMap((s) => s.tags))]}
        />
      </div>
      {/* More room above Links (24px): the sequence builder ends in its own row of buttons. */}
      <div className="pt-3">
        <span className={label}>Links</span>
        <LinksField item={item} detail={detail} api={api} />
      </div>
      <div>
        <label className={label} htmlFor={`notes-${item.id}`}>
          Notes
        </label>
        <textarea
          id={`notes-${item.id}`}
          rows={2}
          value={item.notes}
          onChange={(e) => api.updateItem(item.id, { notes: e.target.value })}
          placeholder="e.g. Start with keys only, drums in at the chorus"
          className={`${input} h-auto py-2`}
        />
      </div>
    </div>
  );
}

/** An open song in view mode: everything apart from what the closed row already shows. */
function SongDetails({ item, api }: { item: PlanItem; api: EditorApi }) {
  const myRole = api.myRole;
  const facts = [
    item.artist && ["Artist", item.artist],
    item.bpm && ["BPM", String(item.bpm)],
  ].filter(Boolean) as [string, string][];
  return (
    <div className="space-y-3 border-t border-border bg-background/60 px-4 py-3 text-sm">
      {facts.length > 0 && (
        <dl className="flex flex-wrap gap-x-5 gap-y-1">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt className="inline text-muted">{k}: </dt>
              <dd className="inline font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Sequence</p>
        <SequenceView steps={item.sequence ?? []} highlight={myRole} />
      </div>
      {item.links && item.links.length > 0 && <LinkList links={item.links} />}
      {item.notes && <p className="whitespace-pre-line">{item.notes}</p>}
      {/* Once published it's with the set's songsheets; before then, the worship leaders can open it here. */}
      {item.sheet && !api.sheetsFor && <AttachedSheet item={item} api={api} />}
      <SheetKeyNote item={item} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function ItemRow({ item, api, drag }: { item: PlanItem; api: EditorApi; drag: Drag }) {
  const open = api.isOpen(item.id);
  const dragging = drag.drag?.id === item.id;
  const ref = (el: HTMLLIElement | null) => {
    if (el) drag.items.current.set(item.id, el);
    else drag.items.current.delete(item.id);
  };
  const lift = dragging ? "relative z-10 shadow-lg ring-2 ring-accent/40" : "";

  if (item.kind === "transition") {
    return (
      <li ref={ref} className={`rounded-lg border border-dashed border-border bg-surface ${lift}`}>
        <div className="flex items-center gap-2 px-2 py-1.5">
          {api.editing ? <Grip item={item} drag={drag} api={api} /> : <span aria-hidden className="w-6 text-center text-muted">↓</span>}
          {api.editing ? (
            <>
              <input
                value={item.notes}
                onChange={(e) => api.updateItem(item.id, { notes: e.target.value })}
                onFocus={() => api.onSelect(item)}
                placeholder="Transition, e.g. Pad holds in D while WL prays"
                aria-label="Transition"
                className="h-8 min-w-0 flex-1 bg-transparent text-sm italic outline-none"
              />
              <button type="button" aria-label="Remove transition" onClick={() => api.removeItem(item.id)} className={`${smallBtn} hover:text-danger`}>
                ✕
              </button>
            </>
          ) : (
            <p className="min-w-0 flex-1 py-1 text-sm italic text-muted">
              Transition{item.notes ? `: ${item.notes}` : ""}
            </p>
          )}
        </div>
      </li>
    );
  }

  const lead = item.lead_id ? api.singers.find((s) => s.id === item.lead_id)?.name : null;
  const sheetOff = sheetKeyMismatch(item);
  const selected = api.selectedId === item.id;
  return (
    <li ref={ref} className={`overflow-hidden rounded-lg border bg-surface transition-shadow ${selected && api.editing ? "border-accent" : "border-border"} ${lift}`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        {api.editing && <Grip item={item} drag={drag} api={api} />}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => api.toggleOpen(item)}
          className={`flex min-w-0 flex-1 items-center gap-3 rounded-md py-1 text-left ${api.editing ? "" : "pl-1"}`}
        >
          {/* On phones the number's circle shows praise / worship by colour, in place of the badge. */}
          <span
            title={item.type ? SONG_TYPE_LABEL[item.type] : undefined}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-ink-foreground sm:bg-ink ${item.type ? NUMBER_TYPE_BG[item.type] : "bg-ink"}`}
          >
            {api.numbers[item.id]}
            {item.type && <span className="sr-only sm:hidden"> ({SONG_TYPE_LABEL[item.type]})</span>}
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span className={`font-medium ${item.title ? "" : "text-muted"}`}>{item.title || (api.editing ? "Choose a song" : "Song to be chosen")}</span>
            {item.key && <span className="font-medium"> ({keyLabel(item.key, item.transpose_to)})</span>}
            {sheetOff && (
              <span title={`The songsheet is in ${sheetOff}`} className="ml-1.5 rounded bg-amber-100 px-1 text-xs font-medium text-amber-900">
                sheet in {sheetOff}
              </span>
            )}
            {lead && <span className="hidden text-muted sm:inline"> - {lead}</span>}
          </span>
          {lead && <span className="max-w-[35%] shrink-0 truncate text-xs text-muted sm:hidden">{lead}</span>}
          <span className="hidden sm:contents">
            <TypeBadge type={item.type} />
          </span>
          <span className="shrink-0 text-muted">
            <ChevronIcon open={open} />
          </span>
        </button>
        {api.editing && (
          <button type="button" aria-label="Remove song" onClick={() => api.removeItem(item.id)} className={`${smallBtn} hover:text-danger`}>
            ✕
          </button>
        )}
      </div>
      {open && (api.editing ? <SongEditor item={item} api={api} /> : <SongDetails item={item} api={api} />)}
    </li>
  );
}

function SheetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}

/**
 * A button per song with a songsheet, opening it in the session's key: under each set in the full
 * view, and every song's at the bottom of the simplified view (with its own `className`).
 */
export function SectionSongsheets({
  sessionId,
  items,
  sheetKeys,
  className = "mt-3 border-t border-border pt-3",
}: {
  sessionId: string;
  items: PlanItem[];
  sheetKeys: Record<string, string[]>;
  className?: string;
}) {
  // A song that changes key gets a second sheet (`to`) unless its songsheet already covers the change.
  type Sheet = { item: PlanItem; key: string | null; label: string | null; to: boolean };
  const [open, setOpen] = useState<Sheet | null>(null);
  const songs = items.filter((i) => i.kind === "song" && (i.song_id || i.sheet));
  if (!songs.length) return null;
  const sheets: Sheet[] = songs.flatMap((i) => {
    // The worship leader's own songsheet: a PDF as it is, labelled with the key it's written in; a
    // Word sheet in the song's key, plus a second copy in the key it changes to (C→E), like a bank song's.
    if (!i.song_id) {
      const own = ownSheetKeys(i);
      if (own.length > 1) return own.map((k, n) => ({ item: i, key: k, label: k, to: n > 0 }));
      return [{ item: i, key: i.key, label: ownSheetKey(i), to: false }];
    }
    const keys = sheetKeys[i.id];
    if (!keys) return [{ item: i, key: i.key, label: i.key, to: false }];
    // One sheet covering both keys is labelled "E→G"; otherwise one in E and one in G.
    if (keys.length === 1) return [{ item: i, key: i.key, label: keyLabel(i.key, i.transpose_to), to: false }];
    return [
      { item: i, key: i.key, label: i.key, to: false },
      { item: i, key: i.transpose_to, label: i.transpose_to, to: true },
    ];
  });
  return (
    <div className={className}>
      <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted">Songsheets</p>
      <div className="flex flex-wrap gap-2">
        {sheets.map((sh) => (
          <button
            key={`${sh.item.id}${sh.to ? "-to" : ""}`}
            type="button"
            onClick={() => setOpen(sh)}
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm hover:border-accent hover:text-accent"
          >
            <SheetIcon />
            <span className="truncate">{sh.item.title}</span>
            {sh.label && <span className="shrink-0 rounded bg-background px-1.5 text-xs font-medium">{sh.label}</span>}
          </button>
        ))}
      </div>
      {open && (
        <PdfViewerDialog
          src={
            open.item.sheet && !open.item.song_id
              ? uploadSrc(sessionId, open.item, open.key)
              : // The key is in the address so a changed key never shows the old sheet.
                `/api/sessions/${sessionId}/songsheets/${open.item.id}?key=${encodeURIComponent(open.key ?? "")}${open.to ? "&to=1" : ""}`
          }
          title={`${open.item.title}${open.label ? ` (${open.label})` : ""}`}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

export function PlanEditor({ plan, api }: { plan: PlanSection[]; api: EditorApi }) {
  const drag = useDrag(plan, api);
  if (!plan.length) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
        {api.editing ? "No sections yet. Use + to add a section." : "Nothing planned yet."}
      </p>
    );
  }
  return (
    <div className={`space-y-4 ${drag.drag ? "select-none" : ""}`}>
      {plan.map((s, si) => {
        const holding = drag.drag?.holdSection === s.id;
        return (
          <section
            key={s.id}
            ref={(el) => {
              if (el) drag.sections.current.set(s.id, el);
              else drag.sections.current.delete(s.id);
            }}
            aria-label={s.name}
            className={`relative overflow-hidden rounded-xl border p-3 transition-colors sm:p-4 ${holding ? "border-accent bg-accent/5" : "border-border bg-surface/60"}`}
          >
            {holding && <span aria-hidden className="absolute inset-x-0 top-0 h-1 origin-left animate-[hold_700ms_linear_forwards] bg-accent" />}
            <div className="mb-2 flex items-center gap-2">
              {api.editing ? (
                <>
                  <input
                    value={s.name}
                    onChange={(e) => api.renameSection(s.id, e.target.value)}
                    aria-label="Section name"
                    data-section-name={s.id}
                    className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold uppercase tracking-wider outline-none hover:border-border focus:border-accent"
                  />
                  <button type="button" aria-label="Move section up" disabled={si === 0} onClick={() => api.moveSection(s.id, -1)} className={smallBtn}>
                    ↑
                  </button>
                  <button type="button" aria-label="Move section down" disabled={si === plan.length - 1} onClick={() => api.moveSection(s.id, 1)} className={smallBtn}>
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!s.items.length || confirm(`Delete "${s.name}" and everything in it?`)) api.removeSection(s.id);
                    }}
                    className={`${smallBtn} hover:text-danger`}
                  >
                    Delete
                  </button>
                </>
              ) : (
                <h2 className="px-1 text-sm font-semibold uppercase tracking-wider text-muted">{s.name}</h2>
              )}
            </div>
            {s.items.length ? (
              <ol className="space-y-2">
                {s.items.map((item) => (
                  <ItemRow key={item.id} item={item} api={api} drag={drag} />
                ))}
              </ol>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted">
                {api.editing ? "Drag a song here, or add one below." : "Nothing in this section yet."}
              </p>
            )}
            {api.sheetsFor && <SectionSongsheets sessionId={api.sheetsFor} items={s.items} sheetKeys={api.sheetKeys} />}
            {api.editing && (
              <div className="mt-2 flex gap-3 px-1">
                <button type="button" onClick={() => api.addItem("song", s.id)} className="text-xs font-medium text-accent hover:underline">
                  + Song
                </button>
                <button type="button" onClick={() => api.addItem("transition", s.id)} className="text-xs font-medium text-accent hover:underline">
                  + Transition
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
