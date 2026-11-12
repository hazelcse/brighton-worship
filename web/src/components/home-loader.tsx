import type { CSSProperties, ReactNode } from "react";

/**
 * Home page's loading indicator: the band becomes a cross. A mic, keyboard, acoustic guitar,
 * electric guitar (or bass) and drums fly out from the middle to their places, hold, then gather
 * back into the middle and turn into a plain cross; the cross shrinks back into the middle as the
 * band flies out again, so it breathes in and out with no gap. "Loading" and dots underneath (the
 * same dots as NoteLoader). Sized and coloured like the other loaders (30px tall,
 * foreground/70). All CSS (see .home-loader in globals.css): it fades in only after 300ms, so quick
 * loads show nothing, and with "reduce motion" on, the band sits still and the cross isn't shown.
 */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const INSTRUMENTS: { name: string; width: number; svg: ReactNode }[] = [
  {
    name: "mic",
    width: 14,
    svg: (
      <>
        <circle cx="7" cy="7" r="6" fill="currentColor" />
        <path d="M1.6 7.5h10.8" stroke="var(--background)" strokeWidth="1" />
        <path d="M4 13.5h6l-1.4 14.5a1.6 1.6 0 0 1-3.2 0z" fill="currentColor" />
      </>
    ),
  },
  {
    name: "keyboard",
    width: 30,
    svg: (
      <>
        <rect x="1" y="13" width="28" height="15" rx="2" {...STROKE} />
        <path d="M5.7 21v7M10.3 21v7M15 21v7M19.7 21v7M24.3 21v7" {...STROKE} strokeWidth="1" />
        {[4.7, 9.3, 18.7, 23.3].map((x) => (
          <rect key={x} x={x} y="13" width="2" height="8" fill="currentColor" />
        ))}
      </>
    ),
  },
  {
    name: "acoustic guitar",
    width: 18,
    svg: (
      <>
        <path
          d="M9 12.5c-3 0-4 2.2-3.3 4.2.4 1.2-2.2 2.3-2.2 5.8 0 3.7 2.6 6 5.5 6s5.5-2.3 5.5-6c0-3.5-2.6-4.6-2.2-5.8.7-2-.3-4.2-3.3-4.2z"
          {...STROKE}
        />
        <circle cx="9" cy="19.6" r="1.7" fill="currentColor" />
        <path d="M7.3 25.2h3.4" {...STROKE} />
        <path d="M9 12.5V3" {...STROKE} strokeWidth="2" />
        <rect x="7.4" y="0.5" width="3.2" height="3.6" rx="0.8" fill="currentColor" />
      </>
    ),
  },
  {
    name: "electric guitar",
    width: 18,
    svg: (
      <>
        <path
          d="M6.2 16.2c-.6-2-2.6-2.3-2.8-.4-.2 1.6 1 2.6.2 4.2C2.7 21.8 2 23.6 2.8 25.8c1 2.6 4 3.4 6.8 3.2 3-.2 5.6-1.8 5.6-4.6 0-1.9-1.4-2.9-1.1-4.5.3-1.4 1.7-2.1 1.3-3.9-.4-1.6-2.3-1.4-3 .4-.8 1.6-5.6 1.5-6.2-.2z"
          fill="currentColor"
        />
        <path d="M6.4 22.6h5.2M6.4 25h5.2" stroke="var(--background)" strokeWidth="1" />
        <path d="M9 17V3.2" {...STROKE} strokeWidth="2" />
        <path d="M8 0.6l3.4 1.2-.6 2.8-2.8-.4z" fill="currentColor" />
      </>
    ),
  },
  {
    name: "drums",
    width: 30,
    svg: (
      <>
        <circle cx="12" cy="20.5" r="8" {...STROKE} />
        <circle cx="12" cy="20.5" r="2.2" fill="currentColor" />
        <rect x="6.5" y="6.5" width="11" height="5.5" rx="1.2" {...STROKE} />
        <path d="M26 9.5V29M23.5 29h5" {...STROKE} strokeWidth="1.2" />
        <ellipse cx="26" cy="8.6" rx="3.6" ry="1.1" fill="currentColor" />
      </>
    ),
  },
];

const GAP = 10;
const TOTAL = INSTRUMENTS.reduce((sum, i) => sum + i.width, 0) + GAP * (INSTRUMENTS.length - 1);

/** How far each instrument sits from the middle of the row: where it flies in from and back to. */
const OFFSETS = INSTRUMENTS.map((_, i) => {
  const left = INSTRUMENTS.slice(0, i).reduce((sum, x) => sum + x.width + GAP, 0);
  return TOTAL / 2 - (left + INSTRUMENTS[i].width / 2);
});

export function HomeLoader({ label = "Loading", className = "" }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`home-loader flex flex-col items-center justify-center gap-3 text-muted ${className}`}>
      <div aria-hidden className="relative flex h-[30px] items-end text-foreground/70" style={{ gap: GAP }}>
        {INSTRUMENTS.map((inst, i) => (
          <span
            key={inst.name}
            className="home-loader-instrument block"
            style={{ "--dx": `${OFFSETS[i]}px`, animationDelay: `${i * 0.12}s` } as CSSProperties}
          >
            <svg viewBox={`0 0 ${inst.width} 30`} width={inst.width} height="30" className="block overflow-visible">
              {inst.svg}
            </svg>
          </span>
        ))}
        {/* A plain (empty) Latin cross, one solid shape. */}
        <svg viewBox="0 0 20 30" width="20" height="30" className="home-loader-cross absolute bottom-0 left-1/2 -ml-[10px] block">
          <path d="M8.1 .5h3.8v7.2h7v3.8h-7v18h-3.8v-18h-7V7.7h7z" fill="currentColor" />
        </svg>
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
