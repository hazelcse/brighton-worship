"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ROLE_LABEL, formatDate } from "@/lib/roster";
import type { CoverDetail, SwapOption } from "@/lib/serving";
import { acceptSwap, declineSwap, proposeSwap, refuseCover, takeOver, type ServeResult } from "@/app/(app)/roster/serving-actions";

const when = (date: string) => formatDate(date, { weekday: "short", day: "numeric", month: "short" });
const part = (role: string) => ROLE_LABEL[role] ?? role;
const btn = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium disabled:opacity-50";

/**
 * Beside the calendar: someone's request to cover their session. The viewer can take over
 * (replace them) or swap (they take one of the viewer's sessions back, once both agree the date).
 */
/** Each session's date and its rehearsal's. */
const allDates = (xs: { date: string; rehearsal?: string | null }[]) => xs.flatMap((x) => [x.date, ...(x.rehearsal ? [x.rehearsal] : [])]);

export function CoverPanel({ cover, onFocus }: { cover: CoverDetail; onFocus: (options: string[], selected: string[]) => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"choose" | "swap">("choose");
  const [offer, setOffer] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ServeResult | null>(null);
  const incoming = cover.proposals.filter((p) => !p.byMe);
  const waiting = cover.proposals.find((p) => p.byMe);

  const run = (fn: () => Promise<ServeResult>, leave = false) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok && leave) router.push("/roster");
      else if (r.ok) {
        setMode("choose");
        setOffer(null);
        onFocus([], []);
        router.refresh();
      }
    });

  const pick = (o: SwapOption) => {
    setOffer(o.id);
    onFocus(allDates(cover.swapOptions), [o.date, ...(o.rehearsal ? [o.rehearsal] : [])]);
  };

  return (
    <section aria-label="Cover request" className="rounded-xl border-2 border-orange-300 bg-orange-50/60">
      <div className="space-y-1 border-b border-orange-200 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-orange-800">Asked you directly</p>
        <h2 className="text-lg font-semibold">
          {cover.from.name} needs {part(cover.role)} covered
        </h2>
        {cover.alsoTake.length > 0 && (
          <p className="text-sm font-medium text-orange-800">
            Nobody else in the band can do {cover.alsoTake.map(part).join(" or ")}, so you&apos;d take over {cover.alsoTake.map(part).join(" and ")} too.
          </p>
        )}
        <p className="text-sm">
          {cover.session.name}, {when(cover.session.date)}
          {cover.session.rehearsal && <span className="text-muted"> · rehearsal {when(cover.session.rehearsal)}</span>}
        </p>
      </div>

      <div className="space-y-3 p-4">
        {!cover.canCover ? (
          <p className="text-sm text-muted">{cover.whyNot}</p>
        ) : (
          <>
            {incoming.map((p) => (
              <div key={p.id} className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
                <p>
                  <span className="font-medium">{cover.from.name}</span> proposes a swap: you take their {part(cover.role)} on{" "}
                  <span className="font-medium">{when(cover.session.date)}</span>, they take your {part(p.offer.role)} on{" "}
                  <span className="font-medium">{when(p.offer.date)}</span> ({p.offer.name}).
                </p>
                <div className="flex gap-2">
                  <button type="button" disabled={pending} onClick={() => run(() => acceptSwap(p.id), true)} className={`${btn} bg-ink text-ink-foreground hover:bg-ink/90`}>
                    Approve swap
                  </button>
                  <button type="button" disabled={pending} onClick={() => run(() => declineSwap(p.id))} className={`${btn} border border-border bg-surface`}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
            {waiting && (
              <p className="rounded-lg border border-border bg-surface p-3 text-sm">
                You proposed swapping for your {part(waiting.offer.role)} on <span className="font-medium">{when(waiting.offer.date)}</span>. Waiting
                for {cover.from.name} to approve.
              </p>
            )}

            {mode === "choose" ? (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={pending} onClick={() => run(() => takeOver(cover.id), true)} className={`${btn} bg-ink text-ink-foreground hover:bg-ink/90`}>
                  Take over
                </button>
                <button
                  type="button"
                  disabled={pending || !cover.swapOptions.length}
                  onClick={() => {
                    setMode("swap");
                    onFocus(allDates(cover.swapOptions), []);
                  }}
                  className={`${btn} border border-ink bg-surface hover:bg-ink hover:text-ink-foreground`}
                >
                  {waiting || incoming.length ? "Propose a date" : "Swap"}
                </button>
                <p className="col-span-2 text-xs text-muted">
                  <span className="font-medium text-foreground">Take over:</span> you replace {cover.from.name} on {when(cover.session.date)}.{" "}
                  <span className="font-medium text-foreground">Swap:</span> {cover.from.name} takes one of your sessions in return, once you both agree
                  the date.
                  {!cover.swapOptions.length && ` None of your sessions can be swapped with ${cover.from.name}.`}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium">Which of your sessions would {cover.from.name} take?</p>
                <ul className="max-h-56 space-y-1 overflow-y-auto">
                  {cover.swapOptions.map((o) => (
                    <li key={o.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${offer === o.id ? "border-sky-400 bg-sky-50" : "border-border bg-surface"}`}
                      >
                        <input type="radio" name="offer" aria-label={`${when(o.date)}, ${o.name}, ${part(o.role)}`} checked={offer === o.id} onChange={() => pick(o)} />
                        <span>
                          <span className="font-medium">{when(o.date)}</span> · {o.name} · {part(o.role)}
                          {o.rehearsal && <span className="text-muted"> · rehearsal {when(o.rehearsal)}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("choose");
                      setOffer(null);
                      onFocus([], []);
                    }}
                    className={`${btn} border border-border bg-surface`}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={pending || !offer}
                    onClick={() => run(() => proposeSwap({ coverId: cover.id, offerSessionId: offer! }))}
                    className={`${btn} bg-ink text-ink-foreground hover:bg-ink/90`}
                  >
                    Propose swap
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {cover.direct && (
          <button type="button" disabled={pending} onClick={() => run(() => refuseCover(cover.id), true)} className="text-sm text-muted underline-offset-2 hover:underline">
            I can&apos;t cover this
          </button>
        )}
        {result && (
          <p role="status" className={`text-sm ${result.ok ? "text-emerald-700" : "text-danger"}`}>
            {result.message}
          </p>
        )}
        <Link href="/roster" className="block text-sm text-muted hover:text-foreground">
          ← Back to requests
        </Link>
      </div>
    </section>
  );
}
