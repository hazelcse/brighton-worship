import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeLoader } from "@/components/home-loader";
import { AutoRefresh } from "@/components/auto-refresh";
import { HomeView } from "./home-view";

export const metadata: Metadata = { title: "Home · Brighton Worship" };

export default function HomePage() {
  return (
    <>
      <AutoRefresh />
      <Suspense fallback={<HomeLoader className="py-24" />}>
        <HomeView />
      </Suspense>
    </>
  );
}
