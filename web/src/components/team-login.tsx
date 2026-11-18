"use client";

import { useEffect, useState } from "react";
import { LoginButton } from "@/components/login-dialog";

const CYCLE_MS = 3000;

/**
 * The landing page title and log-in button. The title's second word cycles every three seconds
 * through the kinds of team that exist ("Brighton Worship" → "Brighton Media" → ...). It's only a
 * title: logging in opens the person's own team whichever word is showing (see signIn).
 */
export function TeamLogin({ words, children }: { words: string[]; children?: React.ReactNode }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (words.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % words.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [words.length]);

  const word = words[index] ?? "Worship";

  return (
    <>
      <h1 className="relative text-center font-display text-6xl font-semibold leading-none tracking-tight sm:text-8xl lg:text-9xl">
        Brighton
        <span key={word} className="block italic motion-safe:animate-[quarter-flip_180ms_ease-out]">
          {word}
        </span>
      </h1>
      {children}
      <div className="relative mt-12">
        <LoginButton />
      </div>
    </>
  );
}
