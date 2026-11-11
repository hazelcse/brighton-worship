"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetAppData } from "@/app/actions/dev";

const WORD = "RESET";

/** Developers: wipe the app back to brand new (keeps the team). Asks them to type RESET first. */
export function ResetAppDataDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);

  const close = () => {
    if (pending) return;
    setTyped("");
    setMessage(null);
    onClose();
  };

  return (
    <dialog
      ref={ref}
      onClose={close}
      aria-labelledby="reset-app-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
    >
      <form
        className="space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await resetAppData(typed);
            if (r.ok) {
              setMessage({ ok: true, text: r.message ?? "The app is back to brand new." });
              setTyped("");
              router.refresh();
            } else setMessage({ ok: false, text: r.message ?? "The reset didn't go through." });
          });
        }}
      >
        <h2 id="reset-app-title" className="font-display text-2xl font-semibold text-danger">
          Reset app data
        </h2>
        <div className="space-y-2 text-sm">
          <p>This permanently deletes, for everyone:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>all rosters, sessions and session plans</li>
            <li>all absences, cover requests and swaps</li>
            <li>all notifications and updates</li>
            <li>the whole song library and its songsheet files</li>
          </ul>
          <p>
            Team accounts stay with their current settings. Everyone except root and developers goes back to the default password and chooses a
            new one when they next log in.
          </p>
          <p className="font-medium">This can&apos;t be undone.</p>
        </div>
        <label className="block space-y-1 text-sm">
          <span>
            Type <span className="font-mono font-semibold">{WORD}</span> to confirm
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 font-mono text-sm outline-none focus:border-danger focus:ring-2 focus:ring-danger/20"
          />
        </label>
        {message && (
          <p role="alert" className={`text-sm ${message.ok ? "text-emerald-700" : "text-danger"}`}>
            {message.text}
          </p>
        )}
        <div className="flex items-center gap-3 border-t border-border pt-4">
          <button
            type="submit"
            disabled={typed !== WORD || pending}
            className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50"
          >
            {pending ? "Resetting…" : "Reset everything"}
          </button>
          <button type="button" onClick={close} disabled={pending} className="text-sm text-muted">
            {message?.ok ? "Close" : "Cancel"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
