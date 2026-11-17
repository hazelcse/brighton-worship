import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeLoader } from "@/components/home-loader";
import { AutoRefresh } from "@/components/auto-refresh";
import { HomeView } from "../home/home-view";

export const metadata: Metadata = { title: "Home · Brighton Media" };

/**
 * The media teams' home: like the worship teams' (a countdown to their next session, notices, then
 * the session's card), with the crew in place of the band.
 */
export default function MediaPage() {
  return (
    <>
      <AutoRefresh />
      <Suspense fallback={<HomeLoader kind="media" className="py-24" />}>
        <HomeView kind="media" />
      </Suspense>
    </>
  );
}
