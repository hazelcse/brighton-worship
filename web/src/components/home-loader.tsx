import type { CSSProperties, ReactNode } from "react";

/**
 * Home page's loading indicator: the band becomes a cross. A mic, keyboard, acoustic guitar,
 * electric guitar (or bass) and drums fly out from the middle to their places, hold, then gather
 * back into the middle and turn into a plain cross; the cross shrinks back into the middle as the
 * band flies out again, so it breathes in and out with no gap. "Loading" and dots underneath (the
 * same dots as NoteLoader). Sized and coloured like the other loaders (30px tall,
 * foreground/70). All CSS (see .home-loader in globals.css): it fades in only after 300ms, so quick
 * loads show nothing, and with "reduce motion" on, the band sits still and the cross isn't shown.
 * Media teams' home gets a crew instead of a band: movie cameras, stage lights and a clapperboard.
 */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

type Icon = { name: string; width: number; svg: ReactNode };

const INSTRUMENTS: Icon[] = [
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

/** A movie camera on a tripod: two film reels on top, lens to the right. */
const camera = (
  <>
    <circle cx="6" cy="7.5" r="4.5" {...STROKE} />
    <circle cx="6" cy="7.5" r="1.3" fill="currentColor" />
    <circle cx="15.5" cy="7.5" r="4.5" {...STROKE} />
    <circle cx="15.5" cy="7.5" r="1.3" fill="currentColor" />
    <rect x="1" y="13" width="19" height="10.5" rx="1.5" fill="currentColor" />
    <path d="M20 16.2l8.5-3v10.6l-8.5-3z" fill="currentColor" />
    <path d="M10.5 23.5L6 29.3M10.5 23.5L15 29.3M10.5 23.5v5.8" {...STROKE} strokeWidth="1.2" />
  </>
);

/** A stage spotlight on a stand, tilted up, with a few rays. */
const stageLight = (
  <>
    <g transform="rotate(-25 9 15)">
      <rect x="4.5" y="7" width="9" height="12" rx="1.5" fill="currentColor" />
      <rect x="3.3" y="4.6" width="11.4" height="2.8" rx="0.8" fill="currentColor" />
      <path d="M6 2.6L5 0.4M9 2.3V0M12 2.6l1-2.2" {...STROKE} strokeWidth="1.1" />
    </g>
    <path d="M3 13.5v4.5h12v-4.5" {...STROKE} strokeWidth="1.2" />
    <path d="M9 18v10.5M5 29h8" {...STROKE} />
  </>
);

/** A director's clapperboard, the clapper raised. */
const STRIPES = [3, 9, 15, 21];
const clapperboard = (
  <>
    <rect x="1" y="13" width="24" height="16" rx="1.5" {...STROKE} />
    <rect x="1" y="13" width="24" height="4" fill="currentColor" />
    {STRIPES.map((x) => (
      <path key={x} d={`M${x} 13h3l-2.4 4h-3z`} fill="var(--background)" />
    ))}
    <path d="M5 21.5h9M5 25h13" {...STROKE} strokeWidth="1" />
    <g transform="rotate(-20 1.5 12)">
      <rect x="1" y="8" width="24" height="4" rx="0.6" fill="currentColor" />
      {STRIPES.map((x) => (
        <path key={x} d={`M${x + 2} 8h3l-2.4 4h-3z`} fill="var(--background)" />
      ))}
    </g>
  </>
);

const CREW: Icon[] = [
  { name: "camera", width: 30, svg: camera },
  { name: "stage light", width: 18, svg: stageLight },
  { name: "clapperboard", width: 26, svg: clapperboard },
  { name: "stage light 2", width: 18, svg: <g transform="translate(18 0) scale(-1 1)">{stageLight}</g> },
  { name: "camera 2", width: 30, svg: <g transform="translate(30 0) scale(-1 1)">{camera}</g> },
];

const GAP = 10;

/** How far each icon sits from the middle of the row: where it flies in from and back to. */
function offsets(icons: Icon[]) {
  const total = icons.reduce((sum, i) => sum + i.width, 0) + GAP * (icons.length - 1);
  return icons.map((_, i) => {
    const left = icons.slice(0, i).reduce((sum, x) => sum + x.width + GAP, 0);
    return total / 2 - (left + icons[i].width / 2);
  });
}

const SETS = {
  worship: { icons: INSTRUMENTS, offsets: offsets(INSTRUMENTS) },
  media: { icons: CREW, offsets: offsets(CREW) },
};

export function HomeLoader({
  label = "Loading",
  className = "",
  kind = "worship",
}: {
  label?: string;
  className?: string;
  /** Which team's home: a band ("worship") or a media crew ("media"). */
  kind?: keyof typeof SETS;
}) {
  const { icons, offsets: OFFSETS } = SETS[kind];
  return (
    <div role="status" className={`home-loader flex flex-col items-center justify-center gap-3 text-muted ${className}`}>
      <div aria-hidden className="relative flex h-[30px] items-end text-foreground/70" style={{ gap: GAP }}>
        {icons.map((inst, i) => (
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
