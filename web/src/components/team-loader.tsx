/**
 * Team pages' loading indicator, a "roll call": three little people pop in one after another, then
 * all fade out and it starts again, with "Loading" and dots underneath (the same dots as
 * NoteLoader). Sized and coloured like NoteLoader's symbols (30px tall, foreground/70). All CSS
 * (see .team-loader in globals.css): it fades in only after 300ms, so quick loads show nothing,
 * and with "reduce motion" on, the people stay still.
 */

function Person() {
  return (
    <svg width="22" height="30" viewBox="0 0 22 30" fill="currentColor">
      <circle cx="11" cy="8" r="5.5" />
      <path d="M1 29c0-7 4.5-11.5 10-11.5S21 22 21 29z" />
    </svg>
  );
}

export function TeamLoader({ label = "Loading", className = "" }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`team-loader flex flex-col items-center justify-center gap-3 text-muted ${className}`}>
      <div aria-hidden className="flex items-end gap-3 text-foreground/70">
        {[0, 1, 2].map((i) => (
          <span key={i} className="team-loader-person block" style={{ animationDelay: `${i * 0.25}s` }}>
            <Person />
          </span>
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
