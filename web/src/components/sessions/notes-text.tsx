import { noteBlocks } from "@/lib/notes";

/** A song's notes: "• " lines as a dot list, other lines as written. Sized by the parent. */
export function NotesText({ notes, className = "" }: { notes: string; className?: string }) {
  const blocks = noteBlocks(notes);
  if (!blocks.length) return null;
  return (
    <div className={`space-y-1 ${className}`}>
      {blocks.map((b, i) =>
        b.kind === "list" ? (
          <ul key={i} className="list-disc space-y-0.5 pl-5">
            {b.items.map((t, j) => (
              <li key={j} className="whitespace-pre-line">
                {t}
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-line">
            {b.text}
          </p>
        ),
      )}
    </div>
  );
}
