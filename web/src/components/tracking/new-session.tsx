"use client";

import { useEffect, useRef, useState } from "react";
import { createRecord } from "@/app/(app)/sessions/tracking/actions";
import { RecordForm } from "@/components/tracking/record-form";
import type { BankSong } from "@/components/sessions/song-bank-panel";

const input =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

/**
 * Pending page, top right: a dark "+" that adds a whole new session to tracking by hand (one that
 * wasn't on a roster). A dialog asks for its date, kind (the team's regular sessions, or Other), EM
 * or CM for an Other session on teams that split them, and its name, then the usual band, songs,
 * links and comments.
 */
export function NewSessionButton({
  kinds,
  ministry,
  today,
  bank,
}: {
  /** The team's regular kinds of session, with their names (e.g. Youth: Saturday Service). */
  kinds: { value: string; name: string }[];
  /** The team splits sessions into EM and CM. */
  ministry: boolean;
  today: string;
  bank: BankSong[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState(kinds[0]?.value ?? "custom");
  const [em, setEm] = useState<"em" | "cm" | "any">("any");
  const [name, setName] = useState("");
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
  }, [open]);
  const regularName = kinds.find((k) => k.value === kind)?.name;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDate(today);
          setKind(kinds[0]?.value ?? "custom");
          setEm("any");
          setName("");
          setOpen(true);
        }}
        aria-label="New session"
        title="New session"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink text-xl text-ink-foreground hover:bg-ink/90"
      >
        +
      </button>
      {open && (
        <dialog
          ref={ref}
          aria-labelledby="new-session-title"
          onClose={() => setOpen(false)}
          className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-2xl bg-surface p-0 text-foreground shadow-2xl"
        >
          <div className="space-y-5 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="new-session-title" className="text-lg font-semibold">
                  New session
                </h2>
                <p className="text-sm text-muted">A session that wasn&apos;t on a roster. It goes straight into tracking.</p>
              </div>
              <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded-md px-2 py-1 text-muted hover:bg-background hover:text-foreground">
                ×
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-medium">
                Date
                <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={input} />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Session
                <select value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
                  {kinds.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.name}
                    </option>
                  ))}
                  <option value="custom">Other (ad-hoc)</option>
                </select>
              </label>
              {kind === "custom" && ministry && (
                <label className="space-y-1 text-sm font-medium">
                  Ministry
                  <select value={em} onChange={(e) => setEm(e.target.value as "em" | "cm" | "any")} className={input}>
                    <option value="any">EM and CM</option>
                    <option value="em">EM</option>
                    <option value="cm">CM</option>
                  </select>
                </label>
              )}
              <label className="space-y-1 text-sm font-medium">
                Name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={regularName ?? "e.g. Christmas Eve Service"}
                  required={kind === "custom"}
                  className={input}
                />
              </label>
            </div>
            <RecordForm
              // A Sunday service has a closing song; start the songs afresh when the kind changes.
              key={kind}
              kind={kind}
              band={{}}
              songs={[]}
              links={[]}
              comments=""
              bank={bank}
              submitLabel="Save to tracking"
              onSubmit={(rec) => createRecord({ date, kind, ministry: em, serviceName: name || regularName || "" }, rec)}
              onCancel={() => ref.current?.close()}
              onSaved={() => ref.current?.close()}
            />
          </div>
        </dialog>
      )}
    </>
  );
}
