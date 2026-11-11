import { Libre_Baskerville } from "next/font/google";

/** Only the home page's countdown uses it, so it's not preloaded on every page. */
const baskerville = Libre_Baskerville({ weight: "600", style: "normal", subsets: ["latin"], preload: false });

/**
 * The big countdown number on the home page ("12", "Today"), always in Libre Baskerville
 * semibold (600), upright.
 *
 * FONT CHOSEN BY THE OWNER: don't change it without asking them (see FONTS.md at the repo root).
 */
export function CountdownNumber({ children }: { children: React.ReactNode }) {
  return <span className={`${baskerville.className} text-6xl leading-none`}>{children}</span>;
}
