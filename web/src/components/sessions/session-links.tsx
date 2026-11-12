"use client";

import { LinkDialog, LinkList } from "@/components/sessions/plan-editor";
import type { PlanLink } from "@/lib/session-plan";

/** Which session link the popup is for: its index, or "new". null = no popup. */
export type SessionLinkEdit = number | "new" | null;

/**
 * Links for the whole session (a reference playlist, the run sheet), above the plan. Hidden when
 * there are none; while editing, each can be edited or deleted, and more added (also from the + menu).
 */
export function SessionLinks({
  links,
  editing,
  dialog,
  onDialog,
  onChange,
}: {
  links: PlanLink[];
  editing: boolean;
  dialog: SessionLinkEdit;
  onDialog: (d: SessionLinkEdit) => void;
  onChange: (links: PlanLink[]) => void;
}) {
  return (
    <>
      {links.length > 0 && (
        // Opens and closes like Band. Starts closed to read, open to edit (so a link just added shows).
        <details key={editing ? "editing" : "viewing"} open={editing} className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm">
          <summary className="cursor-pointer font-medium">Session links ({links.length})</summary>
          <div className="mt-2 space-y-1.5">
            <LinkList
              links={links}
              onEdit={editing ? (i) => onDialog(i) : undefined}
              onRemove={editing ? (i) => onChange(links.filter((_, j) => j !== i)) : undefined}
            />
            {editing && (
              <button type="button" onClick={() => onDialog("new")} className="rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-background hover:text-foreground">
                + New link
              </button>
            )}
          </div>
        </details>
      )}
      {editing && dialog !== null && (
        <LinkDialog
          initial={dialog === "new" ? null : (links[dialog] ?? null)}
          onClose={() => onDialog(null)}
          onSave={(link) => {
            onChange(dialog === "new" ? [...links, link] : links.map((l, j) => (j === dialog ? link : l)));
            onDialog(null);
          }}
        />
      )}
    </>
  );
}
