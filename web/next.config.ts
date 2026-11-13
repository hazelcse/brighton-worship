import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  experimental: {
    // Songsheet uploads go through a Server Action (several .docx files at once).
    serverActions: { bodySizeLimit: "50mb" },
    proxyClientMaxBodySize: "50mb",
  },
  partialPrefetching: true,
  // The Absences page used to live at /roster/schedule; keep old bookmarks working (query strings carry over).
  async redirects() {
    return [{ source: "/roster/schedule", destination: "/roster/absences", permanent: true }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
