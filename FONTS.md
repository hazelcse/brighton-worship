# Fonts

These fonts were chosen by the project owner. **Don't change them as a side effect of other
work.** If a change really needs a different font or weight, ask the owner first, or at least
say clearly in your summary which font changed, where and why.

| Where | Font | Weight / style | Set in |
|---|---|---|---|
| Body text, buttons, forms (everything by default) | Geist | Regular | `web/src/app/layout.tsx` (`--font-geist-sans`) |
| Headings, the "Brighton Worship" logo, display text (`font-display`) | Cormorant Garamond | 500 and 600 loaded | `web/src/app/layout.tsx` (`--font-display`) |
| Navbar "Brighton Worship" logo (top bar and mobile sidebar) | Cormorant Garamond | Medium (500), `font-medium` | `web/src/components/app-nav.tsx` |
| Home page greeting "Hi (name)," | Cormorant Garamond | Medium (500), `font-medium` | `web/src/app/(app)/home/page.tsx` |
| Plan the roster › "1. Sessions to plan": service names ("EM Sunday Service") | Geist (default) | Medium, **13px** (`text-[13px] font-medium`) | `web/src/components/roster/session-planner.tsx` |
| Home page countdown number ("12", "Today") | **Libre Baskerville** | Semibold (600), upright (not italic) | `web/src/components/countdown-number.tsx` |

## Past decisions

- The countdown once used a random display font on each visit; the owner replaced it with one
  fixed font (Libre Baskerville). It must not change between visits.
- Italic styles are not wanted for the countdown number.
- The greeting was semibold, then regular, and the owner settled on medium.
- The navbar logo was is medium.
- 11 Nov 2026: service names in "1. Sessions to plan" were 16px; the owner asked for 13px. The rows' spacing was tightened at the same time.
