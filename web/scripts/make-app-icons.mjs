// Renders the home-screen icons into web/public/icons/.
// Run from web/: node scripts/make-app-icons.mjs
// Uses the logo font (Cormorant Garamond 600, as on the landing page) on the ink background.
import { mkdir, writeFile } from "node:fs/promises";
import { createElement as h } from "react";
import { ImageResponse } from "next/og.js";

const INK = "#14110f";
const INK_FOREGROUND = "#f5efe6";

async function loadFont() {
  // Without a browser user agent Google Fonts serves TTF, which the renderer needs.
  const css = await (
    await fetch("https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600")
  ).text();
  const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
  if (!url) throw new Error("Couldn't find a TTF in the Google Fonts response");
  return (await fetch(url)).arrayBuffer();
}

function Icon({ size }) {
  return h(
    "div",
    {
      style: {
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: INK,
        backgroundImage: "radial-gradient(circle at center, rgba(180,83,9,0.35), transparent 70%)",
        color: INK_FOREGROUND,
        fontFamily: "Cormorant Garamond",
        fontWeight: 600,
        // Keep the letters inside the maskable safe zone (centre 80%).
        fontSize: size * 0.42,
        letterSpacing: -size * 0.01,
        paddingBottom: size * 0.04,
      },
    },
    "BW",
  );
}

const font = await loadFont();
const outDir = new URL("../public/icons/", import.meta.url);
await mkdir(outDir, { recursive: true });

for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  const res = new ImageResponse(h(Icon, { size }), {
    width: size,
    height: size,
    fonts: [{ name: "Cormorant Garamond", data: font, weight: 600, style: "normal" }],
  });
  await writeFile(new URL(name, outDir), Buffer.from(await res.arrayBuffer()));
  console.log("wrote", name);
}
