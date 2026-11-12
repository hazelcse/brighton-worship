/** The Tracking page's "Export CSV": one row per session, every column, ready for Excel / Sheets. */
import { BAND_COLUMNS, MAX_LINKS, MAX_SONGS, MINISTRY_TEXT, songSlots, type SessionRecord } from "./tracking";

const SONG_FIELDS = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "key", label: "Key" },
  { key: "lead", label: "Lead Vox" },
] as const;

/** A CSV cell: quoted when needed; text a spreadsheet would run as a formula gets a leading '. */
function cell(v: string): string {
  const s = /^[=+@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function trackingCsv(records: SessionRecord[]): string {
  const header = [
    "Date",
    "Service",
    "Ministry",
    ...BAND_COLUMNS.map((c) => c.label),
    ...Array.from({ length: MAX_SONGS }, (_, i) => SONG_FIELDS.map((f) => `Song ${i + 1} ${f.label}`)).flat(),
    ...Array.from({ length: MAX_LINKS }, (_, i) => `Link ${i + 1}`),
    "Comments",
    "No session (reason)",
  ];
  const rows = records.map((r) => {
    const slots = songSlots(r.songs);
    return [
      r.date,
      r.serviceName,
      MINISTRY_TEXT[r.ministry],
      ...BAND_COLUMNS.map((c) => (r.band[c.key] ?? []).join(", ")),
      ...slots.flatMap((s) => SONG_FIELDS.map((f) => s?.[f.key] ?? "")),
      ...Array.from({ length: MAX_LINKS }, (_, i) => r.links[i] ?? ""),
      r.comments,
      r.cancelReason ?? "",
    ];
  });
  // The byte-order mark makes Excel read it as UTF-8 (curly quotes, accents…).
  return "﻿" + [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Save `records` as tracking-YYYY-MM-DD.csv in the browser. */
export function downloadTrackingCsv(records: SessionRecord[], today: string) {
  const url = URL.createObjectURL(new Blob([trackingCsv(records)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `tracking-${today}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
