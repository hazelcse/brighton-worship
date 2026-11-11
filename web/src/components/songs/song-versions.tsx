"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { rescanVersion } from "@/app/(app)/songs/actions";
import { IssueList } from "@/components/songs/issue-list";
import { KeyEditor, type KeyInfo } from "@/components/songs/key-editor";
import { UploadDialog } from "@/components/songs/upload-dialog";

type Version = {
  id: string;
  file_name: string;
  key_display: string | null;
  alternate_keys: string[];
  scan_status: "pending" | "scanning" | "done" | "failed";
  scan_error: string | null;
  issues: { code: string; severity: "error" | "warning" | "info"; message: string }[];
  keyInfo: KeyInfo;
};

const KEY_ISSUE_CODES = new Set(["written_key_mismatch", "title_key_mismatch", "low_key_confidence"]);

/** The song's one songsheet (its base copy). Other keys come from the transposer. */
export function SongVersions({
  songId,
  version,
  canReplace,
  canRescan,
  canTranspose,
}: {
  songId: string;
  version: Version | null;
  canReplace: boolean;
  canRescan: boolean;
  canTranspose: boolean;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const v = version;
  const notes = v?.issues.filter((i) => i.severity === "info") ?? [];
  // Once the key is confirmed, the scanner's key warnings are settled.
  const warnings =
    v?.issues.filter((i) => i.severity !== "info" && !(v.keyInfo.confirmedAt && KEY_ISSUE_CODES.has(i.code))) ?? [];

  return (
    <section aria-labelledby="sheet-title" className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="sheet-title" className="text-lg font-semibold">
          Songsheet
        </h2>
        {canReplace && <UploadDialog songId={songId} label="Replace" variant="secondary" />}
      </div>

      {!v ? (
        <p className="text-sm text-muted">No songsheet yet.</p>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <KeyEditor songId={songId} versionId={v.id} info={v.keyInfo} canEdit={canRescan} />
            <p className="truncate text-xs text-muted" title={v.file_name}>
              {v.file_name}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/songsheets/${v.id}`}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-background"
            >
              Download
            </a>
            {canTranspose && v.scan_status === "done" && (
              <Link
                href={`/songs/transpose?song=${songId}`}
                className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-ink-foreground hover:bg-ink/90"
              >
                Transpose…
              </Link>
            )}
            {canRescan && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await rescanVersion(songId, v.id);
                    setMessage(r.message);
                  })
                }
                className="px-1 text-sm text-muted hover:text-foreground disabled:opacity-50"
              >
                {pending ? "Scanning…" : "Rescan"}
              </button>
            )}
          </div>

          {v.scan_status === "failed" && (
            <IssueList compact issues={[{ code: "scan_failed", severity: "error", message: v.scan_error ?? "The scan failed." }]} />
          )}
          {(v.scan_status === "pending" || v.scan_status === "scanning") && <p className="text-xs text-muted">Waiting to be scanned…</p>}
          <IssueList compact issues={warnings} />
          {notes.length > 0 && <p className="text-xs text-muted">{notes.map((n) => n.message).join(" ")}</p>}
          {message && (
            <p role="status" className="text-xs text-muted">
              {message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
