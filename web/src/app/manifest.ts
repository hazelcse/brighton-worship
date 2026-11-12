import type { MetadataRoute } from "next";

// Lets phones offer "Add to Home Screen" / "Install app". Icons come from scripts/make-app-icons.mjs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Brighton Worship",
    short_name: "Worship",
    description: "Rostering and songsheets for the Brighton worship team",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#14110f",
    theme_color: "#14110f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
