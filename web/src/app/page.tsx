import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { formatTime } from "@/lib/roster";
import { morningServiceTonight } from "@/lib/night-owl";
import { getSessionUser } from "@/lib/auth";
import { LoginButton } from "@/components/login-dialog";

/** Sends already-signed-in users straight to the app. Streams in after the static shell. */
async function RedirectIfSignedIn() {
  const user = await getSessionUser();
  if (user) redirect(user.mustChangePassword ? "/change-password" : "/home");
  return null;
}

/** 12am-5am (Singapore time) before a morning Sunday service: tell them to go to bed. */
async function GoToSleep() {
  await connection(); // depends on the time right now, so never prerendered
  const service = await morningServiceTonight();
  if (!service) return null;
  return (
    <p role="status" className="relative mt-8 max-w-md text-center text-base text-ink-foreground/85">
      <span className="block font-display text-2xl font-semibold text-ink-foreground">What are you doing awake at this hour?</span>
      {service.name} is at {formatTime(service.time)}. Go to sleep!
    </p>
  );
}

export default function LandingPage() {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-ink px-4 text-ink-foreground">
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(180,83,9,0.22),transparent_65%)]"
      />
      <h1 className="relative text-center font-display text-6xl font-semibold leading-none tracking-tight sm:text-8xl lg:text-9xl">
        Brighton
        <br />
        Worship
      </h1>
      <Suspense fallback={null}>
        <GoToSleep />
      </Suspense>
      <div className="relative mt-12">
        <LoginButton />
      </div>
    </main>
  );
}
