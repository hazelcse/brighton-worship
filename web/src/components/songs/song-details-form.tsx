"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { saveLinks, updateSongDetails, type SaveState } from "@/app/(app)/songs/actions";
import { LinkRows, type SongLink } from "@/components/songs/song-links";
import { SequenceBuilder } from "@/components/sessions/sequence-builder";
import { songSteps, type SeqStep } from "@/lib/session-plan";

type Song = {
  id: string;
  title: string;
  artist: string | null;
  type: "praise" | "worship" | "praise_worship" | null;
  type_is_estimate: boolean;
  bpm: number | null;
  time_signature: string | null;
  language: "en" | "zh";
  sections: string[];
  standard_sequence: string[];
  standard_steps: unknown;
  themes: string[];
  original_key: string | null;
  notes: string;
};

const input =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
const chip = "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium";

const COMMON_SECTIONS = ["Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge", "Interlude", "Instrumental", "Music", "Tag", "Vamp", "Outro"];

export function SongDetailsForm({
  song,
  links,
  canEditDetails,
  canEditLinks,
}: {
  song: Song;
  links: SongLink[];
  canEditDetails: boolean;
  canEditLinks: boolean;
}) {
  // One save for everything shown. Links go first: they're the likelier to be refused (a bad
  // address), and then nothing is saved.
  const [state, action, pending] = useActionState(
    async (prev: SaveState, formData: FormData): Promise<SaveState> => {
      if (canEditLinks) {
        const r = await saveLinks(song.id, prev, formData);
        if (!r.ok) return r;
      }
      if (canEditDetails) {
        const r = await updateSongDetails(song.id, prev, formData);
        if (!r.ok) return r;
      }
      return { ok: true, message: "Saved." };
    },
    { ok: false, message: null } as SaveState,
  );
  const [linkRows, setLinkRows] = useState<SongLink[]>(links);

  const router = useRouter();
  const pathname = usePathname();
  const formRef = useRef<HTMLFormElement>(null);

  // Saved: back to the view state. (Leaving without saving just drops the edits.)
  useEffect(() => {
    if (state.ok) router.replace(pathname, { scroll: false });
  }, [state, router, pathname]);

  // On phones the Details card sits below the songsheet, so bring it into view when editing starts.
  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) formRef.current?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const [sections, setSections] = useState<string[]>(song.sections);
  const [sequence, setSequence] = useState<SeqStep[]>(() => songSteps(song.standard_steps, song.standard_sequence));
  const [themes, setThemes] = useState<string[]>(song.themes);
  const [newSection, setNewSection] = useState("");
  const [newTheme, setNewTheme] = useState("");

  function addSection(name: string) {
    const n = name.trim();
    if (n && !sections.includes(n)) setSections([...sections, n]);
    setNewSection("");
  }
  function addTheme() {
    const parts = newTheme.split(",").map((t) => t.trim()).filter(Boolean);
    setThemes([...new Set([...themes, ...parts])]);
    setNewTheme("");
  }

  return (
    <form ref={formRef} action={action} className="space-y-6">
      {canEditDetails && (
        <>
          <input type="hidden" name="sections" value={JSON.stringify(sections)} />
          <input type="hidden" name="standard_steps" value={JSON.stringify(sequence)} />
          <input type="hidden" name="themes" value={JSON.stringify(themes)} />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium sm:col-span-2">
              Title
              <input name="title" defaultValue={song.title} required className={input} />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Artist
              <input name="artist" defaultValue={song.artist ?? ""} className={input} />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Type
              <select name="type" defaultValue={song.type ?? ""} className={input}>
                <option value="">Not set</option>
                <option value="praise">Praise (fast)</option>
                <option value="praise_worship">Praise / Worship (middle)</option>
                <option value="worship">Worship (slow)</option>
              </select>
              {song.type_is_estimate && song.type && (
                <span className="block text-xs font-normal text-muted">Estimated from the tempo. Saving confirms it.</span>
              )}
            </label>
            <label className="space-y-1 text-sm font-medium">
              Tempo (bpm)
              <input name="bpm" type="number" step="0.5" min="20" max="300" defaultValue={song.bpm ?? ""} className={input} />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Time signature
              <input name="time_signature" placeholder="4/4" defaultValue={song.time_signature ?? ""} className={input} />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Language
              <select name="language" defaultValue={song.language} className={input}>
                <option value="en">English</option>
                <option value="zh">Chinese</option>
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Original key
              <input name="original_key" placeholder="e.g. B (Male)" defaultValue={song.original_key ?? ""} className={input} />
            </label>
          </div>

          {/* Sections */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Sections</legend>
            <div className="flex flex-wrap gap-1.5">
              {sections.length === 0 && <span className="text-sm text-muted">None yet.</span>}
              {sections.map((s) => (
                <span key={s} className={`${chip} border-border bg-background`}>
                  {s}
                  <button
                    type="button"
                    aria-label={`Remove ${s}`}
                    onClick={() => {
                      setSections(sections.filter((x) => x !== s));
                      setSequence(sequence.filter((x) => x.name !== s));
                    }}
                    className="text-muted hover:text-danger"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSection(newSection);
                  }
                }}
                list="common-sections"
                placeholder="Add a section, e.g. Verse 3"
                className={input}
              />
              <datalist id="common-sections">
                {COMMON_SECTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <button type="button" onClick={() => addSection(newSection)} className="rounded-lg border border-border px-3 text-sm hover:bg-background">
                Add
              </button>
            </div>
          </fieldset>

          {/* Standard sequence */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Standard sequence</legend>
            <p className="text-xs text-muted">
              Click sections to build the sequence. Click a step to repeat it, tag it (High, Half-time or your own) or link the instruments to bring out
              there. Session plans start from this sequence.
            </p>
            <SequenceBuilder
              steps={sequence}
              onChange={setSequence}
              scanned={sections}
              presets={[]}
              custom={[]}
              onCustom={(added) => setSections([...new Set([...sections, ...added])])}
              tagSuggestions={[...new Set(sequence.flatMap((x) => x.tags))]}
            />
          </fieldset>

          {/* Themes */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Themes</legend>
            <div className="flex flex-wrap gap-1.5">
              {themes.length === 0 && <span className="text-sm text-muted">None yet.</span>}
              {themes.map((t) => (
                <span key={t} className={`${chip} border-border bg-background`}>
                  {t}
                  <button type="button" aria-label={`Remove ${t}`} onClick={() => setThemes(themes.filter((x) => x !== t))} className="text-muted hover:text-danger">
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newTheme}
                onChange={(e) => setNewTheme(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTheme();
                  }
                }}
                placeholder="e.g. Grace, Cross, Thanksgiving"
                className={input}
              />
              <button type="button" onClick={addTheme} className="rounded-lg border border-border px-3 text-sm hover:bg-background">
                Add
              </button>
            </div>
          </fieldset>
        </>
      )}

      {canEditLinks && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Reference links</legend>
          <input type="hidden" name="links" value={JSON.stringify(linkRows)} />
          {linkRows.length === 0 && <p className="text-sm text-muted">None yet.</p>}
          <LinkRows rows={linkRows} onChange={setLinkRows} />
        </fieldset>
      )}

      {canEditDetails && (
        <label className="block space-y-1 text-sm font-medium">
          Additional notes
          <textarea
            name="notes"
            defaultValue={song.notes}
            rows={4}
            maxLength={4000}
            placeholder="Anything the team should know, e.g. arrangement tips, who usually leads it, tricky transitions"
            className={`${input} resize-y font-normal`}
          />
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-ink-foreground transition hover:bg-ink/90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {state.message && (
          <p role="status" className={`text-sm ${state.ok ? "text-emerald-700" : "text-danger"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
