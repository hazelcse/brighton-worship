# Fonts

These fonts were chosen by the project owner. **Don't change them as a side effect of other
work.** If a change really needs a different font or weight, ask the owner first, or at least
say clearly in your summary which font changed, where and why.

| Where | Font | Weight / style | Set in |
|---|---|---|---|
| Body text, buttons, forms (everything by default) | Geist | Regular | `web/src/app/layout.tsx` (`--font-geist-sans`) |
| Headings, the "Brighton Worship" logo, display text (`font-display`) | Cormorant Garamond | 500 and 600 loaded, normal and italic | `web/src/app/layout.tsx` (`--font-display`) |
| Navbar "Brighton Worship" logo (top bar and mobile sidebar) | Cormorant Garamond | Medium (500), `font-medium` | `web/src/components/app-nav.tsx` |
| Home page greeting "Hi (name)," | Cormorant Garamond | Medium (500), `font-medium` | `web/src/app/(app)/home/page.tsx` |
| Plan the roster › "1. Sessions to plan": service names ("EM Sunday Service") | Geist (default) | Medium, **13px** (`text-[13px] font-medium`) | `web/src/components/roster/session-planner.tsx` |
| Login page title's cycling word ("Worship" / "Media", under "Brighton") | Cormorant Garamond | Semibold (600), **italic**; "Brighton" stays upright | `web/src/components/team-login.tsx` |
| Home page countdown number ("12", "Today") | **Libre Baskerville** | Semibold (600), upright (not italic) | `web/src/components/countdown-number.tsx` |

## Past decisions

- The countdown once used a random display font on each visit; the owner replaced it with one
  fixed font (Libre Baskerville). It must not change between visits.
- Italic styles are not wanted for the countdown number.
- The greeting was semibold, then regular, and the owner settled on medium.
- The navbar logo was is medium.
- 11 Nov 2026: service names in "1. Sessions to plan" were 16px; the owner asked for 13px. The rows' spacing was tightened at the same time.
- 20 Nov 2026: free text in sequences (| Transpose to E |: the builder, and the session's full and
  simplified views) is 13px, a little bigger than
  the 12px notes and element pills but under the 14px body text, at the owner's request.
- 20 Nov 2026: notes in song sequences (the builder, the session's full and simplified views,
  Show changes) are slanted 7° (the `slant` class, a skew) instead of `italic`, at the owner's
  request for a less slanted italic. Geist has no italic face, so browsers make one up at about
  twice that angle and ignore `font-style: oblique 7deg`. The typing cursor stays upright.
- 25 Nov 2026: notes typed in the sequence builder are 13px, the same as its free text (they were
  12px), at the owner's request. Still muted and slanted 7°. The read-only views are unchanged.
- 26 Nov 2026: in the simplified view, step comments and notes in a sequence (before / after an
  element, loose text, <notes> in free text) are 14px, the same as the elements (they were 12px),
  at the owner's request. Still muted and slanted.
- 26 Nov 2026: in the simplified view, free text (| Transpose to E |) and the song's notes (now a
  dot list where lines start "• ", under a bold "Notes:" on its own line) are 14px, the same as the elements, at the
  owner's request. Free text stays 13px in the builder and the full view.
- 26 Nov 2026: the simplified view now looks like the copied email in Gmail, at the owner's
  request: Arial at Gmail's Normal size, 13px (it was 14px), #222 text; section names bold and
  underlined at that size (were 16px); song lines bold (were semibold); comments Gmail's grey
  (#666666), still slanted 7° rather than italic; bars, tags and repeats in the text colour.
  Everything in it (elements, free text, comments, notes) is 13px.
- 26 Nov 2026: then 14px, slightly bigger, at the owner's request (the copied email stays at Gmail's 13px).
- 18 Nov 2026: the login title's cycling word ("Worship" / "Media") made italic at the owner's request; Cormorant Garamond's italic is now loaded for it.
