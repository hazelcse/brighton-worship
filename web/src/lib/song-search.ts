/**
 * The song search shared by the Songs page and the session planner's song bank: title (or a Chinese
 * title typed in pinyin), artist, lyrics and BPM, ranked in that order. Runs in the browser.
 */

import { stemmer } from "stemmer";

export type SearchableSong = {
  id: string;
  title: string;
  artist: string | null;
  /** The lyric lines from its songsheet, one per line. */
  lyrics: string;
  /** Toneless pinyin of a Chinese title ("zhu ni shi wo li liang"), "" otherwise. */
  titlePinyin: string;
  bpm: number | null;
};

/** Text for matching: lower case, punctuation dropped, spaces collapsed ("Jesus, My" → "jesus my"). */
export const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Spaces dropped too, so "10000 reasons" finds "10,000 Reasons" and "jesusmy" finds "Jesus, My". */
const tight = (s: string) => s.replace(/ /g, "");

/**
 * A search as plain pinyin: tone marks and tone numbers dropped, ü / v as u
 * ("Zhǔ nǐ" / "zhu3 ni3" → "zhu ni", "lv" → "lu").
 */
const pinyinQuery = (q: string) =>
  q
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[0-9]/g, "")
    .replace(/v/g, "u")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Word variants: each English word cut to its stem with the Porter stemmer ("glory", "glories" →
 * "glori"; "glorious" → "gloriou"; "loving", "lovely" → "love"). Other words stay as they are.
 */
const stemWords = (text: string) => (text ? text.split(" ").map((w) => (/^[a-z]+$/.test(w) ? stemmer(w) : w)) : []);

/**
 * Whether a song word's stem is a variant of a search word's stem: it starts with it ("glori" →
 * "gloriou", "glorifi"), or the song's stem is most of a longer search stem ("gloriou" → "glori";
 * only for stems of 5+ letters, so searching "god" never finds every "go").
 */
const variant = (word: string, q: string) => word.startsWith(q) || (word.length >= 5 && q.length - word.length <= 3 && q.startsWith(word));

/** Whether these words hold variants of the search words, side by side ("rising sun" → "rise sun"). */
function hasVariants(words: string[], stems: string[]) {
  if (!stems.length || !words.length) return false;
  if (stems.length === 1) return words.some((w) => variant(w, stems[0]!));
  for (let i = 0; i + stems.length <= words.length; i++) {
    if (stems.every((q, j) => variant(words[i + j]!, q))) return true;
  }
  return false;
}

type Entry = {
  title: string;
  titleTight: string;
  artist: string;
  artistTight: string;
  lyrics: string;
  pinyin: string;
  pinyinTight: string;
  /** The title's and lyrics' words as stems, in order, for finding variants of words. */
  titleStems: string[];
  lyricStems: string[];
  /** The lyrics' distinct stems: quicker for a one-word search. */
  lyricStemSet: string[];
};
export type SongIndex = Map<string, Entry>;

/** Each song's title, artist and lyrics ready for matching (work it out once per song list). */
export function songIndex(songs: SearchableSong[]): SongIndex {
  return new Map(
    songs.map((s) => {
      const title = norm(s.title);
      const artist = norm(s.artist ?? "");
      const py = norm(s.titlePinyin ?? "");
      const lyrics = norm((s.lyrics ?? "").split("\n").filter((l) => l.trim()).join(" "));
      const lyricStems = stemWords(lyrics);
      return [
        s.id,
        {
          title,
          titleTight: tight(title),
          artist,
          artistTight: tight(artist),
          lyrics,
          pinyin: py,
          pinyinTight: tight(py),
          titleStems: stemWords(title),
          lyricStems,
          lyricStemSet: [...new Set(lyricStems)],
        },
      ];
    }),
  );
}

type Term = { q: string; qTight: string; digits: string; pyTight: string; stems: string[] };

function term(raw: string): Term | null {
  const q = norm(raw);
  if (!q) return null;
  const qTight = tight(q);
  const digits = /^\d+$/.test(qTight) ? qTight : "";
  return { q, qTight, digits, pyTight: tight(pinyinQuery(q)), stems: digits ? [] : stemWords(q) };
}

/** Where one search term matches a song: 0 title, 1 artist, 2 lyrics, 3 BPM, -1 nowhere. */
function termRank(ix: Entry, bpm: number | null, t: Term) {
  // A Chinese title typed in pinyin counts as a title match.
  if (ix.title.includes(t.q) || ix.titleTight.includes(t.qTight) || (!!ix.pinyin && !!t.pyTight && ix.pinyinTight.includes(t.pyTight))) return 0;
  if (hasVariants(ix.titleStems, t.stems)) return 0;
  if (ix.artist.includes(t.q) || (!!ix.artistTight && ix.artistTight.includes(t.qTight))) return 1;
  // A bare number is a BPM, not lyrics: "13" mustn't find a song through "John 6:13".
  if (!t.digits && ix.lyrics.includes(t.q)) return 2;
  // Variants of the words ("glory" finds "glorious").
  if (hasVariants(t.stems.length === 1 ? ix.lyricStemSet : ix.lyricStems, t.stems)) return 2;
  if (t.digits && bpm && String(bpm).startsWith(t.digits)) return 3;
  return -1;
}

/**
 * The songs matching a search, best first: title matches, then artist, then lyrics only, then BPM
 * only (each group keeps the order it came in). Words also find their variants ("glory" finds
 * "glorious", "loving" finds "love"). A number matches BPMs starting with it ("14" finds 140–149),
 * after everything else, so "10" still puts "10,000 Reasons" first; it never matches lyrics
 * (scripture references like "John 6:13" would). Punctuation and spacing don't matter.
 * Keywords joined with "+" ("love + honour + glory") must all match, each anywhere; a song ranks by
 * its weakest keyword. No search: every song, as it came. `lyricHit` / `bpmHit`: matched (in part)
 * only through those.
 */
export function searchSongs<T extends SearchableSong>(songs: T[], index: SongIndex, query: string) {
  const lyricHit = new Set<string>();
  const bpmHit = new Set<string>();
  const terms = query.split("+").map(term).filter((t): t is Term => t !== null);
  if (!terms.length) return { list: songs, lyricHit, bpmHit };
  const rank = new Map<string, number>();
  for (const s of songs) {
    const ix = index.get(s.id);
    if (!ix) continue;
    const ranks = terms.map((t) => termRank(ix, s.bpm, t));
    if (ranks.some((r) => r < 0)) continue;
    if (ranks.includes(2)) lyricHit.add(s.id);
    if (ranks.includes(3)) bpmHit.add(s.id);
    rank.set(s.id, Math.max(...ranks));
  }
  // Array.prototype.sort is stable, so each group stays in the order it came in.
  const list = songs.filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return { list, lyricHit, bpmHit };
}
