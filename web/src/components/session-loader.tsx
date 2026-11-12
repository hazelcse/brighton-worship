/**
 * Session pages' loading indicator: three little song sheets, each writing in its three lines in
 * turn (like a session's plan being written out), with "Loading" and dots underneath (the same
 * dots as NoteLoader). Sized and coloured like the other loaders (30px tall, foreground/70; the
 * sheets match CalendarLoader's pages). All CSS (see .session-loader in globals.css): it fades in
 * only after 300ms, so quick loads show nothing, and with "reduce motion" on, the lines stay drawn.
 */

const LINE_WIDTHS = ["100%", "70%", "88%"];

export function SessionLoader({ label = "Loading", className = "" }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`session-loader flex flex-col items-center justify-center gap-3 text-muted ${className}`}>
      <div aria-hidden className="flex items-end gap-3 text-foreground/70">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex h-[30px] w-[24px] flex-col justify-center gap-[4px] rounded-[3px] border-[1.5px] border-current px-[4px]"
          >
            {LINE_WIDTHS.map((width, j) => (
              <span
                key={j}
                className="session-loader-line block h-[2px] rounded-full bg-current"
                style={{ width, animationDelay: `${i * 0.35 + j * 0.12}s` }}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="text-sm">
        {label}
        <span aria-hidden className="note-loader-dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </p>
    </div>
  );
}
