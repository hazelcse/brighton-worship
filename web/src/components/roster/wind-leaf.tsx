const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * "Nothing here": three gusts of wind (each ending in a curl) streaming left to right, and a leaf
 * carried along by them, tumbling as it goes, then drifting back in from the left. Drawn like the
 * loaders' symbols (line art in currentColor, foreground/70, a little taller than their 30px).
 * All CSS (see .wind-leaf in globals.css); with "reduce motion" on, it sits still.
 */
export function WindLeaf({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-muted ${className}`}>
      <svg aria-hidden width="88" height="40" viewBox="0 0 88 40" className="wind-leaf overflow-visible text-foreground/70">
        <path className="wind-leaf-gust" pathLength={100} d="M4 12h30c4 0 6.5-3 4.5-5.6-1.8-2.3-5.8-1.3-5.3 1.6" {...STROKE} />
        <path className="wind-leaf-gust" pathLength={100} d="M12 21h34c5 0 7.5 4 5 6.8-2 2.3-6 1.2-5.3-1.7" {...STROKE} />
        <path className="wind-leaf-gust" pathLength={100} d="M2 30h22c3.4 0 5.2 2.2 3.8 4.2-1.3 1.8-4.4 1.2-4-.9" {...STROKE} />
        {/* The leaf, drawn round its own middle so it spins about it. */}
        <g transform="translate(64 18)">
          <g className="wind-leaf-leaf">
            <path d="M-8 0C-5-6.5 4-7 8 0C4 7-5 6.5-8 0z" {...STROKE} fill="currentColor" fillOpacity="0.15" />
            <path d="M-11 1.6-8 0M-8 0 6.5-.3" {...STROKE} strokeWidth="1.2" />
          </g>
        </g>
      </svg>
      <p className="text-sm">{label}</p>
    </div>
  );
}
